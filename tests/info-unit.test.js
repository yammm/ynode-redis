import assert from "node:assert/strict";
import { test } from "node:test";

import { clientInfo } from "../src/info.js";

test("connection metadata uses the raw client without relaxing namespace guards", async () => {
    const raw = {
        async sendCommand(args) {
            assert.equal(this, raw);
            assert.deepEqual(args, ["CLIENT", "INFO"]);
            return Buffer.from("id=42 name=metadata-test addr=127.0.0.1:6379\n");
        },
    };
    const client = {
        raw,
        async sendCommand() {
            throw new Error("CLIENT is blocked on the namespaced client");
        },
    };

    assert.deepEqual(await clientInfo(client), {
        id: "42",
        name: "metadata-test",
        addr: "127.0.0.1:6379",
    });
});

test("connection metadata still supports a plain Redis client", async () => {
    const client = {
        async sendCommand(args) {
            assert.equal(this, client);
            assert.deepEqual(args, ["CLIENT", "INFO"]);
            return "id=7 name=plain-client\n";
        },
    };

    assert.deepEqual(await clientInfo(client), { id: "7", name: "plain-client" });
});

test("connection metadata preserves raw transport failures", async () => {
    const failure = Object.assign(new Error("CLIENT INFO denied"), { code: "NOPERM" });
    const client = {
        raw: {
            async sendCommand() {
                throw failure;
            },
        },
        async sendCommand() {
            assert.fail("A raw failure must not retry through the namespaced client");
        },
    };

    await assert.rejects(clientInfo(client), (error) => error === failure);
});
