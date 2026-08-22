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

test("attachHealth healthcheck resolves unhealthy when the ping stalls past the deadline", async () => {
    const client = {
        isOpen: true,
        isReady: true,
        namespace: "codex",
        sendCommand() {
            // Stalled socket: the ping settles long after the deadline. The
            // ref'd timer also keeps the event loop alive so the unref'd
            // deadline timer can fire in this test.
            return new Promise((resolve) => setTimeout(() => resolve("PONG"), 500));
        },
    };

    attachHealth(client);

    const health = await client.healthcheck({ timeoutMs: 25 });
    assert.equal(health.ok, false);
    assert.equal(health.isOpen, true);
    assert.equal(health.namespace, "codex");
    assert.equal(typeof health.latencyMs, "number");
    assert.equal(health.error?.code, "REDIS_HEALTHCHECK_TIMEOUT");
    assert.match(health.error?.message ?? "", /timed out after 25ms/);
});

test("attachHealth healthcheck ignores invalid timeout overrides", async () => {
    const client = {
        isOpen: true,
        isReady: true,
        async sendCommand() {
            return "PONG";
        },
    };

    attachHealth(client);

    const health = await client.healthcheck({ timeoutMs: Number.NaN });
    assert.equal(health.ok, true);
});

test("attachHealth accepts Buffer PONG responses from type-mapped clients", async () => {
    const client = {
        isOpen: true,
        isReady: true,
        async sendCommand() {
            return Buffer.from("PONG");
        },
    };

    attachHealth(client);

    const health = await client.healthcheck();
    assert.equal(health.ok, true);
    assert.equal(health.ping, "PONG");
});
