const DEFAULT_COMMAND_SPECS = new Map([
    ["APPEND", { firstKey: 1, lastKey: 1, step: 1 }],
    ["BITCOUNT", { firstKey: 1, lastKey: 1, step: 1 }],
    ["BITFIELD", { firstKey: 1, lastKey: 1, step: 1 }],
    ["BITFIELD_RO", { firstKey: 1, lastKey: 1, step: 1 }],
    ["BITOP", { firstKey: 2, lastKey: -1, step: 1 }],
    ["BITPOS", { firstKey: 1, lastKey: 1, step: 1 }],
    ["BLMOVE", { firstKey: 1, lastKey: 2, step: 1 }],
    ["BLPOP", { firstKey: 1, lastKey: -2, step: 1 }],
    ["BRPOP", { firstKey: 1, lastKey: -2, step: 1 }],
    ["BRPOPLPUSH", { firstKey: 1, lastKey: 2, step: 1 }],
    ["BZPOPMAX", { firstKey: 1, lastKey: -2, step: 1 }],
    ["BZPOPMIN", { firstKey: 1, lastKey: -2, step: 1 }],
    ["COPY", { firstKey: 1, lastKey: 2, step: 1 }],
    ["DECR", { firstKey: 1, lastKey: 1, step: 1 }],
    ["DECRBY", { firstKey: 1, lastKey: 1, step: 1 }],
    ["DEL", { firstKey: 1, lastKey: -1, step: 1 }],
    ["DUMP", { firstKey: 1, lastKey: 1, step: 1 }],
    ["EXISTS", { firstKey: 1, lastKey: -1, step: 1 }],
    ["EXPIRE", { firstKey: 1, lastKey: 1, step: 1 }],
    ["EXPIREAT", { firstKey: 1, lastKey: 1, step: 1 }],
    ["EXPIRETIME", { firstKey: 1, lastKey: 1, step: 1 }],
    ["GEOADD", { firstKey: 1, lastKey: 1, step: 1 }],
    ["GEODIST", { firstKey: 1, lastKey: 1, step: 1 }],
    ["GEOHASH", { firstKey: 1, lastKey: 1, step: 1 }],
    ["GEOPOS", { firstKey: 1, lastKey: 1, step: 1 }],
    ["GEOSEARCH", { firstKey: 1, lastKey: 1, step: 1 }],
    ["GEOSEARCHSTORE", { firstKey: 1, lastKey: 2, step: 1 }],
    ["GET", { firstKey: 1, lastKey: 1, step: 1 }],
    ["GETBIT", { firstKey: 1, lastKey: 1, step: 1 }],
    ["GETDEL", { firstKey: 1, lastKey: 1, step: 1 }],
    ["GETEX", { firstKey: 1, lastKey: 1, step: 1 }],
    ["GETRANGE", { firstKey: 1, lastKey: 1, step: 1 }],
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
    ["HSETNX", { firstKey: 1, lastKey: 1, step: 1 }],
    ["HSTRLEN", { firstKey: 1, lastKey: 1, step: 1 }],
    ["HVALS", { firstKey: 1, lastKey: 1, step: 1 }],
    ["HRANDFIELD", { firstKey: 1, lastKey: 1, step: 1 }],
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
    ["LCS", { firstKey: 1, lastKey: 2, step: 1 }],
    ["LMOVE", { firstKey: 1, lastKey: 2, step: 1 }],
    ["MGET", { firstKey: 1, lastKey: -1, step: 1 }],
    ["MSET", { firstKey: 1, lastKey: -1, step: 2 }],
    ["MSETNX", { firstKey: 1, lastKey: -1, step: 2 }],
    ["MOVE", { firstKey: 1, lastKey: 1, step: 1 }],
    ["PFADD", { firstKey: 1, lastKey: 1, step: 1 }],
    ["PFCOUNT", { firstKey: 1, lastKey: -1, step: 1 }],
    ["PFMERGE", { firstKey: 1, lastKey: -1, step: 1 }],
    ["PERSIST", { firstKey: 1, lastKey: 1, step: 1 }],
    ["PEXPIRE", { firstKey: 1, lastKey: 1, step: 1 }],
    ["PEXPIREAT", { firstKey: 1, lastKey: 1, step: 1 }],
    ["PEXPIRETIME", { firstKey: 1, lastKey: 1, step: 1 }],
    ["PSETEX", { firstKey: 1, lastKey: 1, step: 1 }],
    ["PTTL", { firstKey: 1, lastKey: 1, step: 1 }],
    ["RENAME", { firstKey: 1, lastKey: 2, step: 1 }],
    ["RENAMENX", { firstKey: 1, lastKey: 2, step: 1 }],
    ["RESTORE", { firstKey: 1, lastKey: 1, step: 1 }],
    ["RESTORE-ASKING", { firstKey: 1, lastKey: 1, step: 1 }],
    ["RPOP", { firstKey: 1, lastKey: 1, step: 1 }],
    ["RPOPLPUSH", { firstKey: 1, lastKey: 2, step: 1 }],
    ["RPUSH", { firstKey: 1, lastKey: 1, step: 1 }],
    ["RPUSHX", { firstKey: 1, lastKey: 1, step: 1 }],
    ["SADD", { firstKey: 1, lastKey: 1, step: 1 }],
    ["SCARD", { firstKey: 1, lastKey: 1, step: 1 }],
    ["SDIFF", { firstKey: 1, lastKey: -1, step: 1 }],
    ["SDIFFSTORE", { firstKey: 1, lastKey: -1, step: 1 }],
    ["SET", { firstKey: 1, lastKey: 1, step: 1 }],
    ["SETBIT", { firstKey: 1, lastKey: 1, step: 1 }],
    ["SETEX", { firstKey: 1, lastKey: 1, step: 1 }],
    ["SETNX", { firstKey: 1, lastKey: 1, step: 1 }],
    ["SETRANGE", { firstKey: 1, lastKey: 1, step: 1 }],
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
    ["SUBSTR", { firstKey: 1, lastKey: 1, step: 1 }],
    ["SUNION", { firstKey: 1, lastKey: -1, step: 1 }],
    ["SUNIONSTORE", { firstKey: 1, lastKey: -1, step: 1 }],
    ["TOUCH", { firstKey: 1, lastKey: -1, step: 1 }],
    ["TTL", { firstKey: 1, lastKey: 1, step: 1 }],
    ["TYPE", { firstKey: 1, lastKey: 1, step: 1 }],
    ["UNLINK", { firstKey: 1, lastKey: -1, step: 1 }],
    ["WATCH", { firstKey: 1, lastKey: -1, step: 1 }],
    ["XACK", { firstKey: 1, lastKey: 1, step: 1 }],
    ["XADD", { firstKey: 1, lastKey: 1, step: 1 }],
    ["XAUTOCLAIM", { firstKey: 1, lastKey: 1, step: 1 }],
    ["XCLAIM", { firstKey: 1, lastKey: 1, step: 1 }],
    ["XDEL", { firstKey: 1, lastKey: 1, step: 1 }],
    ["XLEN", { firstKey: 1, lastKey: 1, step: 1 }],
    ["XPENDING", { firstKey: 1, lastKey: 1, step: 1 }],
    ["XRANGE", { firstKey: 1, lastKey: 1, step: 1 }],
    ["XREVRANGE", { firstKey: 1, lastKey: 1, step: 1 }],
    ["XSETID", { firstKey: 1, lastKey: 1, step: 1 }],
    ["XTRIM", { firstKey: 1, lastKey: 1, step: 1 }],
    ["ZADD", { firstKey: 1, lastKey: 1, step: 1 }],
    ["ZCARD", { firstKey: 1, lastKey: 1, step: 1 }],
    ["ZCOUNT", { firstKey: 1, lastKey: 1, step: 1 }],
    ["ZINCRBY", { firstKey: 1, lastKey: 1, step: 1 }],
    ["ZLEXCOUNT", { firstKey: 1, lastKey: 1, step: 1 }],
    ["ZMSCORE", { firstKey: 1, lastKey: 1, step: 1 }],
    ["ZPOPMAX", { firstKey: 1, lastKey: 1, step: 1 }],
    ["ZPOPMIN", { firstKey: 1, lastKey: 1, step: 1 }],
    ["ZRANDMEMBER", { firstKey: 1, lastKey: 1, step: 1 }],
    ["ZRANGE", { firstKey: 1, lastKey: 1, step: 1 }],
    ["ZRANGEBYSCORE", { firstKey: 1, lastKey: 1, step: 1 }],
    ["ZRANGESTORE", { firstKey: 1, lastKey: 2, step: 1 }],
    ["ZRANK", { firstKey: 1, lastKey: 1, step: 1 }],
    ["ZREM", { firstKey: 1, lastKey: 1, step: 1 }],
    ["ZREMRANGEBYLEX", { firstKey: 1, lastKey: 1, step: 1 }],
    ["ZREMRANGEBYRANK", { firstKey: 1, lastKey: 1, step: 1 }],
    ["ZREMRANGEBYSCORE", { firstKey: 1, lastKey: 1, step: 1 }],
    ["ZREVRANGE", { firstKey: 1, lastKey: 1, step: 1 }],
    ["ZREVRANGEBYSCORE", { firstKey: 1, lastKey: 1, step: 1 }],
    ["ZREVRANK", { firstKey: 1, lastKey: 1, step: 1 }],
    ["ZSCAN", { firstKey: 1, lastKey: 1, step: 1 }],
    ["ZSCORE", { firstKey: 1, lastKey: 1, step: 1 }],
]);

const DESTRUCTIVE_DATABASE_COMMANDS = new Set(["FLUSHALL", "FLUSHDB", "SWAPDB"]);
const DYNAMIC_KEY_COUNT_COMMANDS = new Set([
    "EVAL",
    "EVAL_RO",
    "EVALSHA",
    "EVALSHA_RO",
    "FCALL",
    "FCALL_RO",
]);
const COUNTED_KEY_COMMAND_SPECS = new Map([
    ["BLMPOP", { countIndex: 2, firstKeyIndex: 3 }],
    ["BZMPOP", { countIndex: 2, firstKeyIndex: 3 }],
    ["LMPOP", { countIndex: 1, firstKeyIndex: 2 }],
    ["MSETEX", { countIndex: 1, firstKeyIndex: 2, keyStep: 2 }],
    ["SINTERCARD", { countIndex: 1, firstKeyIndex: 2 }],
    ["ZDIFF", { countIndex: 1, firstKeyIndex: 2 }],
    ["ZDIFFSTORE", { countIndex: 2, firstKeyIndex: 3, fixedKeyIndexes: [1] }],
    ["ZINTER", { countIndex: 1, firstKeyIndex: 2 }],
    ["ZINTERCARD", { countIndex: 1, firstKeyIndex: 2 }],
    ["ZINTERSTORE", { countIndex: 2, firstKeyIndex: 3, fixedKeyIndexes: [1] }],
    ["ZMPOP", { countIndex: 1, firstKeyIndex: 2 }],
    ["ZUNION", { countIndex: 1, firstKeyIndex: 2 }],
    ["ZUNIONSTORE", { countIndex: 2, firstKeyIndex: 3, fixedKeyIndexes: [1] }],
]);
const DEFAULT_KEYLESS_COMMANDS = new Set([
    "ACL",
    "ASKING",
    "AUTH",
    "CLIENT",
    "CLUSTER",
    "COMMAND",
    "CONFIG",
    "DBSIZE",
    "DISCARD",
    "ECHO",
    "EXEC",
    "FUNCTION",
    "HELLO",
    "INFO",
    "KEYS",
    "LASTSAVE",
    "LATENCY",
    "MODULE",
    "MONITOR",
    "MULTI",
    "PING",
    "PSUBSCRIBE",
    "PUBLISH",
    "PUBSUB",
    "PUNSUBSCRIBE",
    "QUIT",
    "RANDOMKEY",
    "READONLY",
    "READWRITE",
    "ROLE",
    "SCAN",
    "SCRIPT",
    "SELECT",
    "SLOWLOG",
    "SPUBLISH",
    "SSUBSCRIBE",
    "SUBSCRIBE",
    "SUNSUBSCRIBE",
    "TIME",
    "UNSUBSCRIBE",
    "UNWATCH",
    "WAIT",
    "WAITAOF",
]);

/**
 * Extracts an uppercase command name from a string or Buffer token.
 * @param {string|Buffer} token - First element of a Redis command args array.
 * @returns {string} Uppercase command name, or empty string for unsupported types.
 */
function commandNameToken(token) {
    if (typeof token === "string") {
        return token.toUpperCase();
    }
    if (Buffer.isBuffer(token)) {
        return token.toString("utf8").toUpperCase();
    }
    return "";
}

/**
 * Parses the raw reply from the Redis COMMAND introspection into a Map of
 * command specs keyed by uppercase command name.
 * @param {Array<Array>} reply - Raw COMMAND reply from Redis.
 * @returns {Map<string, object>} Map of command name to key-position spec.
 */
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
        const flags = Array.isArray(entry[2]) ? entry[2].map(commandNameToken) : [];

        if (
            !name ||
            !Number.isFinite(firstKey) ||
            !Number.isFinite(lastKey) ||
            !Number.isFinite(step)
        ) {
            continue;
        }

        specs.set(name, {
            firstKey,
            lastKey,
            step,
            movableKeys: flags.includes("MOVABLEKEYS"),
        });
    }

    return specs;
}

/**
 * Computes the argument indexes that contain Redis keys for a given command
 * spec and argument list.
 * @param {object} spec - Key-position spec with firstKey, lastKey, and step.
 * @param {Array<*>} args - Full command arguments array (command name at index 0).
 * @returns {Array<number>} Indexes into args that hold key values.
 */
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

/**
 * Coerces a command argument token to a safe integer value.
 * Handles strings, Buffers, numbers, and BigInts. Returns null when the
 * token cannot be represented as a finite integer within safe bounds.
 * @param {string|Buffer|number|bigint} token - Redis command argument.
 * @returns {number|null} Integer value, or null if conversion fails.
 */
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

    const tokenValue = Buffer.isBuffer(token)
        ? token.toString("utf8")
        : typeof token === "string"
          ? token
          : null;
    if (tokenValue === null || tokenValue.length === 0) {
        return null;
    }

    const parsed = Number.parseInt(tokenValue, 10);
    return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Returns key indexes for commands that encode their key count as a runtime
 * argument (EVAL, EVALSHA, FCALL and their read-only variants).
 * @param {string} command - Uppercase command name.
 * @param {Array<*>} args - Full command arguments array.
 * @returns {Array<number>|null} Key indexes, or null when the command is not dynamic.
 */
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

/**
 * Returns key indexes for commands whose arguments include an explicit key count.
 * @param {Array<*>} args - Full command arguments array.
 * @param {object} spec - Count position, first key position, and any fixed key positions.
 * @returns {Array<number>} Key indexes described by the command arguments.
 */
function keyIndexesForCountedCommand(args, spec) {
    if (!Array.isArray(args)) {
        return [];
    }

    const keyCount = integerTokenValue(args[spec.countIndex]);
    if (keyCount === null || keyCount <= 0) {
        return spec.fixedKeyIndexes ? [...spec.fixedKeyIndexes] : [];
    }

    const keyStep = spec.keyStep ?? 1;
    const availableKeys = Math.max(0, Math.ceil((args.length - spec.firstKeyIndex) / keyStep));
    const actualKeyCount = Math.min(keyCount, availableKeys);
    const indexes = spec.fixedKeyIndexes ? [...spec.fixedKeyIndexes] : [];
    for (let offset = 0; offset < actualKeyCount; offset += 1) {
        indexes.push(spec.firstKeyIndex + offset * keyStep);
    }
    return indexes;
}

/**
 * Returns the stream-key indexes from XREAD and XREADGROUP arguments.
 * @param {string} command - XREAD or XREADGROUP.
 * @param {Array<*>} args - Full command arguments array.
 * @returns {Array<number>} Stream key indexes.
 */
function keyIndexesForStreamRead(command, args) {
    let index = command === "XREADGROUP" ? 4 : 1;
    while (index < args.length) {
        const token = commandNameToken(args[index]);
        if (token === "STREAMS") {
            const firstKeyIndex = index + 1;
            const remainingArgumentCount = args.length - firstKeyIndex;
            const keyCount = Math.floor(remainingArgumentCount / 2);
            return Array.from({ length: keyCount }, (_, offset) => firstKeyIndex + offset);
        }

        // COUNT and BLOCK are the only valued options before STREAMS; NOACK
        // (XREADGROUP) is a bare token handled by the single-step advance.
        if (token === "COUNT" || token === "BLOCK") {
            index += 2;
            continue;
        }
        index += 1;
    }
    return [];
}

/**
 * Returns key indexes for SORT, including external-key patterns and STORE.
 * @param {Array<*>} args - Full SORT command arguments.
 * @returns {Array<number>} Source, pattern, and destination key indexes.
 */
function keyIndexesForSort(args) {
    if (args.length <= 1) {
        return [];
    }

    const indexes = [1];
    for (let index = 2; index < args.length - 1; index += 1) {
        const token = commandNameToken(args[index]);
        if (token !== "BY" && token !== "GET" && token !== "STORE") {
            continue;
        }

        const keyIndex = index + 1;
        const keyToken = commandNameToken(args[keyIndex]);
        const isSpecialPattern =
            (token === "GET" && keyToken === "#") || (token === "BY" && keyToken === "NOSORT");
        if (!isSpecialPattern) {
            indexes.push(keyIndex);
        }
        index = keyIndex;
    }
    return indexes;
}

/**
 * Returns key indexes for MIGRATE without confusing AUTH values for keywords.
 * @param {Array<*>} args - Full MIGRATE command arguments.
 * @returns {Array<number>} Source key indexes.
 */
function keyIndexesForMigrate(args) {
    if (args.length <= 3) {
        return [];
    }

    const key = args[3];
    const keyIsEmpty = Buffer.isBuffer(key) ? key.length === 0 : key === "";
    if (!keyIsEmpty) {
        return [3];
    }

    let index = 6;
    while (index < args.length) {
        const token = commandNameToken(args[index]);
        if (token === "KEYS") {
            return Array.from(
                { length: args.length - index - 1 },
                (_, offset) => index + offset + 1,
            );
        }
        if (token === "AUTH") {
            index += 2;
            continue;
        }
        if (token === "AUTH2") {
            index += 3;
            continue;
        }
        index += 1;
    }
    return [];
}

/**
 * Returns optional destination indexes for the legacy GEORADIUS commands.
 * @param {string} command - GEORADIUS or GEORADIUSBYMEMBER.
 * @param {Array<*>} args - Full command arguments array.
 * @returns {Array<number>} Source and optional destination key indexes.
 */
function keyIndexesForGeoRadius(command, args) {
    if (args.length <= 1) {
        return [];
    }

    const indexes = [1];
    const optionsStartIndex = command === "GEORADIUS" ? 6 : 5;
    for (let index = optionsStartIndex; index < args.length - 1; index += 1) {
        const token = commandNameToken(args[index]);
        if (token === "STORE" || token === "STOREDIST") {
            indexes.push(index + 1);
            ++index;
        }
    }
    return indexes;
}

/**
 * Resolves commands whose key positions cannot be represented by first/last/step.
 * Returns null when no local resolver exists so server-discovered movable commands
 * can fail closed rather than execute against un-prefixed keys.
 * @param {string} command - Uppercase command name.
 * @param {Array<*>} args - Full command arguments array.
 * @returns {Array<number>|null} Key indexes, or null when unsupported locally.
 */
function keyIndexesForMovableCommand(command, args) {
    const countedSpec = COUNTED_KEY_COMMAND_SPECS.get(command);
    if (countedSpec) {
        return keyIndexesForCountedCommand(args, countedSpec);
    }

    if (command === "XREAD" || command === "XREADGROUP") {
        return keyIndexesForStreamRead(command, args);
    }
    if (command === "SORT" || command === "SORT_RO") {
        return keyIndexesForSort(args);
    }
    if (command === "MIGRATE") {
        return keyIndexesForMigrate(args);
    }
    if (command === "GEORADIUS" || command === "GEORADIUSBYMEMBER") {
        return keyIndexesForGeoRadius(command, args);
    }
    if (command === "XGROUP") {
        return commandNameToken(args[1]) === "HELP" || args.length <= 2 ? [] : [2];
    }
    if (command === "XINFO") {
        return commandNameToken(args[1]) === "HELP" || args.length <= 2 ? [] : [2];
    }
    if (command === "OBJECT" || command === "MEMORY") {
        return args.length > 2 ? [2] : [];
    }

    return null;
}

/**
 * Prepends a namespace prefix to a Redis key. Supports string, number, bigint,
 * and Buffer keys. A key that already contains the namespace text is still a
 * distinct logical key and receives the prefix like any other key.
 * @param {string|Buffer|number|bigint} key - Original key value.
 * @param {string} prefix - Namespace prefix including trailing colon.
 * @param {Buffer} [prefixBuffer] - Pre-allocated Buffer of the prefix for Buffer keys.
 * @returns {string|Buffer} Prefixed key, or the original when the prefix is empty.
 */
function applyPrefixToKey(key, prefix, prefixBuffer) {
    if (!prefix) {
        return key;
    }

    if (Buffer.isBuffer(key)) {
        if (!prefixBuffer) {
            prefixBuffer = Buffer.from(prefix);
        }
        return Buffer.concat([prefixBuffer, key]);
    }

    const keyString =
        typeof key === "string"
            ? key
            : typeof key === "number" || typeof key === "bigint"
              ? String(key)
              : null;

    if (keyString === null) {
        return key;
    }

    return `${prefix}${keyString}`;
}

export {
    applyPrefixToKey,
    commandNameToken,
    DEFAULT_COMMAND_SPECS,
    DEFAULT_KEYLESS_COMMANDS,
    DESTRUCTIVE_DATABASE_COMMANDS,
    keyIndexesForCommand,
    keyIndexesForDynamicCountCommand,
    keyIndexesForMovableCommand,
    parseCommandSpecs,
};
