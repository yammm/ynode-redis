import assert from "node:assert/strict";
import { test } from "node:test";

import { attachHealth } from "../src/health.js";

test("attachHealth exposes readiness and healthcheck success payload", async () => {
    const client = {
        isOpen: true,
        isReady: true,
        namespace: "codex",
        raw: {
            async sendCommand(args) {
                assert.deepEqual(args, ["PING"]);
                return "PONG";
            },
        },
        async sendCommand() {
            throw new Error("should not be called when raw is available");
        },
    };

    attachHealth(client);

    assert.deepEqual(client.readiness(), {
        isOpen: true,
        isReady: true,
        namespace: "codex",
    });

    const health = await client.healthcheck();
    assert.equal(health.ok, true);
    assert.equal(health.ping, "PONG");
    assert.equal(health.isOpen, true);
    assert.equal(health.isReady, true);
    assert.equal(health.namespace, "codex");
    assert.equal(typeof health.latencyMs, "number");
});

test("attachHealth returns a non-throwing unhealthy payload on ping errors", async () => {
    const client = {
        isOpen: false,
        isReady: false,
        namespace: undefined,
        async sendCommand(args) {
            assert.deepEqual(args, ["PING"]);
            const error = new Error("socket closed");
            error.code = "ECONNRESET";
            throw error;
        },
    };

    attachHealth(client);

    const health = await client.healthcheck();
    assert.equal(health.ok, false);
    assert.equal(health.isOpen, false);
    assert.equal(health.isReady, false);
    assert.equal(health.namespace, undefined);
    assert.equal(typeof health.latencyMs, "number");
    assert.equal(health.error?.name, "Error");
    assert.equal(health.error?.message, "socket closed");
    assert.equal(health.error?.code, "ECONNRESET");
});
