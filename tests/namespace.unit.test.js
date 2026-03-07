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
    assert.deepEqual(calls[3].args, ["GET", "romulan:counter"]);

    client.namespace = "";
    assert.equal(client.namespace, undefined);
    await client.sendCommand(["SET", "counter", "2"]);
    assert.deepEqual(calls[4].args, ["SET", "counter", "2"]);
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
