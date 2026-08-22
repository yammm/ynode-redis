import { AsyncLocalStorage } from "node:async_hooks";

import { raceWithDeadline } from "./deadline.js";
import {
    applyPrefixToKey,
    commandNameToken,
    DEFAULT_COMMAND_SPECS,
    DEFAULT_KEYLESS_COMMANDS,
    keyIndexesForCommand,
    keyIndexesForDynamicCountCommand,
    keyIndexesForMovableCommand,
    parseCommandSpecs,
    RAW_ONLY_COMMANDS,
} from "./namespace-keys.js";
import { attachMultiInterception } from "./namespace-multi.js";

const MAX_SCOPED_NAMESPACE_CACHE_SIZE = 256;
const COMMAND_SPEC_LOAD_TIMEOUT_MS = 5_000;
const NAMESPACE_COMPATIBILITY_ERROR_CODE = "REDIS_NAMESPACE_INCOMPATIBLE_CLIENT";
const NAMESPACE_SETTER_DEPRECATION_CODE = "YNODE_REDIS_NAMESPACE_SETTER_DEPRECATED";
const NAMESPACE_UNSAFE_COMMAND_ERROR_CODE = "REDIS_NAMESPACE_UNSAFE_COMMAND";

const PRIVATE_QUEUE_METHOD_COMMANDS = new Map([
    ["MONITOR", "MONITOR"],
    ["monitor", "MONITOR"],
    ["PSUBSCRIBE", "PSUBSCRIBE"],
    ["pSubscribe", "PSUBSCRIBE"],
    ["PUNSUBSCRIBE", "PUNSUBSCRIBE"],
    ["pUnsubscribe", "PUNSUBSCRIBE"],
    ["reset", "RESET"],
    ["SELECT", "SELECT"],
    ["select", "SELECT"],
    ["SSUBSCRIBE", "SSUBSCRIBE"],
    ["sSubscribe", "SSUBSCRIBE"],
    ["SUNSUBSCRIBE", "SUNSUBSCRIBE"],
    ["sUnsubscribe", "SUNSUBSCRIBE"],
    ["SUBSCRIBE", "SUBSCRIBE"],
    ["subscribe", "SUBSCRIBE"],
    ["UNSUBSCRIBE", "UNSUBSCRIBE"],
    ["unsubscribe", "UNSUBSCRIBE"],
]);

const NAMESPACE_GLOB_METACHARACTERS = /[*?[\]]/;

/**
 * Returns true when the value contains an ASCII control character.
 * @param {string} value - Candidate namespace text.
 * @returns {boolean} True when a control character is present.
 */
function containsControlCharacters(value) {
    for (const character of value) {
        const codePoint = character.codePointAt(0);
        if (codePoint <= 0x1f || codePoint === 0x7f) {
            return true;
        }
    }
    return false;
}

/**
 * Strips trailing colons and whitespace from a namespace value. Embedded
 * colons are rejected because they make distinct namespace/key pairs map to
 * the same physical Redis key. Control characters, embedded whitespace, and
 * glob metacharacters are rejected because they corrupt logs and
 * MATCH-pattern tooling built on top of prefixed keys. Returns empty string
 * for null/undefined.
 * @param {*} value - Raw namespace input.
 * @returns {string} Normalized namespace without trailing separator.
 */
export function normalizeNamespace(value) {
    if (value === undefined || value === null) {
        return "";
    }

    const normalized = String(value).trim().replace(/:+$/, "");
    if (normalized.includes(":")) {
        throw new TypeError("Redis namespace must not contain ':'");
    }
    if (containsControlCharacters(normalized)) {
        throw new TypeError("Redis namespace must not contain control characters");
    }
    if (/\s/.test(normalized)) {
        throw new TypeError("Redis namespace must not contain whitespace");
    }
    if (NAMESPACE_GLOB_METACHARACTERS.test(normalized)) {
        throw new TypeError(
            "Redis namespace must not contain the glob metacharacters '*', '?', '[', or ']'",
        );
    }
    return normalized;
}

/**
 * Creates an Error with a standard code indicating the Redis client is
 * incompatible with namespace interception.
 * @param {string} message - Detail about the incompatibility.
 * @returns {Error} Error with code REDIS_NAMESPACE_INCOMPATIBLE_CLIENT.
 */
function namespaceCompatibilityError(message) {
    const error = new Error(
        `Redis client is incompatible with @ynode/redis namespace interception: ${message}`,
    );
    error.code = NAMESPACE_COMPATIBILITY_ERROR_CODE;
    return error;
}

/**
 * Creates an error for a command whose movable keys cannot be rewritten safely.
 * @param {string} command - Uppercase Redis command name.
 * @param {string} [reason="uses movable keys"] - Why the command cannot be namespaced.
 * @returns {Error} Error with code REDIS_NAMESPACE_UNSAFE_COMMAND.
 */
function namespaceUnsafeCommandError(command, reason = "uses movable keys") {
    const error = new Error(
        `Redis command ${command} ${reason}; @ynode/redis cannot namespace it safely.`,
    );
    error.code = NAMESPACE_UNSAFE_COMMAND_ERROR_CODE;
    return error;
}

/**
 * Creates an Error indicating that an operation requires an active namespace.
 * @param {string} operation - Namespace-only operation name.
 * @returns {Error} Error with code REDIS_NAMESPACE_REQUIRED.
 */
function namespaceRequiredError(operation) {
    const error = new Error(`Redis ${operation} requires an active namespace`);
    error.code = "REDIS_NAMESPACE_REQUIRED";
    return error;
}

/**
 * Creates an Error when Redis returns a key outside the namespace-constrained
 * SCAN pattern. Failing closed prevents a malformed client reply from exposing
 * a physical/global key through the logical-key iterator.
 * @returns {Error} Error with code REDIS_NAMESPACE_SCAN_MISMATCH.
 */
function namespaceScanMismatchError() {
    const error = new Error("Redis namespace scan returned a key outside the active namespace");
    error.code = "REDIS_NAMESPACE_SCAN_MISMATCH";
    return error;
}

/**
 * Probes a node-redis client to determine how generated command methods
 * dispatch internally. Returns whether sendCommand on the public client is
 * the canonical path, or whether an internal _self must also be intercepted.
 * @param {object} client - Redis client instance.
 * @returns {object} Probe result with usesPublicSendCommand and fallbackInternalClient.
 */
function probeCommandDispatch(client) {
    if (!client || typeof client.sendCommand !== "function") {
        throw namespaceCompatibilityError("client.sendCommand is required.");
    }

    const internalClient =
        client && typeof client._self === "object" && client._self !== null ? client._self : null;
    const usesPublicSendCommand = !internalClient || internalClient === client;

    if (usesPublicSendCommand) {
        return { usesPublicSendCommand: true, fallbackInternalClient: null };
    }

    if (typeof internalClient.sendCommand !== "function") {
        throw namespaceCompatibilityError(
            "generated command methods bypass client.sendCommand and client._self.sendCommand is unavailable.",
        );
    }

    return { usesPublicSendCommand: false, fallbackInternalClient: internalClient };
}

/**
 * Re-enters a captured namespace context whenever an async iterator advances.
 * Async generator bodies execute in the context of next(), not the context in
 * which the generator object was created.
 * @param {*} value - Possible async iterable returned from a client method.
 * @param {function(function(): *): *} runInContext - Namespace context runner.
 * @returns {*} Context-bound async iterable, or the original value.
 */
function bindAsyncIteratorContext(value, runInContext) {
    if (!value || typeof value !== "object" || typeof value[Symbol.asyncIterator] !== "function") {
        return value;
    }

    const functionCache = new Map();
    const proxy = new Proxy(value, {
        get(target, property) {
            const member = Reflect.get(target, property, target);
            if (typeof member !== "function") {
                return member;
            }
            if (functionCache.has(property)) {
                return functionCache.get(property);
            }

            let wrapped;
            if (property === Symbol.asyncIterator) {
                wrapped = (...args) => {
                    const iterator = runInContext(() => member.apply(target, args));
                    return iterator === target
                        ? proxy
                        : bindAsyncIteratorContext(iterator, runInContext);
                };
            } else if (property === "next" || property === "return" || property === "throw") {
                wrapped = (...args) => runInContext(() => member.apply(target, args));
            } else {
                wrapped = member.bind(target);
            }

            functionCache.set(property, wrapped);
            return wrapped;
        },
    });
    return proxy;
}

/**
 * Creates a Proxy around the Redis client that routes all method calls
 * through a scoped namespace context. Property access for namespace,
 * withNamespace, raw, and withoutNamespace is intercepted with scoped values.
 * @param {object} options - Proxy configuration.
 * @param {object} options.client - The underlying Redis client to wrap.
 * @param {string} options.scopedNamespace - Namespace string for this scope.
 * @param {function(string=): object} options.getWithNamespace - Factory for nested withNamespace calls.
 * @param {function(): object} options.getRawClient - Getter that returns the raw (un-namespaced) proxy.
 * @param {function(function(): *): *} options.withoutNamespace - Bypass callback for un-namespaced commands.
 * @param {function(function(): *): *} options.runWithScopedNamespace - Runner that activates the scoped prefix.
 * @returns {Proxy} Scoped namespace proxy over the client.
 */
function createScopedNamespaceProxy({
    client,
    scopedNamespace,
    getWithNamespace,
    getRawClient,
    withoutNamespace,
    runWithScopedNamespace,
}) {
    const functionCache = new Map();

    return new Proxy(client, {
        get(target, property) {
            if (property === "namespace") {
                return scopedNamespace || undefined;
            }
            if (property === "withNamespace") {
                return getWithNamespace;
            }
            if (property === "raw") {
                return getRawClient();
            }
            if (property === "withoutNamespace") {
                return withoutNamespace;
            }

            const value = Reflect.get(target, property, target);
            if (typeof value !== "function") {
                return value;
            }

            if (functionCache.has(property)) {
                return functionCache.get(property);
            }

            const wrapped = (...args) => {
                // Resolve at invoke time so methods patched after the wrapper
                // was cached are still honored.
                const method = Reflect.get(target, property, target);
                const result = runWithScopedNamespace(() => method.apply(target, args));
                return bindAsyncIteratorContext(result, runWithScopedNamespace);
            };
            functionCache.set(property, wrapped);
            return wrapped;
        },
        set(target, property, value) {
            if (property === "namespace") {
                throw new TypeError(
                    "Cannot assign namespace on scoped client. Use withNamespace().",
                );
            }
            return Reflect.set(target, property, value, target);
        },
    });
}

/**
 * Creates a Proxy that wraps every method call in a namespace-bypass context,
 * allowing commands to execute against raw (un-prefixed) keys.
 * @param {object} client - The underlying Redis client to wrap.
 * @param {function(function(): *): *} runWithoutNamespace - Runner that disables namespace prefixing.
 * @returns {Proxy} Raw client proxy that bypasses namespace interception.
 */
function createRawClientProxy(client, runWithoutNamespace) {
    const functionCache = new Map();

    return new Proxy(client, {
        get(target, property, receiver) {
            if (property === "raw") {
                return receiver;
            }

            const value = Reflect.get(target, property, target);
            if (typeof value !== "function") {
                return value;
            }

            if (functionCache.has(property)) {
                return functionCache.get(property);
            }

            const wrapped = (...args) => {
                // Resolve at invoke time so methods patched after the wrapper
                // was cached are still honored.
                const method = Reflect.get(target, property, target);
                const result = runWithoutNamespace(() => method.apply(target, args));
                return bindAsyncIteratorContext(result, runWithoutNamespace);
            };
            functionCache.set(property, wrapped);
            return wrapped;
        },
    });
}

/**
 * Attaches transparent key-namespace prefixing to a Redis client.
 * Intercepts sendCommand to prepend the active namespace prefix to key arguments,
 * supports scoped namespaces via withNamespace(), raw bypass via withoutNamespace(),
 * and MULTI/pipeline command rewriting.
 * @param {object} client - Redis client instance (node-redis v6).
 * @param {string} [initialNamespace] - Default namespace prefix for all key commands.
 * @param {object} [options] - Namespace interception options.
 * @param {object|Map} [options.namespaceCommands] - Custom command key metadata.
 */
export function attachNamespace(client, initialNamespace, options = {}) {
    const namespaceOptions = options && typeof options === "object" ? options : {};
    const bypassNamespaceStore = new AsyncLocalStorage();
    const scopedNamespaceStore = new AsyncLocalStorage();
    const { usesPublicSendCommand, fallbackInternalClient } = probeCommandDispatch(client);
    const rawClientSendCommand = client.sendCommand.bind(client);
    const rawInternalSendCommand =
        fallbackInternalClient && !usesPublicSendCommand
            ? fallbackInternalClient.sendCommand.bind(fallbackInternalClient)
            : rawClientSendCommand;
    const requiresPrivateQueueInterception = Boolean(
        fallbackInternalClient &&
        (typeof client.MULTI === "function" || typeof client.multi === "function"),
    );
    const customCommandSpecs = new Map();
    const customKeylessCommands = new Set();
    let serverCommandSpecs = new Map();
    let commandSpecs = new Map(DEFAULT_COMMAND_SPECS);
    let keylessCommands = new Set(DEFAULT_KEYLESS_COMMANDS);
    let loadingSpecsPromise = null;
    let commandSpecsLoaded = false;
    let namespace = normalizeNamespace(initialNamespace);
    let namespacePrefix = namespace ? `${namespace}:` : "";
    let namespacePrefixBuffer = namespacePrefix ? Buffer.from(namespacePrefix) : null;
    let namespaceSetterWarningEmitted = false;
    const scopedClientCache = new Map();
    const namespaceProcessedCommands = new WeakSet();

    function normalizeNamespaceCommandSpec(commandName, spec) {
        const command = commandNameToken(
            typeof commandName === "string" ? commandName.trim() : commandName,
        );
        if (!command || /\s/.test(command)) {
            throw new TypeError(
                "Redis namespace command metadata requires a non-empty command name",
            );
        }

        if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
            throw new TypeError(`Redis namespace command ${command} metadata must be an object`);
        }

        if (spec.keyless === true) {
            return { command, keyless: true };
        }

        const firstKey = Number(spec.firstKey);
        const lastKey = Number(spec.lastKey);
        const step = spec.step === undefined ? 1 : Number(spec.step);
        if (
            !Number.isInteger(firstKey) ||
            firstKey < 1 ||
            !Number.isInteger(lastKey) ||
            lastKey === 0 ||
            !Number.isInteger(step) ||
            step < 1
        ) {
            throw new TypeError(
                `Redis namespace command ${command} metadata must define integer firstKey, lastKey, and step positions`,
            );
        }

        return { command, spec: { firstKey, lastKey, step } };
    }

    function rebuildCommandMetadata() {
        commandSpecs = new Map([
            ...DEFAULT_COMMAND_SPECS,
            ...serverCommandSpecs,
            ...customCommandSpecs,
        ]);
        keylessCommands = new Set([...DEFAULT_KEYLESS_COMMANDS, ...customKeylessCommands]);
        for (const command of customKeylessCommands) {
            commandSpecs.delete(command);
        }
    }

    function registerNamespaceCommand(commandName, spec) {
        const metadata = normalizeNamespaceCommandSpec(commandName, spec);
        if (metadata.keyless) {
            customCommandSpecs.delete(metadata.command);
            customKeylessCommands.add(metadata.command);
        } else {
            customKeylessCommands.delete(metadata.command);
            customCommandSpecs.set(metadata.command, metadata.spec);
        }
        rebuildCommandMetadata();
        return client;
    }

    function registerNamespaceCommands(commandDefinitions) {
        if (commandDefinitions === undefined || commandDefinitions === null) {
            return client;
        }
        if (typeof commandDefinitions !== "object") {
            throw new TypeError("Redis namespace command metadata must be an object or Map");
        }

        const entries =
            commandDefinitions instanceof Map
                ? commandDefinitions.entries()
                : Object.entries(commandDefinitions);
        for (const [commandName, spec] of entries) {
            registerNamespaceCommand(commandName, spec);
        }
        return client;
    }

    registerNamespaceCommands(namespaceOptions.namespaceCommands);

    function withoutNamespace(callback) {
        return bypassNamespaceStore.run(true, callback);
    }

    const rawClientProxy = createRawClientProxy(client, withoutNamespace);

    function runWithScopedNamespace(scopedNamespace, prefix, prefixBuffer, callback) {
        return scopedNamespaceStore.run(
            { namespace: scopedNamespace, prefix, prefixBuffer },
            callback,
        );
    }

    function captureNamespaceInvocationContext() {
        if (bypassNamespaceStore.getStore() === true) {
            return { bypass: true };
        }

        const scopedNamespace = scopedNamespaceStore.getStore();
        if (scopedNamespace) {
            return {
                bypass: false,
                scopedNamespace: scopedNamespace.namespace,
                scopedPrefix: scopedNamespace.prefix,
                scopedPrefixBuffer: scopedNamespace.prefixBuffer,
            };
        }

        return { bypass: false, scopedPrefix: undefined, scopedPrefixBuffer: undefined };
    }

    function runWithNamespaceInvocationContext(invocationContext, callback) {
        if (invocationContext.bypass) {
            return bypassNamespaceStore.run(true, callback);
        }

        if (invocationContext.scopedPrefix !== undefined) {
            return scopedNamespaceStore.run(
                {
                    namespace: invocationContext.scopedNamespace,
                    prefix: invocationContext.scopedPrefix,
                    prefixBuffer: invocationContext.scopedPrefixBuffer,
                },
                callback,
            );
        }

        return callback();
    }

    function activePrefixForInvocationContext(invocationContext) {
        if (invocationContext.bypass) {
            return { prefix: "", prefixBuffer: null };
        }

        if (invocationContext.scopedPrefix !== undefined) {
            return {
                prefix: invocationContext.scopedPrefix,
                prefixBuffer: invocationContext.scopedPrefixBuffer,
            };
        }

        return { prefix: namespacePrefix, prefixBuffer: namespacePrefixBuffer };
    }

    /**
     * Builds a physical Redis MATCH pattern by prepending the active namespace
     * prefix to a logical string or Buffer glob.
     * @param {string|Buffer|undefined} match - Logical Redis glob.
     * @param {string} activePrefix - Active string namespace prefix.
     * @param {Buffer} activePrefixBuffer - Active Buffer namespace prefix.
     * @returns {string|Buffer} Physical Redis glob constrained to the namespace.
     */
    function namespaceScanMatch(match, activePrefix, activePrefixBuffer) {
        if (match === undefined) {
            return `${activePrefix}*`;
        }
        if (typeof match === "string") {
            return `${activePrefix}${match}`;
        }
        if (Buffer.isBuffer(match)) {
            return Buffer.concat([activePrefixBuffer, match]);
        }
        throw new TypeError("options.MATCH must be a string or Buffer");
    }

    /**
     * Removes exactly one active namespace prefix from a physical SCAN key.
     * String and Buffer reply mappings are preserved.
     * @param {string|Buffer} key - Physical Redis key returned by SCAN.
     * @param {string} activePrefix - Active string namespace prefix.
     * @param {Buffer} activePrefixBuffer - Active Buffer namespace prefix.
     * @returns {string|Buffer} Logical key.
     */
    function namespaceScanLogicalKey(key, activePrefix, activePrefixBuffer) {
        if (typeof key === "string" && key.startsWith(activePrefix)) {
            return key.slice(activePrefix.length);
        }
        if (
            Buffer.isBuffer(key) &&
            key.length >= activePrefixBuffer.length &&
            key.subarray(0, activePrefixBuffer.length).equals(activePrefixBuffer)
        ) {
            return key.subarray(activePrefixBuffer.length);
        }
        throw namespaceScanMismatchError();
    }

    /**
     * Iterates only keys in the active namespace. The raw/global SCAN iterator
     * remains unchanged; this helper constrains MATCH to the physical prefix and
     * yields logical keys with exactly one prefix removed.
     * @param {object} [options] - node-redis SCAN iterator options.
     * @param {string|Buffer} [options.MATCH] - Logical Redis glob.
     * @param {number} [options.COUNT] - Redis COUNT hint.
     * @param {string|Buffer} [options.TYPE] - Redis TYPE filter.
     * @param {string|Buffer} [options.cursor] - Initial SCAN cursor.
     * @returns {AsyncGenerator<Array<string|Buffer>>} Logical key pages.
     */
    function scanNamespaceIterator(options = {}) {
        if (!options || typeof options !== "object" || Array.isArray(options)) {
            throw new TypeError("options must be an object");
        }

        const invocationContext = captureNamespaceInvocationContext();
        const { prefix: activePrefix, prefixBuffer: activePrefixBuffer } =
            activePrefixForInvocationContext(invocationContext);
        if (!activePrefix || !activePrefixBuffer) {
            throw namespaceRequiredError("scanNamespaceIterator");
        }

        const physicalOptions = {
            ...options,
            MATCH: namespaceScanMatch(options.MATCH, activePrefix, activePrefixBuffer),
        };
        const physicalIterator = rawClientProxy.scanIterator(physicalOptions);

        return (async function* scanLogicalKeys() {
            for await (const page of physicalIterator) {
                if (!Array.isArray(page)) {
                    throw new TypeError("Redis scanIterator must yield arrays of keys");
                }
                yield page.map((key) =>
                    namespaceScanLogicalKey(key, activePrefix, activePrefixBuffer),
                );
            }
        })();
    }

    async function loadCommandSpecs(forceRefresh = false) {
        if (forceRefresh && loadingSpecsPromise) {
            await loadingSpecsPromise;
        }
        if (forceRefresh) {
            commandSpecsLoaded = false;
        }
        if (commandSpecsLoaded) {
            return;
        }

        if (loadingSpecsPromise) {
            return loadingSpecsPromise;
        }

        const currentLoadingPromise = (async () => {
            try {
                // Bound introspection so a stalled socket cannot block every
                // namespaced command behind a never-settling spec load.
                const response = await raceWithDeadline(
                    rawInternalSendCommand(["COMMAND"]),
                    COMMAND_SPEC_LOAD_TIMEOUT_MS,
                    () =>
                        new Error(
                            `Redis COMMAND introspection timed out after ${COMMAND_SPEC_LOAD_TIMEOUT_MS}ms`,
                        ),
                );
                const discoveredSpecs = parseCommandSpecs(response);
                if (discoveredSpecs.size > 0) {
                    serverCommandSpecs = discoveredSpecs;
                    rebuildCommandMetadata();
                }
            } catch {
                // Keep fallback command specs if COMMAND introspection is unavailable.
            } finally {
                commandSpecsLoaded = true;
            }
        })();
        loadingSpecsPromise = currentLoadingPromise;

        await currentLoadingPromise;
        if (loadingSpecsPromise === currentLoadingPromise) {
            loadingSpecsPromise = null;
        }
    }

    function namespacedArgs(args, activePrefix, activePrefixBuffer) {
        if (!Array.isArray(args) || !activePrefix || args.length === 0) {
            return args;
        }

        // A node-redis MULTI executor can send an already-rewritten array
        // through a public sender in test doubles or alternate transports.
        // Preserve the exactly-once key transformation in that case.
        if (namespaceProcessedCommands.has(args)) {
            return args;
        }

        const command = commandNameToken(args[0]);
        if (!command) {
            return args;
        }

        const dynamicKeyIndexes = keyIndexesForDynamicCountCommand(command, args);
        const movableKeyIndexes =
            dynamicKeyIndexes === null ? keyIndexesForMovableCommand(command, args) : null;
        const spec = commandSpecs.get(command);
        if (RAW_ONLY_COMMANDS.has(command) || spec?.admin) {
            throw namespaceUnsafeCommandError(
                command,
                "requires client.raw because it changes server-wide or connection state",
            );
        }
        if (dynamicKeyIndexes === null && movableKeyIndexes === null && spec?.movableKeys) {
            throw namespaceUnsafeCommandError(command);
        }
        if (
            dynamicKeyIndexes === null &&
            movableKeyIndexes === null &&
            !spec &&
            !keylessCommands.has(command)
        ) {
            throw namespaceUnsafeCommandError(command, "has no available key metadata");
        }
        const keyIndexes =
            dynamicKeyIndexes ?? movableKeyIndexes ?? keyIndexesForCommand(spec, args);
        if (keyIndexes.length === 0) {
            return args;
        }

        // Preserve non-index own properties attached by node-redis command parsers.
        const rewrittenArgs = Object.assign([...args], args);
        for (const index of keyIndexes) {
            rewrittenArgs[index] = applyPrefixToKey(
                rewrittenArgs[index],
                activePrefix,
                activePrefixBuffer,
            );
        }

        return rewrittenArgs;
    }

    function namespacedSendCommand(rawSender, args, options) {
        const bypassNamespace = bypassNamespaceStore.getStore() === true;
        if (bypassNamespace) {
            return rawSender(args, options);
        }

        const scopedNamespace = scopedNamespaceStore.getStore();
        const activePrefix = scopedNamespace ? scopedNamespace.prefix : namespacePrefix;
        const activePrefixBuffer = scopedNamespace
            ? scopedNamespace.prefixBuffer
            : namespacePrefixBuffer;
        if (!activePrefix) {
            return rawSender(args, options);
        }

        if (client.isOpen && !commandSpecsLoaded) {
            return loadCommandSpecs().then(() =>
                rawSender(namespacedArgs(args, activePrefix, activePrefixBuffer), options),
            );
        }

        return rawSender(namespacedArgs(args, activePrefix, activePrefixBuffer), options);
    }

    attachMultiInterception({
        client,
        requiresPrivateQueueInterception,
        captureInvocationContext: captureNamespaceInvocationContext,
        runWithInvocationContext: runWithNamespaceInvocationContext,
        activePrefixForInvocationContext,
        areCommandSpecsLoaded: () => commandSpecsLoaded,
        loadCommandSpecs,
        namespacedArgs,
        namespaceProcessedCommands,
        withoutNamespace,
        namespaceCompatibilityError,
    });

    function guardPrivateQueueMethods() {
        for (const [methodName, command] of PRIVATE_QUEUE_METHOD_COMMANDS) {
            if (typeof client[methodName] !== "function") {
                continue;
            }

            const rawMethod = client[methodName].bind(client);
            client[methodName] = (...methodArgs) => {
                const invocationContext = captureNamespaceInvocationContext();
                const { prefix: activePrefix } =
                    activePrefixForInvocationContext(invocationContext);
                if (!invocationContext.bypass && activePrefix) {
                    throw namespaceUnsafeCommandError(
                        command,
                        "requires client.raw because it changes connection or pub/sub state",
                    );
                }
                return rawMethod(...methodArgs);
            };
        }
    }

    guardPrivateQueueMethods();

    function withNamespace(nextNamespace) {
        const normalizedNamespace = normalizeNamespace(nextNamespace);
        const scopedPrefix = normalizedNamespace ? `${normalizedNamespace}:` : "";
        const scopedPrefixBuffer = scopedPrefix ? Buffer.from(scopedPrefix) : null;
        const cacheKey = scopedPrefix;

        if (scopedClientCache.has(cacheKey)) {
            const cachedScopedClient = scopedClientCache.get(cacheKey);
            // Refresh insertion order so the cache behaves as LRU.
            scopedClientCache.delete(cacheKey);
            scopedClientCache.set(cacheKey, cachedScopedClient);
            return cachedScopedClient;
        }

        const scopedClient = createScopedNamespaceProxy({
            client,
            scopedNamespace: normalizedNamespace,
            getWithNamespace: withNamespace,
            getRawClient: () => rawClientProxy,
            withoutNamespace,
            runWithScopedNamespace: (callback) =>
                runWithScopedNamespace(
                    normalizedNamespace,
                    scopedPrefix,
                    scopedPrefixBuffer,
                    callback,
                ),
        });

        if (scopedClientCache.size >= MAX_SCOPED_NAMESPACE_CACHE_SIZE) {
            const oldestKey = scopedClientCache.keys().next().value;
            if (oldestKey !== undefined) {
                scopedClientCache.delete(oldestKey);
            }
        }

        scopedClientCache.set(cacheKey, scopedClient);
        return scopedClient;
    }

    client.sendCommand = function (args, options) {
        return namespacedSendCommand(rawClientSendCommand, args, options);
    };

    if (!usesPublicSendCommand && fallbackInternalClient) {
        fallbackInternalClient.sendCommand = function (args, options) {
            return namespacedSendCommand(rawInternalSendCommand, args, options);
        };
    }

    if (typeof client.on === "function") {
        client.on("ready", () => {
            const hasScopedNamespace = [...scopedClientCache.keys()].some(Boolean);
            if (!namespacePrefix && !hasScopedNamespace) {
                commandSpecsLoaded = false;
                return;
            }
            // Fire and forget: refresh server metadata after every reconnect.
            void loadCommandSpecs(true);
        });
    }

    Object.defineProperty(client, "namespace", {
        configurable: true,
        enumerable: true,
        get() {
            if (bypassNamespaceStore.getStore() === true) {
                return undefined;
            }
            const scopedNamespace = scopedNamespaceStore.getStore();
            if (scopedNamespace) {
                return scopedNamespace.namespace || undefined;
            }
            return namespace || undefined;
        },
        set(value) {
            const nextNamespace = normalizeNamespace(value);
            if (!namespaceSetterWarningEmitted) {
                namespaceSetterWarningEmitted = true;
                process.emitWarning(
                    "Assigning client.namespace is deprecated because it is shared mutable state; use client.withNamespace(namespace) instead.",
                    {
                        code: NAMESPACE_SETTER_DEPRECATION_CODE,
                        type: "DeprecationWarning",
                    },
                );
            }
            namespace = nextNamespace;
            namespacePrefix = namespace ? `${namespace}:` : "";
            namespacePrefixBuffer = namespacePrefix ? Buffer.from(namespacePrefix) : null;
        },
    });

    Object.defineProperty(client, "withoutNamespace", {
        configurable: true,
        enumerable: false,
        value: withoutNamespace,
    });

    Object.defineProperty(client, "withNamespace", {
        configurable: true,
        enumerable: false,
        value: withNamespace,
    });

    Object.defineProperty(client, "registerNamespaceCommand", {
        configurable: true,
        enumerable: false,
        value: registerNamespaceCommand,
    });

    Object.defineProperty(client, "registerNamespaceCommands", {
        configurable: true,
        enumerable: false,
        value: registerNamespaceCommands,
    });

    Object.defineProperty(client, "scanNamespaceIterator", {
        configurable: true,
        enumerable: false,
        value: scanNamespaceIterator,
    });

    Object.defineProperty(client, "raw", {
        configurable: true,
        enumerable: false,
        value: rawClientProxy,
    });
}
