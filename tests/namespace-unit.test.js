import assert from "node:assert/strict";
import { test } from "node:test";

import { attachNamespace } from "../src/namespace.js";

function createFakeClient({ commandResponse, isOpen = true } = {}) {
    const listeners = new Map();
    const calls = [];

    class FakeMulti {
        constructor(executeMulti, executePipeline) {
            this.executeMulti = executeMulti;
            this.executePipeline = executePipeline;
            this.queue = [];
        }

        addCommand(args) {
            this.queue.push({ args });
            return this;
        }

        set(key, value) {
            return this.addCommand(["SET", key, value]);
        }

        get(key) {
            return this.addCommand(["GET", key]);
        }

        eval(script, options = {}) {
            const keys = Array.isArray(options.keys) ? options.keys : [];
            const scriptArgs = Array.isArray(options.arguments) ? options.arguments : [];
            return this.addCommand(["EVAL", script, String(keys.length), ...keys, ...scriptArgs]);
        }

        exec() {
            return this.executeMulti(this.queue);
        }

        execAsPipeline() {
            return this.executePipeline(this.queue);
        }
    }

    const client = {
        isOpen,
        _commandOptions: {},
        Multi: FakeMulti,
        on(event, handler) {
            listeners.set(event, handler);
        },
        async get(key) {
            return this.sendCommand(["GET", key]);
        },
        async set(key, value) {
            return this.sendCommand(["SET", key, value]);
        },
        async *hScanIterator(key) {
            const reply = await this.sendCommand(["HSCAN", key, "0"]);
            yield reply.args[1];
        },
        namespaceSnapshot() {
            return this.namespace;
        },
        async _executeMulti(commands) {
            const replies = [];
            for (const command of commands) {
                replies.push(await this.sendCommand(command.args));
            }
            return replies;
        },
        async _executePipeline(commands) {
            return this._executeMulti(commands);
        },
        MULTI() {
            return new this.Multi(this._executeMulti.bind(this), this._executePipeline.bind(this));
        },
        multi() {
            return this.MULTI();
        },
        async sendCommand(args, options) {
            calls.push({ args, options });
            const command = String(args?.[0] ?? "").toUpperCase();

            if (command === "COMMAND") {
                const response =
                    typeof commandResponse === "function" ? commandResponse() : commandResponse;
                if (response instanceof Error) {
                    throw response;
                }
                return response ?? [];
            }

            return { args, options };
        },
    };

    return { client, calls, listeners };
}

function createSelfRoutedFakeClient({ commandResponse, isOpen = true } = {}) {
    const listeners = new Map();
    const calls = [];

    const internalClient = {
        isOpen,
        async sendCommand(args, options) {
            calls.push({ args, options });
            const command = String(args?.[0] ?? "").toUpperCase();

            if (command === "COMMAND") {
                if (commandResponse instanceof Error) {
                    throw commandResponse;
                }
                return commandResponse ?? [];
            }

            return { args, options };
        },
    };

    const client = {
        isOpen,
        _self: internalClient,
        on(event, handler) {
            listeners.set(event, handler);
        },
        async get(key) {
            return this._self.sendCommand(["GET", key]);
        },
        async set(key, value) {
            return this._self.sendCommand(["SET", key, value]);
        },
        async sendCommand(args, options) {
            return this._self.sendCommand(args, options);
        },
    };

    return { client, calls, listeners };
}

function createPublicMultiOnlyFakeClient({ commandResponse, isOpen = true } = {}) {
    const listeners = new Map();
    const calls = [];

    class FakePublicMulti {
        constructor(sender) {
            this.sender = sender;
            this.queue = [];
        }

        addCommand(args) {
            this.queue.push(args);
            return this;
        }

        set(key, value) {
            return this.addCommand(["SET", key, value]);
        }

        get(key) {
            return this.addCommand(["GET", key]);
        }

        sendCommand(args) {
            this.queue.push(Array.isArray(args) ? args.slice() : args);
            return this;
        }

        rawBypassCommand(args) {
            this.queue.push(Array.isArray(args) ? args.slice() : args);
            return this;
        }

        async exec() {
            const replies = [];
            for (const args of this.queue) {
                replies.push(await this.sender(args));
            }
            return replies;
        }

        execAsPipeline() {
            return this.exec();
        }
    }

    const client = {
        isOpen,
        on(event, handler) {
            listeners.set(event, handler);
        },
        async get(key) {
            return this.sendCommand(["GET", key]);
        },
        async set(key, value) {
            return this.sendCommand(["SET", key, value]);
        },
        MULTI() {
            return new FakePublicMulti((args) => this.sendCommand(args));
        },
        multi() {
            return this.MULTI();
        },
        async sendCommand(args, options) {
            calls.push({ args, options });
            const command = String(args?.[0] ?? "").toUpperCase();

            if (command === "COMMAND") {
                if (commandResponse instanceof Error) {
                    throw commandResponse;
                }
                return commandResponse ?? [];
            }

            return { args, options };
        },
    };

    return { client, calls, listeners };
}

function createUnsupportedDispatchFakeClient() {
    const listeners = new Map();
    const internalClient = {};

    const client = {
        isOpen: true,
        _self: internalClient,
        on(event, handler) {
            listeners.set(event, handler);
        },
        async sendCommand(args, options) {
            return { args, options };
        },
    };

    return { client, listeners };
}

test("attachNamespace prefixes command keys and supports runtime namespace updates", async () => {
    const { client, calls } = createFakeClient({
        commandResponse: [
            ["get", 2, ["readonly"], 1, 1, 1],
            ["set", -3, ["write"], 1, 1, 1],
            ["del", -2, ["write"], 1, -1, 1],
        ],
    });

    attachNamespace(client, "codex");
    assert.equal(client.namespace, "codex");

    await client.sendCommand(["SET", "counter", "1"]);
    await client.sendCommand(["DEL", "a", "b"]);

    assert.deepEqual(calls[0].args, ["COMMAND"]);
    assert.deepEqual(calls[1].args, ["SET", "codex:counter", "1"]);
    assert.deepEqual(calls[2].args, ["DEL", "codex:a", "codex:b"]);

    client.namespace = "romulan:";
    assert.equal(client.namespace, "romulan");

    await client.sendCommand(["GET", "romulan:counter"]);
    assert.deepEqual(calls[3].args, ["GET", "romulan:romulan:counter"]);

    client.namespace = "";
    assert.equal(client.namespace, undefined);
    await client.sendCommand(["SET", "counter", "2"]);
    assert.deepEqual(calls[4].args, ["SET", "counter", "2"]);
});

test("attachNamespace prefixes generated command methods routed through public sendCommand", async () => {
    const { client, calls } = createFakeClient({
        commandResponse: [
            ["get", 2, ["readonly"], 1, 1, 1],
            ["set", -3, ["write"], 1, 1, 1],
        ],
    });

    attachNamespace(client, "codex");

    await client.set("planet", "earth");
    await client.get("planet");

    assert.deepEqual(calls[0].args, ["COMMAND"]);
    assert.deepEqual(calls[1].args, ["SET", "codex:planet", "earth"]);
    assert.deepEqual(calls[2].args, ["GET", "codex:planet"]);
});

test("attachNamespace exposes raw and withoutNamespace bypass helpers", async () => {
    const { client, calls } = createFakeClient({
        commandResponse: [
            ["get", 2, ["readonly"], 1, 1, 1],
            ["set", -3, ["write"], 1, 1, 1],
        ],
    });

    attachNamespace(client, "codex");

    await client.set("planet", "mars");
    await client.raw.set("planet", "earth");
    await client.withoutNamespace(async () => {
        await client.get("planet");
    });
    await client.get("planet");

    assert.deepEqual(calls[0].args, ["COMMAND"]);
    assert.deepEqual(calls[1].args, ["SET", "codex:planet", "mars"]);
    assert.deepEqual(calls[2].args, ["SET", "planet", "earth"]);
    assert.deepEqual(calls[3].args, ["GET", "planet"]);
    assert.deepEqual(calls[4].args, ["GET", "codex:planet"]);
});

test("withNamespace scopes key prefixes without mutating global namespace", async () => {
    const { client, calls } = createFakeClient({
        commandResponse: [
            ["get", 2, ["readonly"], 1, 1, 1],
            ["set", -3, ["write"], 1, 1, 1],
        ],
    });

    attachNamespace(client, "global");

    const tenantA = client.withNamespace("alpha");
    const tenantB = client.withNamespace("beta");
    const tenantBAgain = tenantA.withNamespace("beta");

    assert.equal(client.namespace, "global");
    assert.equal(tenantA.namespace, "alpha");
    assert.equal(tenantB.namespace, "beta");
    assert.equal(tenantB, tenantBAgain);
    assert.equal(tenantA, client.withNamespace("alpha"));

    await tenantA.set("shared-key", "one");
    await tenantB.set("shared-key", "two");
    await client.set("shared-key", "base");

    assert.deepEqual(calls[0].args, ["COMMAND"]);
    assert.deepEqual(calls[1].args, ["SET", "alpha:shared-key", "one"]);
    assert.deepEqual(calls[2].args, ["SET", "beta:shared-key", "two"]);
    assert.deepEqual(calls[3].args, ["SET", "global:shared-key", "base"]);
    assert.equal(client.namespace, "global");
});

test("withNamespace normalizes namespace input and supports unscoped clients", async () => {
    const { client, calls } = createFakeClient({
        commandResponse: [["get", 2, ["readonly"], 1, 1, 1]],
    });

    attachNamespace(client, "global");

    const normalized = client.withNamespace("romulan:");
    const unscopedEmpty = client.withNamespace("");
    const unscopedUndefined = client.withNamespace(undefined);

    assert.equal(normalized.namespace, "romulan");
    assert.equal(unscopedEmpty.namespace, undefined);
    assert.equal(unscopedUndefined.namespace, undefined);
    assert.equal(unscopedEmpty, unscopedUndefined);

    await normalized.get("status");
    await unscopedEmpty.get("status");
    await unscopedUndefined.get("health");

    assert.deepEqual(calls[0].args, ["COMMAND"]);
    assert.deepEqual(calls[1].args, ["GET", "romulan:status"]);
    assert.deepEqual(calls[2].args, ["GET", "status"]);
    assert.deepEqual(calls[3].args, ["GET", "health"]);
    assert.equal(client.namespace, "global");
});

test("namespace values reserve embedded colons to prevent cross-scope key collisions", () => {
    const { client: invalidInitialClient } = createFakeClient();
    assert.throws(() => attachNamespace(invalidInitialClient, "alpha:beta"), {
        name: "TypeError",
        message: "Redis namespace must not contain ':'",
    });

    const { client } = createFakeClient();
    attachNamespace(client, "global");

    assert.throws(() => client.withNamespace("alpha:beta"), {
        name: "TypeError",
        message: "Redis namespace must not contain ':'",
    });
    assert.throws(() => {
        client.namespace = "alpha:beta";
    }, TypeError);
    assert.equal(client.namespace, "global");
});

test("withNamespace cache evicts least recently used scoped clients", () => {
    const { client } = createFakeClient();
    const scopedCacheLimit = 256;

    attachNamespace(client, "global");

    const namespaceZero = client.withNamespace("ns-0");
    const namespaceOne = client.withNamespace("ns-1");

    for (let index = 2; index < scopedCacheLimit; index += 1) {
        client.withNamespace(`ns-${index}`);
    }

    assert.equal(namespaceZero, client.withNamespace("ns-0"));

    client.withNamespace(`ns-${scopedCacheLimit}`);

    const namespaceOneAgain = client.withNamespace("ns-1");
    assert.notEqual(namespaceOneAgain, namespaceOne);
    assert.equal(namespaceZero, client.withNamespace("ns-0"));
});

test("scoped clients keep raw and withoutNamespace unprefixed and reject namespace assignment", async () => {
    const { client, calls } = createFakeClient({
        commandResponse: [["get", 2, ["readonly"], 1, 1, 1]],
    });

    attachNamespace(client, "global");
    const scoped = client.withNamespace("codex");

    assert.equal(scoped.namespace, "codex");
    assert.throws(
        () => {
            scoped.namespace = "klingon";
        },
        {
            name: "TypeError",
            message: "Cannot assign namespace on scoped client. Use withNamespace().",
        },
    );

    await scoped.get("status");
    await scoped.raw.get("status");
    await scoped.withoutNamespace(async () => {
        await scoped.get("status");
    });

    assert.deepEqual(calls[0].args, ["COMMAND"]);
    assert.deepEqual(calls[1].args, ["GET", "codex:status"]);
    assert.deepEqual(calls[2].args, ["GET", "status"]);
    assert.deepEqual(calls[3].args, ["GET", "status"]);
});

test("scoped and raw async iterators restore their namespace context for every page", async () => {
    const { client, calls } = createFakeClient({
        commandResponse: [["hscan", -3, ["readonly"], 1, 1, 1]],
    });

    attachNamespace(client, "global");
    const scopedIterator = client.withNamespace("alpha").hScanIterator("hash");
    const rawIterator = client.raw.hScanIterator("hash");

    assert.deepEqual(await scopedIterator.next(), { value: "alpha:hash", done: false });
    assert.deepEqual(await rawIterator.next(), { value: "hash", done: false });

    assert.deepEqual(calls[0].args, ["COMMAND"]);
    assert.deepEqual(calls[1].args, ["HSCAN", "alpha:hash", "0"]);
    assert.deepEqual(calls[2].args, ["HSCAN", "hash", "0"]);
});

test("methods invoked through scoped and raw clients observe their active namespace", () => {
    const { client } = createFakeClient();

    attachNamespace(client, "global");

    assert.equal(client.namespaceSnapshot(), "global");
    assert.equal(client.withNamespace("alpha").namespaceSnapshot(), "alpha");
    assert.equal(client.raw.namespaceSnapshot(), undefined);
});

test("keys containing namespace text remain distinct logical string and Buffer keys", async () => {
    const { client, calls } = createFakeClient({
        commandResponse: [["get", 2, ["readonly"], 1, 1, 1]],
    });

    attachNamespace(client, "alpha");

    await client.sendCommand(["GET", "alpha:key"]);
    await client.sendCommand(["GET", Buffer.from("alpha:key")]);

    assert.deepEqual(calls[1].args, ["GET", "alpha:alpha:key"]);
    assert.deepEqual(calls[2].args, ["GET", Buffer.from("alpha:alpha:key")]);
});

test("withNamespace applies scoped context to multi exec and execAsPipeline", async () => {
    const { client, calls } = createFakeClient({
        commandResponse: [
            ["get", 2, ["readonly"], 1, 1, 1],
            ["set", -3, ["write"], 1, 1, 1],
        ],
    });

    attachNamespace(client, "global");
    const scoped = client.withNamespace("alpha");

    const transaction = scoped.multi();
    transaction.set("planet", "mars").get("planet");
    await transaction.exec();

    const pipeline = scoped.multi();
    pipeline.set("moon", "europa").get("moon");
    await pipeline.execAsPipeline();

    assert.deepEqual(calls[0].args, ["COMMAND"]);
    assert.deepEqual(calls[1].args, ["SET", "alpha:planet", "mars"]);
    assert.deepEqual(calls[2].args, ["GET", "alpha:planet"]);
    assert.deepEqual(calls[3].args, ["SET", "alpha:moon", "europa"]);
    assert.deepEqual(calls[4].args, ["GET", "alpha:moon"]);
    assert.equal(client.namespace, "global");
});

test("withNamespace multi prefixes keys without relying on _execute* internals", async () => {
    const { client, calls } = createPublicMultiOnlyFakeClient({
        commandResponse: [
            ["get", 2, ["readonly"], 1, 1, 1],
            ["set", -3, ["write"], 1, 1, 1],
        ],
    });

    attachNamespace(client, "global");
    const scoped = client.withNamespace("alpha");
    const transaction = scoped.multi();

    transaction.set("planet", "mars").get("planet");
    await transaction.exec();

    const rawTransaction = scoped.raw.multi();
    rawTransaction.set("planet", "earth").get("planet");
    await rawTransaction.execAsPipeline();

    assert.deepEqual(calls[0].args, ["COMMAND"]);
    assert.deepEqual(calls[1].args, ["SET", "alpha:planet", "mars"]);
    assert.deepEqual(calls[2].args, ["GET", "alpha:planet"]);
    assert.deepEqual(calls[3].args, ["SET", "planet", "earth"]);
    assert.deepEqual(calls[4].args, ["GET", "planet"]);
});

test("multi waits for command specs before rewriting server-discovered commands", async () => {
    const { client, calls } = createPublicMultiOnlyFakeClient({
        commandResponse: [["customkey", 2, ["readonly"], 1, 1, 1]],
    });

    attachNamespace(client, "global");
    const transaction = client.withNamespace("alpha").multi();

    transaction.addCommand(["CUSTOMKEY", "new"]);
    assert.equal(calls.length, 0);

    await transaction.exec();

    assert.deepEqual(calls[0].args, ["COMMAND"]);
    assert.deepEqual(calls[1].args, ["CUSTOMKEY", "alpha:new"]);
});

test("multi addCommand does not mutate the caller's argument array on deferred rewrites", async () => {
    const { client, calls } = createPublicMultiOnlyFakeClient({
        commandResponse: [["set", -3, ["write"], 1, 1, 1]],
    });

    attachNamespace(client, "global");
    const transaction = client.withNamespace("alpha").multi();

    const callerArgs = ["SET", "planet", "mars"];
    transaction.addCommand(callerArgs);
    await transaction.exec();

    assert.deepEqual(callerArgs, ["SET", "planet", "mars"]);
    assert.deepEqual(calls[0].args, ["COMMAND"]);
    assert.deepEqual(calls[1].args, ["SET", "alpha:planet", "mars"]);

    // Re-adding the same caller array must not double-prefix.
    const retryTransaction = client.withNamespace("alpha").multi();
    retryTransaction.addCommand(callerArgs);
    await retryTransaction.exec();

    assert.deepEqual(callerArgs, ["SET", "planet", "mars"]);
    assert.deepEqual(calls[2].args, ["SET", "alpha:planet", "mars"]);
});

test("multi sendCommand uses the captured namespace context", async () => {
    const { client, calls } = createPublicMultiOnlyFakeClient({
        commandResponse: [["get", 2, ["readonly"], 1, 1, 1]],
    });

    attachNamespace(client, "global");
    const transaction = client.withNamespace("alpha").multi();

    transaction.sendCommand(["GET", "planet"]);
    await transaction.execAsPipeline();

    assert.deepEqual(calls[0].args, ["COMMAND"]);
    assert.deepEqual(calls[1].args, ["GET", "alpha:planet"]);
});

test("multi sendCommand forwards additional parameters to addCommand", async () => {
    const { client } = createPublicMultiOnlyFakeClient({
        commandResponse: [["get", 2, ["readonly"], 1, 1, 1]],
    });
    const addCommandParameters = [];
    const transformReply = (reply) => reply;

    attachNamespace(client, "global");
    const transaction = client.withNamespace("alpha").multi();
    const rawAddCommand = transaction.addCommand.bind(transaction);
    transaction.addCommand = (...parameters) => {
        addCommandParameters.push(parameters);
        return rawAddCommand(...parameters);
    };

    transaction.sendCommand(["GET", "planet"], transformReply);

    assert.equal(addCommandParameters.length, 1);
    assert.deepEqual(addCommandParameters[0][0], ["GET", "planet"]);
    assert.equal(addCommandParameters[0][1], transformReply);
});

test("multi preserves queue order while waiting for command specs", async () => {
    const { client, calls } = createPublicMultiOnlyFakeClient({
        commandResponse: [
            ["get", 2, ["readonly"], 1, 1, 1],
            ["set", -3, ["write"], 1, 1, 1],
        ],
    });

    attachNamespace(client, "global");
    const transaction = client.withNamespace("alpha").multi();

    transaction.set("first", "1");
    transaction.rawBypassCommand(["PING"]);
    transaction.get("second");
    await transaction.exec();

    assert.deepEqual(calls[0].args, ["COMMAND"]);
    assert.deepEqual(calls[1].args, ["SET", "alpha:first", "1"]);
    assert.deepEqual(calls[2].args, ["PING"]);
    assert.deepEqual(calls[3].args, ["GET", "alpha:second"]);
});

test("multi retry remains fail-closed after a deferred rewrite failure", async () => {
    const { client, calls } = createPublicMultiOnlyFakeClient({ commandResponse: [] });

    attachNamespace(client, "global");
    const transaction = client.withNamespace("alpha").multi();

    transaction.addCommand(["FUTUREMOVE", "key"]);

    await assert.rejects(transaction.exec(), (error) => {
        assert.equal(error.code, "REDIS_NAMESPACE_UNSAFE_COMMAND");
        return /FUTUREMOVE.*has no available key metadata/.test(error.message);
    });
    await assert.rejects(transaction.exec(), (error) => {
        assert.equal(error.code, "REDIS_NAMESPACE_UNSAFE_COMMAND");
        return /FUTUREMOVE.*has no available key metadata/.test(error.message);
    });
    assert.deepEqual(
        calls.map(({ args }) => args),
        [["COMMAND"]],
    );
});

test("raw multi bypasses namespace prefixes", async () => {
    const { client, calls } = createFakeClient({
        commandResponse: [
            ["get", 2, ["readonly"], 1, 1, 1],
            ["set", -3, ["write"], 1, 1, 1],
        ],
    });

    attachNamespace(client, "global");
    const transaction = client.raw.multi();

    transaction.set("planet", "earth").get("planet");
    await transaction.exec();

    assert.deepEqual(calls[0].args, ["SET", "planet", "earth"]);
    assert.deepEqual(calls[1].args, ["GET", "planet"]);
});

test("scoped multi keeps captured namespace when global namespace changes", async () => {
    const { client, calls } = createFakeClient({
        commandResponse: [
            ["get", 2, ["readonly"], 1, 1, 1],
            ["set", -3, ["write"], 1, 1, 1],
        ],
    });

    attachNamespace(client, "global");
    const transaction = client.withNamespace("alpha").multi();

    client.namespace = "beta";
    transaction.set("status", "ready").get("status");
    await transaction.exec();

    assert.equal(client.namespace, "beta");
    assert.deepEqual(calls[0].args, ["COMMAND"]);
    assert.deepEqual(calls[1].args, ["SET", "alpha:status", "ready"]);
    assert.deepEqual(calls[2].args, ["GET", "alpha:status"]);
});

test("multi prefixes exactly once while preserving already-prefixed logical keys", async () => {
    const { client, calls } = createFakeClient({
        commandResponse: [["get", 2, ["readonly"], 1, 1, 1]],
    });

    attachNamespace(client, "global");
    const transaction = client.withNamespace("alpha").multi();

    transaction.get("key").get("alpha:key");
    await transaction.exec();

    assert.deepEqual(calls[1].args, ["GET", "alpha:key"]);
    assert.deepEqual(calls[2].args, ["GET", "alpha:alpha:key"]);
});

test("dynamic-key script commands are namespaced even when COMMAND introspection fails", async () => {
    const { client, calls } = createFakeClient({
        commandResponse: new Error("NOPERM"),
    });

    attachNamespace(client, "codex");

    await client.sendCommand(["EVAL", "return ARGV[1]", "1", "planet", "arg1"]);
    await client.sendCommand(["FCALL", "myfunc", "2", "earth", "mars", "arg1"]);

    assert.deepEqual(calls[0].args, ["COMMAND"]);
    assert.deepEqual(calls[1].args, ["EVAL", "return ARGV[1]", "1", "codex:planet", "arg1"]);
    assert.deepEqual(calls[2].args, ["FCALL", "myfunc", "2", "codex:earth", "codex:mars", "arg1"]);
});

test("movable-key commands prefix every resolved key position", async () => {
    const { client, calls } = createFakeClient({
        commandResponse: [
            ["lmpop", -4, ["write", "movablekeys"], 0, 0, 0],
            ["msetex", -5, ["write", "movablekeys"], 0, 0, 0],
            ["sort", -2, ["write", "movablekeys"], 1, 1, 1],
            ["sort_ro", -2, ["readonly", "movablekeys"], 1, 1, 1],
            ["xreadgroup", -7, ["write", "movablekeys"], 0, 0, 0],
        ],
    });

    attachNamespace(client, "alpha");

    await client.sendCommand(["LMPOP", "2", "jobs", "backup", "LEFT"]);
    await client.sendCommand(["MSETEX", "2", "one", "1", "two", "2", "PX", "1000"]);
    await client.sendCommand([
        "SORT",
        "items",
        "BY",
        "NOSORT",
        "GET",
        "#",
        "GET",
        "profile:*",
        "STORE",
        "sorted",
    ]);
    await client.sendCommand(["SORT_RO", "readonly-items", "GET", "profile:*"]);
    await client.sendCommand([
        "XREADGROUP",
        "GROUP",
        "STREAMS",
        "consumer",
        "COUNT",
        "1",
        "STREAMS",
        "orders",
        "events",
        ">",
        "0",
    ]);

    assert.deepEqual(calls[1].args, ["LMPOP", "2", "alpha:jobs", "alpha:backup", "LEFT"]);
    assert.deepEqual(calls[2].args, [
        "MSETEX",
        "2",
        "alpha:one",
        "1",
        "alpha:two",
        "2",
        "PX",
        "1000",
    ]);
    assert.deepEqual(calls[3].args, [
        "SORT",
        "alpha:items",
        "BY",
        "NOSORT",
        "GET",
        "#",
        "GET",
        "alpha:profile:*",
        "STORE",
        "alpha:sorted",
    ]);
    assert.deepEqual(calls[4].args, ["SORT_RO", "alpha:readonly-items", "GET", "alpha:profile:*"]);
    assert.deepEqual(calls[5].args, [
        "XREADGROUP",
        "GROUP",
        "STREAMS",
        "consumer",
        "COUNT",
        "1",
        "STREAMS",
        "alpha:orders",
        "alpha:events",
        ">",
        "0",
    ]);
});

test("database-wide destructive commands fail closed on namespaced clients", async () => {
    const { client, calls } = createFakeClient({
        commandResponse: [
            ["flushdb", -1, ["write"], 0, 0, 0],
            ["flushall", -1, ["write"], 0, 0, 0],
            ["swapdb", 3, ["write"], 0, 0, 0],
        ],
    });

    attachNamespace(client, "alpha");
    const scoped = client.withNamespace("beta");

    for (const args of [["FLUSHDB"], ["FLUSHALL", "ASYNC"], ["SWAPDB", "0", "1"]]) {
        await assert.rejects(
            async () => client.sendCommand(args),
            (error) => {
                assert.equal(error.code, "REDIS_NAMESPACE_UNSAFE_COMMAND");
                return /operates on the entire database/.test(error.message);
            },
        );
        await assert.rejects(
            async () => scoped.sendCommand(args),
            (error) => {
                assert.equal(error.code, "REDIS_NAMESPACE_UNSAFE_COMMAND");
                return /operates on the entire database/.test(error.message);
            },
        );
    }

    await client.raw.sendCommand(["FLUSHDB"]);

    assert.deepEqual(
        calls.map(({ args }) => args),
        [["COMMAND"], ["FLUSHDB"]],
    );
});

test("unsupported server-discovered movable-key commands fail closed", async () => {
    const { client, calls } = createFakeClient({
        commandResponse: [["futuremove", -2, ["write", "movablekeys"], 0, 0, 0]],
    });

    attachNamespace(client, "alpha");

    await assert.rejects(client.sendCommand(["FUTUREMOVE", "key"]), (error) => {
        assert.equal(error.code, "REDIS_NAMESPACE_UNSAFE_COMMAND");
        return /FUTUREMOVE.*cannot namespace it safely/.test(error.message);
    });
    assert.deepEqual(
        calls.map(({ args }) => args),
        [["COMMAND"]],
    );
});

test("withNamespace prefixes commands that route through _self.sendCommand", async () => {
    const { client, calls } = createSelfRoutedFakeClient({
        commandResponse: [
            ["get", 2, ["readonly"], 1, 1, 1],
            ["set", -3, ["write"], 1, 1, 1],
        ],
    });

    attachNamespace(client, "global");

    const tenantA = client.withNamespace("alpha");
    const tenantB = client.withNamespace("beta");

    await tenantA.set("planet", "mars");
    await tenantB.set("planet", "earth");

    assert.deepEqual(calls[0].args, ["COMMAND"]);
    assert.deepEqual(calls[1].args, ["SET", "alpha:planet", "mars"]);
    assert.deepEqual(calls[2].args, ["SET", "beta:planet", "earth"]);
    assert.equal(client.namespace, "global");
});

test("attachNamespace fails fast for unsupported internal command dispatch", () => {
    const { client } = createUnsupportedDispatchFakeClient();

    assert.throws(
        () => {
            attachNamespace(client, "codex");
        },
        (error) =>
            error instanceof Error &&
            error.code === "REDIS_NAMESPACE_INCOMPATIBLE_CLIENT" &&
            /incompatible/.test(error.message),
    );
});

test("attachNamespace falls back to built-in command specs when COMMAND introspection is unavailable", async () => {
    const { client, calls } = createFakeClient({
        commandResponse: new Error("NOPERM"),
    });

    attachNamespace(client, "klingon");

    await client.sendCommand(["GET", "key"]);
    await client.sendCommand(["PING"]);

    assert.deepEqual(calls[0].args, ["COMMAND"]);
    assert.deepEqual(calls[1].args, ["GET", "klingon:key"]);
    assert.deepEqual(calls[2].args, ["PING"]);
});

test("fallback specs cover common string, blocking, probabilistic, and stream commands", async () => {
    const { client, calls } = createFakeClient({
        commandResponse: new Error("NOPERM"),
    });

    attachNamespace(client, "klingon");

    await client.sendCommand(["SETNX", "lock", "1"]);
    await client.sendCommand(["PSETEX", "cache", "1000", "value"]);
    await client.sendCommand(["BLPOP", "primary", "backup", "0"]);
    await client.sendCommand(["PFCOUNT", "daily", "monthly"]);
    await client.sendCommand(["XADD", "events", "*", "type", "created"]);
    await client.sendCommand(["DUMP", "archive"]);
    await client.sendCommand(["RESTORE", "restored", "0", "payload"]);
    await client.sendCommand(["MOVE", "relocated", "2"]);

    assert.deepEqual(calls[1].args, ["SETNX", "klingon:lock", "1"]);
    assert.deepEqual(calls[2].args, ["PSETEX", "klingon:cache", "1000", "value"]);
    assert.deepEqual(calls[3].args, ["BLPOP", "klingon:primary", "klingon:backup", "0"]);
    assert.deepEqual(calls[4].args, ["PFCOUNT", "klingon:daily", "klingon:monthly"]);
    assert.deepEqual(calls[5].args, ["XADD", "klingon:events", "*", "type", "created"]);
    assert.deepEqual(calls[6].args, ["DUMP", "klingon:archive"]);
    assert.deepEqual(calls[7].args, ["RESTORE", "klingon:restored", "0", "payload"]);
    assert.deepEqual(calls[8].args, ["MOVE", "klingon:relocated", "2"]);
});

test("unknown commands fail closed when introspection is unavailable", async () => {
    const { client, calls } = createFakeClient({
        commandResponse: new Error("NOPERM"),
    });

    attachNamespace(client, "klingon");

    await assert.rejects(client.sendCommand(["MODULEKEY", "unscoped"]), (error) => {
        assert.equal(error.code, "REDIS_NAMESPACE_UNSAFE_COMMAND");
        return /MODULEKEY has no available key metadata/.test(error.message);
    });
    assert.deepEqual(
        calls.map(({ args }) => args),
        [["COMMAND"]],
    );
});

test("custom namespace command metadata prefixes commands when introspection is unavailable", async () => {
    const { client, calls } = createFakeClient({
        commandResponse: new Error("NOPERM"),
    });

    attachNamespace(client, "klingon", {
        namespaceCommands: {
            MODULEKEY: { firstKey: 1, lastKey: 1 },
            MODULEMSET: { firstKey: 1, lastKey: -1, step: 2 },
        },
    });

    await client.sendCommand(["MODULEKEY", "unscoped", "value"]);
    await client.sendCommand(["MODULEMSET", "one", "1", "two", "2"]);

    assert.deepEqual(calls[0].args, ["COMMAND"]);
    assert.deepEqual(calls[1].args, ["MODULEKEY", "klingon:unscoped", "value"]);
    assert.deepEqual(calls[2].args, ["MODULEMSET", "klingon:one", "1", "klingon:two", "2"]);
});

test("runtime namespace command registration updates the metadata registry", async () => {
    const { client, calls } = createFakeClient({
        commandResponse: [],
    });

    attachNamespace(client, "klingon");

    await assert.rejects(client.sendCommand(["MODULEKEY", "unscoped"]), (error) => {
        assert.equal(error.code, "REDIS_NAMESPACE_UNSAFE_COMMAND");
        return /MODULEKEY has no available key metadata/.test(error.message);
    });

    client.registerNamespaceCommand("MODULEKEY", { firstKey: 1, lastKey: 1 });
    await client.sendCommand(["MODULEKEY", "unscoped"]);

    assert.deepEqual(
        calls.map(({ args }) => args),
        [["COMMAND"], ["MODULEKEY", "klingon:unscoped"]],
    );
});

test("custom namespace command metadata can mark module commands as keyless", async () => {
    const { client, calls } = createFakeClient({
        commandResponse: new Error("NOPERM"),
    });

    attachNamespace(client, "klingon", {
        namespaceCommands: {
            "MODULE.INFO": { keyless: true },
        },
    });

    await client.sendCommand(["MODULE.INFO", "status"]);

    assert.deepEqual(calls[0].args, ["COMMAND"]);
    assert.deepEqual(calls[1].args, ["MODULE.INFO", "status"]);
});

test("custom namespace command metadata rejects unsafe specs", () => {
    const { client } = createFakeClient();

    assert.throws(
        () =>
            attachNamespace(client, "klingon", {
                namespaceCommands: {
                    MODULEKEY: { firstKey: 0, lastKey: 1 },
                },
            }),
        {
            name: "TypeError",
            message:
                "Redis namespace command MODULEKEY metadata must define integer firstKey, lastKey, and step positions",
        },
    );
});

test("ready refreshes command specs after an earlier introspection failure", async () => {
    let introspectionAllowed = false;
    const { client, calls, listeners } = createFakeClient({
        commandResponse() {
            return introspectionAllowed
                ? [["customkey", 2, ["readonly"], 1, 1, 1]]
                : new Error("NOPERM");
        },
    });

    attachNamespace(client, "klingon");

    await client.sendCommand(["GET", "existing"]);
    introspectionAllowed = true;
    listeners.get("ready")();
    await new Promise((resolve) => setImmediate(resolve));
    await client.sendCommand(["CUSTOMKEY", "new"]);

    assert.deepEqual(
        calls.map(({ args }) => args),
        [["COMMAND"], ["GET", "klingon:existing"], ["COMMAND"], ["CUSTOMKEY", "klingon:new"]],
    );
});
