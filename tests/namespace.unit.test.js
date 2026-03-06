import assert from "node:assert/strict";
import { test } from "node:test";

import { attachNamespace } from "../src/namespace.js";

function createFakeClient({ commandResponse, isOpen = true } = {}) {
    const listeners = new Map();
    const calls = [];

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
