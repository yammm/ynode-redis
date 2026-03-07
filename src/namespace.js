import { AsyncLocalStorage } from "node:async_hooks";

const DEFAULT_COMMAND_SPECS = new Map([
    ["APPEND", { firstKey: 1, lastKey: 1, step: 1 }],
    ["COPY", { firstKey: 1, lastKey: 2, step: 1 }],
    ["DECR", { firstKey: 1, lastKey: 1, step: 1 }],
    ["DECRBY", { firstKey: 1, lastKey: 1, step: 1 }],
    ["DEL", { firstKey: 1, lastKey: -1, step: 1 }],
    ["EXISTS", { firstKey: 1, lastKey: -1, step: 1 }],
    ["EXPIRE", { firstKey: 1, lastKey: 1, step: 1 }],
    ["EXPIREAT", { firstKey: 1, lastKey: 1, step: 1 }],
    ["GET", { firstKey: 1, lastKey: 1, step: 1 }],
    ["GETDEL", { firstKey: 1, lastKey: 1, step: 1 }],
    ["GETEX", { firstKey: 1, lastKey: 1, step: 1 }],
    ["GETSET", { firstKey: 1, lastKey: 1, step: 1 }],
    ["HDEL", { firstKey: 1, lastKey: 1, step: 1 }],
    ["HEXISTS", { firstKey: 1, lastKey: 1, step: 1 }],
    ["HGET", { firstKey: 1, lastKey: 1, step: 1 }],
    ["HGETALL", { firstKey: 1, lastKey: 1, step: 1 }],
    ["HINCRBY", { firstKey: 1, lastKey: 1, step: 1 }],
    ["HINCRBYFLOAT", { firstKey: 1, lastKey: 1, step: 1 }],
    ["HKEYS", { firstKey: 1, lastKey: 1, step: 1 }],
    ["HLEN", { firstKey: 1, lastKey: 1, step: 1 }],
    ["HMGET", { firstKey: 1, lastKey: 1, step: 1 }],
    ["HMSET", { firstKey: 1, lastKey: 1, step: 1 }],
    ["HSCAN", { firstKey: 1, lastKey: 1, step: 1 }],
    ["HSET", { firstKey: 1, lastKey: 1, step: 1 }],
    ["HSTRLEN", { firstKey: 1, lastKey: 1, step: 1 }],
    ["HVALS", { firstKey: 1, lastKey: 1, step: 1 }],
    ["INCR", { firstKey: 1, lastKey: 1, step: 1 }],
    ["INCRBY", { firstKey: 1, lastKey: 1, step: 1 }],
    ["INCRBYFLOAT", { firstKey: 1, lastKey: 1, step: 1 }],
    ["LINDEX", { firstKey: 1, lastKey: 1, step: 1 }],
    ["LINSERT", { firstKey: 1, lastKey: 1, step: 1 }],
    ["LLEN", { firstKey: 1, lastKey: 1, step: 1 }],
    ["LPOP", { firstKey: 1, lastKey: 1, step: 1 }],
    ["LPOS", { firstKey: 1, lastKey: 1, step: 1 }],
    ["LPUSH", { firstKey: 1, lastKey: 1, step: 1 }],
    ["LPUSHX", { firstKey: 1, lastKey: 1, step: 1 }],
    ["LRANGE", { firstKey: 1, lastKey: 1, step: 1 }],
    ["LREM", { firstKey: 1, lastKey: 1, step: 1 }],
    ["LSET", { firstKey: 1, lastKey: 1, step: 1 }],
    ["LTRIM", { firstKey: 1, lastKey: 1, step: 1 }],
    ["MGET", { firstKey: 1, lastKey: -1, step: 1 }],
    ["MSET", { firstKey: 1, lastKey: -1, step: 2 }],
    ["PERSIST", { firstKey: 1, lastKey: 1, step: 1 }],
    ["PEXPIRE", { firstKey: 1, lastKey: 1, step: 1 }],
    ["PEXPIREAT", { firstKey: 1, lastKey: 1, step: 1 }],
    ["PTTL", { firstKey: 1, lastKey: 1, step: 1 }],
    ["RENAME", { firstKey: 1, lastKey: 2, step: 1 }],
    ["RENAMENX", { firstKey: 1, lastKey: 2, step: 1 }],
    ["RPOP", { firstKey: 1, lastKey: 1, step: 1 }],
    ["RPUSH", { firstKey: 1, lastKey: 1, step: 1 }],
    ["RPUSHX", { firstKey: 1, lastKey: 1, step: 1 }],
    ["SADD", { firstKey: 1, lastKey: 1, step: 1 }],
    ["SCARD", { firstKey: 1, lastKey: 1, step: 1 }],
    ["SDIFF", { firstKey: 1, lastKey: -1, step: 1 }],
    ["SDIFFSTORE", { firstKey: 1, lastKey: -1, step: 1 }],
    ["SET", { firstKey: 1, lastKey: 1, step: 1 }],
    ["SETEX", { firstKey: 1, lastKey: 1, step: 1 }],
    ["SINTER", { firstKey: 1, lastKey: -1, step: 1 }],
    ["SINTERSTORE", { firstKey: 1, lastKey: -1, step: 1 }],
    ["SISMEMBER", { firstKey: 1, lastKey: 1, step: 1 }],
    ["SMEMBERS", { firstKey: 1, lastKey: 1, step: 1 }],
    ["SMISMEMBER", { firstKey: 1, lastKey: 1, step: 1 }],
    ["SMOVE", { firstKey: 1, lastKey: 2, step: 1 }],
    ["SPOP", { firstKey: 1, lastKey: 1, step: 1 }],
    ["SRANDMEMBER", { firstKey: 1, lastKey: 1, step: 1 }],
    ["SREM", { firstKey: 1, lastKey: 1, step: 1 }],
    ["SSCAN", { firstKey: 1, lastKey: 1, step: 1 }],
    ["STRLEN", { firstKey: 1, lastKey: 1, step: 1 }],
    ["SUNION", { firstKey: 1, lastKey: -1, step: 1 }],
    ["SUNIONSTORE", { firstKey: 1, lastKey: -1, step: 1 }],
    ["TOUCH", { firstKey: 1, lastKey: -1, step: 1 }],
    ["TTL", { firstKey: 1, lastKey: 1, step: 1 }],
    ["TYPE", { firstKey: 1, lastKey: 1, step: 1 }],
    ["UNLINK", { firstKey: 1, lastKey: -1, step: 1 }],
    ["ZADD", { firstKey: 1, lastKey: 1, step: 1 }],
    ["ZCARD", { firstKey: 1, lastKey: 1, step: 1 }],
    ["ZCOUNT", { firstKey: 1, lastKey: 1, step: 1 }],
    ["ZINCRBY", { firstKey: 1, lastKey: 1, step: 1 }],
    ["ZRANGE", { firstKey: 1, lastKey: 1, step: 1 }],
    ["ZRANGEBYSCORE", { firstKey: 1, lastKey: 1, step: 1 }],
    ["ZRANK", { firstKey: 1, lastKey: 1, step: 1 }],
    ["ZREM", { firstKey: 1, lastKey: 1, step: 1 }],
    ["ZREVRANGE", { firstKey: 1, lastKey: 1, step: 1 }],
    ["ZREVRANGEBYSCORE", { firstKey: 1, lastKey: 1, step: 1 }],
    ["ZREVRANK", { firstKey: 1, lastKey: 1, step: 1 }],
    ["ZSCORE", { firstKey: 1, lastKey: 1, step: 1 }],
    ["ZUNIONSTORE", { firstKey: 1, lastKey: -1, step: 1 }],
]);

const DYNAMIC_KEY_COUNT_COMMANDS = new Set(["EVAL", "EVAL_RO", "EVALSHA", "EVALSHA_RO", "FCALL", "FCALL_RO"]);

function normalizeNamespace(value) {
    if (value === undefined || value === null) {
        return "";
    }

    const normalized = String(value).trim().replace(/:+$/, "");
    return normalized;
}

function commandNameToken(token) {
    if (typeof token === "string") {
        return token.toUpperCase();
    }
    if (Buffer.isBuffer(token)) {
        return token.toString("utf8").toUpperCase();
    }
    return "";
}

function parseCommandSpecs(reply) {
    const specs = new Map();
    if (!Array.isArray(reply)) {
        return specs;
    }

    for (const entry of reply) {
        if (!Array.isArray(entry) || entry.length < 6) {
            continue;
        }

        const name = commandNameToken(entry[0]);
        const firstKey = Number(entry[3]);
        const lastKey = Number(entry[4]);
        const step = Number(entry[5]);

        if (!name || !Number.isFinite(firstKey) || !Number.isFinite(lastKey) || !Number.isFinite(step)) {
            continue;
        }

        specs.set(name, { firstKey, lastKey, step });
    }

    return specs;
}

function keyIndexesForCommand(spec, args) {
    if (!spec || !Array.isArray(args)) {
        return [];
    }

    if (spec.firstKey <= 0 || args.length <= 1) {
        return [];
    }

    const keysArgCount = args.length - 1;
    let lastKey = spec.lastKey;
    if (lastKey < 0) {
        lastKey = keysArgCount + lastKey + 1;
    }

    if (lastKey > keysArgCount) {
        lastKey = keysArgCount;
    }

    if (lastKey < spec.firstKey) {
        return [];
    }

    const indexes = [];
    const step = spec.step > 0 ? spec.step : 1;
    for (let index = spec.firstKey; index <= lastKey; index += step) {
        indexes.push(index);
    }

    return indexes;
}

function integerTokenValue(token) {
    if (typeof token === "number") {
        if (!Number.isFinite(token)) {
            return null;
        }
        return Math.trunc(token);
    }

    if (typeof token === "bigint") {
        const minSafeInteger = BigInt(Number.MIN_SAFE_INTEGER);
        const maxSafeInteger = BigInt(Number.MAX_SAFE_INTEGER);
        if (token < minSafeInteger || token > maxSafeInteger) {
            return null;
        }
        return Number(token);
    }

    const tokenValue = Buffer.isBuffer(token) ? token.toString("utf8") : typeof token === "string" ? token : null;
    if (tokenValue === null || tokenValue.length === 0) {
        return null;
    }

    const parsed = Number.parseInt(tokenValue, 10);
    return Number.isNaN(parsed) ? null : parsed;
}

function keyIndexesForDynamicCountCommand(command, args) {
    if (!DYNAMIC_KEY_COUNT_COMMANDS.has(command)) {
        return null;
    }

    if (!Array.isArray(args) || args.length < 4) {
        return [];
    }

    const keyCount = integerTokenValue(args[2]);
    if (keyCount === null || keyCount <= 0) {
        return [];
    }

    const availableKeys = Math.max(0, args.length - 3);
    const actualKeyCount = Math.min(keyCount, availableKeys);
    const indexes = [];
    for (let offset = 0; offset < actualKeyCount; offset += 1) {
        indexes.push(3 + offset);
    }

    return indexes;
}

function applyPrefixToKey(key, prefix) {
    if (!prefix) {
        return key;
    }

    if (Buffer.isBuffer(key)) {
        const prefixBuffer = Buffer.from(prefix);
        if (key.length >= prefixBuffer.length && key.subarray(0, prefixBuffer.length).equals(prefixBuffer)) {
            return key;
        }
        return Buffer.concat([prefixBuffer, key]);
    }

    const keyString =
        typeof key === "string" ? key : typeof key === "number" || typeof key === "bigint" ? String(key) : null;

    if (keyString === null) {
        return key;
    }

    if (keyString.startsWith(prefix)) {
        return key;
    }

    return `${prefix}${keyString}`;
}

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

            const wrapped = (...args) => runWithScopedNamespace(() => value.apply(target, args));
            functionCache.set(property, wrapped);
            return wrapped;
        },
        set(target, property, value) {
            if (property === "namespace") {
                throw new TypeError("Cannot assign namespace on scoped client. Use withNamespace().");
            }
            return Reflect.set(target, property, value, target);
        },
    });
}

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

            const wrapped = (...args) => runWithoutNamespace(() => value.apply(target, args));
            functionCache.set(property, wrapped);
            return wrapped;
        },
    });
}

export function attachNamespace(client, initialNamespace) {
    const bypassNamespaceStore = new AsyncLocalStorage();
    const scopedNamespaceStore = new AsyncLocalStorage();
    const internalClient =
        client && typeof client._self === "object" && client._self !== null ? client._self : null;
    const rawClientSendCommand = client.sendCommand.bind(client);
    const rawInternalSendCommand =
        internalClient && typeof internalClient.sendCommand === "function"
            ? internalClient.sendCommand.bind(internalClient)
            : rawClientSendCommand;
    let commandSpecs = new Map(DEFAULT_COMMAND_SPECS);
    let loadingSpecsPromise = null;
    let commandSpecsLoaded = false;
    let namespace = normalizeNamespace(initialNamespace);
    let namespacePrefix = namespace ? `${namespace}:` : "";
    const scopedClientCache = new Map();
    const rawExecuteMulti = typeof client._executeMulti === "function" ? client._executeMulti.bind(client) : null;
    const rawExecutePipeline = typeof client._executePipeline === "function" ? client._executePipeline.bind(client) : null;
    const originalMULTI = typeof client.MULTI === "function" ? client.MULTI.bind(client) : null;
    const originalMulti = typeof client.multi === "function" ? client.multi.bind(client) : null;

    function withoutNamespace(callback) {
        return bypassNamespaceStore.run(true, callback);
    }

    const rawClientProxy = createRawClientProxy(client, withoutNamespace);

    function runWithScopedNamespace(prefix, callback) {
        return scopedNamespaceStore.run({ prefix }, callback);
    }

    function captureNamespaceInvocationContext() {
        if (bypassNamespaceStore.getStore() === true) {
            return { bypass: true };
        }

        const scopedNamespace = scopedNamespaceStore.getStore();
        if (scopedNamespace) {
            return { bypass: false, scopedPrefix: scopedNamespace.prefix };
        }

        return { bypass: false, scopedPrefix: undefined };
    }

    function runWithNamespaceInvocationContext(invocationContext, callback) {
        if (invocationContext.bypass) {
            return bypassNamespaceStore.run(true, callback);
        }

        if (invocationContext.scopedPrefix !== undefined) {
            return scopedNamespaceStore.run({ prefix: invocationContext.scopedPrefix }, callback);
        }

        return callback();
    }

    function activePrefixForInvocationContext(invocationContext) {
        if (invocationContext.bypass) {
            return "";
        }

        if (invocationContext.scopedPrefix !== undefined) {
            return invocationContext.scopedPrefix;
        }

        return namespacePrefix;
    }

    async function namespacedMultiCommands(commands, activePrefix) {
        if (!Array.isArray(commands) || commands.length === 0 || !activePrefix) {
            return commands;
        }

        if (client.isOpen) {
            await loadCommandSpecs();
        }

        let changed = false;
        const rewrittenCommands = commands.map((commandEntry) => {
            if (!commandEntry || !Array.isArray(commandEntry.args)) {
                return commandEntry;
            }

            const rewrittenArgs = namespacedArgs(commandEntry.args, activePrefix);
            if (rewrittenArgs === commandEntry.args) {
                return commandEntry;
            }

            changed = true;
            return {
                ...commandEntry,
                args: rewrittenArgs,
            };
        });

        return changed ? rewrittenCommands : commands;
    }

    function createContextualMultiExecutor(executor, invocationContext) {
        return async (commands, selectedDB) =>
            runWithNamespaceInvocationContext(invocationContext, async () => {
                const activePrefix = activePrefixForInvocationContext(invocationContext);
                const rewrittenCommands = await namespacedMultiCommands(commands, activePrefix);
                return executor(rewrittenCommands, selectedDB);
            });
    }

    async function loadCommandSpecs() {
        if (commandSpecsLoaded) {
            return;
        }

        if (loadingSpecsPromise) {
            return loadingSpecsPromise;
        }

        loadingSpecsPromise = (async () => {
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

        await loadingSpecsPromise;
        loadingSpecsPromise = null;
    }

    function namespacedArgs(args, activePrefix) {
        if (!Array.isArray(args) || !activePrefix || args.length === 0) {
            return args;
        }

        const command = commandNameToken(args[0]);
        if (!command) {
            return args;
        }

        const dynamicKeyIndexes = keyIndexesForDynamicCountCommand(command, args);
        const spec = commandSpecs.get(command);
        const keyIndexes = dynamicKeyIndexes ?? keyIndexesForCommand(spec, args);
        if (keyIndexes.length === 0) {
            return args;
        }

        const rewrittenArgs = Object.assign([...args], args);
        for (const index of keyIndexes) {
            rewrittenArgs[index] = applyPrefixToKey(rewrittenArgs[index], activePrefix);
        }

        return rewrittenArgs;
    }

    async function namespacedSendCommand(rawSender, args, options) {
        const bypassNamespace = bypassNamespaceStore.getStore() === true;
        if (bypassNamespace) {
            return rawSender(args, options);
        }

        const scopedNamespace = scopedNamespaceStore.getStore();
        const activePrefix = scopedNamespace ? scopedNamespace.prefix : namespacePrefix;
        if (!activePrefix) {
            return rawSender(args, options);
        }

        if (client.isOpen) {
            await loadCommandSpecs();
        }

        return rawSender(namespacedArgs(args, activePrefix), options);
    }

    function withNamespace(nextNamespace) {
        const normalizedNamespace = normalizeNamespace(nextNamespace);
        const scopedPrefix = normalizedNamespace ? `${normalizedNamespace}:` : "";
        const cacheKey = scopedPrefix;

        if (scopedClientCache.has(cacheKey)) {
            return scopedClientCache.get(cacheKey);
        }

        const scopedClient = createScopedNamespaceProxy({
            client,
            scopedNamespace: normalizedNamespace,
            getWithNamespace: withNamespace,
            getRawClient: () => rawClientProxy,
            withoutNamespace,
            runWithScopedNamespace: (callback) => runWithScopedNamespace(scopedPrefix, callback),
        });

        scopedClientCache.set(cacheKey, scopedClient);
        return scopedClient;
    }

    client.sendCommand = async function (args, options) {
        return namespacedSendCommand(rawClientSendCommand, args, options);
    };

    if (internalClient && internalClient !== client && typeof internalClient.sendCommand === "function") {
        internalClient.sendCommand = async function (args, options) {
            return namespacedSendCommand(rawInternalSendCommand, args, options);
        };
    }

    function createNamespacedMulti() {
        const invocationContext = captureNamespaceInvocationContext();

        if (typeof client.Multi === "function" && rawExecuteMulti && rawExecutePipeline) {
            const executeMulti = createContextualMultiExecutor(rawExecuteMulti, invocationContext);
            const executePipeline = createContextualMultiExecutor(rawExecutePipeline, invocationContext);
            return new client.Multi(executeMulti, executePipeline, client._commandOptions?.typeMapping);
        }

        if (originalMULTI) {
            return runWithNamespaceInvocationContext(invocationContext, () => originalMULTI());
        }

        if (originalMulti) {
            return runWithNamespaceInvocationContext(invocationContext, () => originalMulti());
        }

        throw new TypeError("Redis client does not support MULTI.");
    }

    if (rawExecuteMulti && rawExecutePipeline) {
        client.MULTI = createNamespacedMulti;
        client.multi = createNamespacedMulti;
    }

    if (typeof client.on === "function") {
        client.on("ready", () => {
            if (!namespacePrefix) {
                return;
            }
            void loadCommandSpecs();
        });
    }

    Object.defineProperty(client, "namespace", {
        configurable: true,
        enumerable: true,
        get() {
            return namespace || undefined;
        },
        set(value) {
            namespace = normalizeNamespace(value);
            namespacePrefix = namespace ? `${namespace}:` : "";
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
