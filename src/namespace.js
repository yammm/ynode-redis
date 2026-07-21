import { AsyncLocalStorage } from "node:async_hooks";

import {
    applyPrefixToKey,
    commandNameToken,
    DEFAULT_COMMAND_SPECS,
    DEFAULT_KEYLESS_COMMANDS,
    keyIndexesForCommand,
    keyIndexesForDynamicCountCommand,
    keyIndexesForMovableCommand,
    parseCommandSpecs,
} from "./namespace-keys.js";

const MAX_SCOPED_NAMESPACE_CACHE_SIZE = 256;
const NAMESPACE_COMPATIBILITY_ERROR_CODE = "REDIS_NAMESPACE_INCOMPATIBLE_CLIENT";
const NAMESPACE_UNSAFE_COMMAND_ERROR_CODE = "REDIS_NAMESPACE_UNSAFE_COMMAND";

/**
 * Strips trailing colons and whitespace from a namespace value. Embedded
 * colons are rejected because they make distinct namespace/key pairs map to
 * the same physical Redis key. Returns empty string for null/undefined.
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
                const result = runWithScopedNamespace(() => value.apply(target, args));
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
                const result = runWithoutNamespace(() => value.apply(target, args));
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
 * @param {object} client - Redis client instance (node-redis v5).
 * @param {string} [initialNamespace] - Default namespace prefix for all key commands.
 */
export function attachNamespace(client, initialNamespace) {
    const bypassNamespaceStore = new AsyncLocalStorage();
    const scopedNamespaceStore = new AsyncLocalStorage();
    const { usesPublicSendCommand, fallbackInternalClient } = probeCommandDispatch(client);
    const rawClientSendCommand = client.sendCommand.bind(client);
    const rawInternalSendCommand =
        fallbackInternalClient && !usesPublicSendCommand
            ? fallbackInternalClient.sendCommand.bind(fallbackInternalClient)
            : rawClientSendCommand;
    let commandSpecs = new Map(DEFAULT_COMMAND_SPECS);
    let loadingSpecsPromise = null;
    let commandSpecsLoaded = false;
    let namespace = normalizeNamespace(initialNamespace);
    let namespacePrefix = namespace ? `${namespace}:` : "";
    let namespacePrefixBuffer = namespacePrefix ? Buffer.from(namespacePrefix) : null;
    const scopedClientCache = new Map();
    const wrappedMultiClients = new WeakSet();
    const originalMULTI = typeof client.MULTI === "function" ? client.MULTI.bind(client) : null;
    const originalMulti = typeof client.multi === "function" ? client.multi.bind(client) : null;

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
                const response = await rawInternalSendCommand(["COMMAND"]);
                const discoveredSpecs = parseCommandSpecs(response);
                if (discoveredSpecs.size > 0) {
                    commandSpecs = new Map([...commandSpecs, ...discoveredSpecs]);
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

        const command = commandNameToken(args[0]);
        if (!command) {
            return args;
        }

        const dynamicKeyIndexes = keyIndexesForDynamicCountCommand(command, args);
        const movableKeyIndexes =
            dynamicKeyIndexes === null ? keyIndexesForMovableCommand(command, args) : null;
        const spec = commandSpecs.get(command);
        if (dynamicKeyIndexes === null && movableKeyIndexes === null && spec?.movableKeys) {
            throw namespaceUnsafeCommandError(command);
        }
        if (
            dynamicKeyIndexes === null &&
            movableKeyIndexes === null &&
            !spec &&
            !DEFAULT_KEYLESS_COMMANDS.has(command)
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

    function rewriteMultiCommandArguments(parameters, activePrefix, activePrefixBuffer) {
        if (!activePrefix || !Array.isArray(parameters) || parameters.length === 0) {
            return parameters;
        }

        const commandArgsIndex = parameters.findIndex((value) => Array.isArray(value));
        if (commandArgsIndex === -1) {
            return parameters;
        }

        const rewrittenCommandArgs = namespacedArgs(
            parameters[commandArgsIndex],
            activePrefix,
            activePrefixBuffer,
        );
        if (rewrittenCommandArgs === parameters[commandArgsIndex]) {
            return parameters;
        }

        const rewrittenParameters = [...parameters];
        rewrittenParameters[commandArgsIndex] = rewrittenCommandArgs;
        return rewrittenParameters;
    }

    function copyRewrittenCommandArgs(commandArgs, rewrittenCommandArgs) {
        if (rewrittenCommandArgs === commandArgs) {
            return;
        }

        commandArgs.length = rewrittenCommandArgs.length;
        for (let index = 0; index < rewrittenCommandArgs.length; index += 1) {
            commandArgs[index] = rewrittenCommandArgs[index];
        }
        for (const key of Object.keys(rewrittenCommandArgs)) {
            commandArgs[key] = rewrittenCommandArgs[key];
        }
    }

    function createPendingMultiCommandHooks(rawAddCommand, multiClient, invocationContext) {
        const pendingRewrites = [];
        let flushPendingRewritesPromise = null;

        function addCommand(...parameters) {
            return runWithNamespaceInvocationContext(invocationContext, () => {
                const { prefix: activePrefix, prefixBuffer: activePrefixBuffer } =
                    activePrefixForInvocationContext(invocationContext);
                const commandArgsIndex = parameters.findIndex((value) => Array.isArray(value));

                if (!activePrefix || commandArgsIndex === -1) {
                    rawAddCommand(...parameters);
                    return multiClient;
                }

                if (!client.isOpen || commandSpecsLoaded) {
                    const rewrittenParameters = rewriteMultiCommandArguments(
                        parameters,
                        activePrefix,
                        activePrefixBuffer,
                    );
                    rawAddCommand(...rewrittenParameters);
                    return multiClient;
                }

                pendingRewrites.push({
                    args: parameters[commandArgsIndex],
                    prefix: activePrefix,
                    prefixBuffer: activePrefixBuffer,
                });
                rawAddCommand(...parameters);
                return multiClient;
            });
        }

        async function flushPendingRewrites() {
            if (flushPendingRewritesPromise) {
                return flushPendingRewritesPromise;
            }
            if (pendingRewrites.length === 0) {
                return undefined;
            }

            flushPendingRewritesPromise = (async () => {
                const rewrites = pendingRewrites.slice();
                if (client.isOpen && !commandSpecsLoaded) {
                    await loadCommandSpecs();
                }

                for (const { args, prefix, prefixBuffer } of rewrites) {
                    const rewrittenArgs = namespacedArgs(args, prefix, prefixBuffer);
                    copyRewrittenCommandArgs(args, rewrittenArgs);
                }
                pendingRewrites.splice(0, rewrites.length);
            })();

            try {
                return await flushPendingRewritesPromise;
            } finally {
                flushPendingRewritesPromise = null;
            }
        }

        return { addCommand, flushPendingRewrites };
    }

    function wrapMultiClient(multiClient, invocationContext) {
        if (!multiClient || typeof multiClient !== "object") {
            return multiClient;
        }
        if (wrappedMultiClients.has(multiClient)) {
            return multiClient;
        }

        if (typeof multiClient.addCommand !== "function") {
            return multiClient;
        }
        wrappedMultiClients.add(multiClient);

        const rawAddCommand = multiClient.addCommand.bind(multiClient);
        const { addCommand, flushPendingRewrites } = createPendingMultiCommandHooks(
            rawAddCommand,
            multiClient,
            invocationContext,
        );
        multiClient.addCommand = addCommand;

        if (typeof multiClient.sendCommand === "function") {
            multiClient.sendCommand = (args) =>
                multiClient.addCommand(Array.isArray(args) ? args.slice() : args);
        }

        for (const methodName of [
            "exec",
            "EXEC",
            "execTyped",
            "execAsPipeline",
            "execAsPipelineTyped",
        ]) {
            if (typeof multiClient[methodName] !== "function") {
                continue;
            }

            const rawMethod = multiClient[methodName].bind(multiClient);
            multiClient[methodName] = async (...methodArgs) =>
                runWithNamespaceInvocationContext(invocationContext, async () => {
                    await flushPendingRewrites();
                    return withoutNamespace(() => rawMethod(...methodArgs));
                });
        }

        return multiClient;
    }

    function createNamespacedMultiFactory(rawFactory) {
        return (...factoryArgs) => {
            const invocationContext = captureNamespaceInvocationContext();
            const multiClient = runWithNamespaceInvocationContext(invocationContext, () =>
                rawFactory(...factoryArgs),
            );
            return wrapMultiClient(multiClient, invocationContext);
        };
    }

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

    if (originalMULTI) {
        client.MULTI = createNamespacedMultiFactory(originalMULTI);
    }

    if (originalMulti) {
        client.multi = createNamespacedMultiFactory(originalMulti);
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
            namespace = normalizeNamespace(value);
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

    Object.defineProperty(client, "raw", {
        configurable: true,
        enumerable: false,
        value: rawClientProxy,
    });
}
