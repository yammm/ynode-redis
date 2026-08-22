import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import { attachManagedClients } from "../src/managed.js";
import { attachNamespace } from "../src/namespace.js";

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });
    return { promise, reject, resolve };
}

const MANAGED_LOG_EVENTS = ["connect", "ready", "end", "error", "reconnecting"];

function assertNoManagedLogListeners(client) {
    for (const event of MANAGED_LOG_EVENTS) {
        assert.equal(client.listenerCount(event), 0, `${event} listeners must be removed`);
    }
}

class FakeRedisClient extends EventEmitter {
    constructor({ close, connect, destroy } = {}) {
        super();
        this.closeBehavior = close;
        this.connectBehavior = connect;
        this.destroyBehavior = destroy;
        this.calls = [];
        this.closeCalls = 0;
        this.destroyCalls = 0;
        this.duplicates = [];
        this.duplicateOptions = [];
        this.isOpen = false;
        this.isReady = false;
    }

    duplicate(options) {
        const behavior = this.duplicateBehaviors?.shift() ?? {};
        const duplicate = new FakeRedisClient(behavior);
        this.duplicates.push(duplicate);
        this.duplicateOptions.push(options);
        return duplicate;
    }

    async connect() {
        this.calls.push(["CONNECT"]);
        this.emit("connect");
        await this.connectBehavior?.();
        this.isOpen = true;
        this.isReady = true;
        this.emit("ready");
        return this;
    }

    async close() {
        this.closeCalls += 1;
        await this.closeBehavior?.();
        this.isOpen = false;
        this.isReady = false;
        this.emit("end");
    }

    async destroy() {
        this.destroyCalls += 1;
        await this.destroyBehavior?.();
        this.isOpen = false;
        this.isReady = false;
        this.emit("end");
    }

    async sendCommand(args) {
        this.calls.push(args);
        const command = String(args?.[0] ?? "").toUpperCase();
        if (command === "CLIENT") {
            return "id=42 addr=127.0.0.1:6379\n";
        }
        if (command === "COMMAND") {
            return [];
        }
        if (command === "PING") {
            return "PONG";
        }
        return "OK";
    }

    async *scanIterator() {
        yield [];
    }
}

function createHarness(baseOptions = {}) {
    const logs = {
        debug: [],
        error: [],
        info: [],
        trace: [],
        warn: [],
    };
    const fastify = {
        log: Object.fromEntries(
            Object.entries(logs).map(([level, entries]) => [
                level,
                (...args) => entries.push(args),
            ]),
        ),
    };
    const client = new FakeRedisClient();
    client.duplicateBehaviors = baseOptions.duplicateBehaviors ?? [];
    attachNamespace(client, baseOptions.namespace);
    const lifecycle = attachManagedClients(fastify, client, {
        namespaceCommands: baseOptions.namespaceCommands,
        startupTimeout: baseOptions.startupTimeout ?? 100,
    });
    return { client, fastify, lifecycle, logs };
}

test("createManagedClient connects a namespaced duplicate without mutating options", async () => {
    const { client, lifecycle } = createHarness({ namespace: "global" });
    const options = {
        name: "worker",
        namespace: "tenant",
        socket: { connectTimeout: 25 },
        startupTimeout: 50,
    };

    const managed = await client.createManagedClient(options);

    assert.equal(managed, client.duplicates[0]);
    assert.equal(managed.namespace, "tenant");
    assert.deepEqual(client.duplicateOptions[0], {
        name: "worker",
        socket: { connectTimeout: 25 },
    });
    assert.deepEqual(options, {
        name: "worker",
        namespace: "tenant",
        socket: { connectTimeout: 25 },
        startupTimeout: 50,
    });
    assert.deepEqual(managed.readiness(), {
        isOpen: true,
        isReady: true,
        namespace: "tenant",
    });
    assert.equal((await managed.healthcheck()).ok, true);

    await lifecycle.closeAll();
    assert.equal(managed.closeCalls, 1);
    for (const event of ["connect", "end", "error", "reconnecting"]) {
        assert.equal(managed.listenerCount(event), 0);
    }
    // The namespace metadata refresh listener remains, but the Fastify-capturing
    // managed logging listener is gone.
    assert.equal(managed.listenerCount("ready"), 1);
});

test("scoped factories inherit their active namespace while raw factories stay global", async () => {
    const { client, lifecycle } = createHarness({ namespace: "global" });

    const scopedManaged = await client.withNamespace("scoped").createManagedClient();
    const rawManaged = await client.raw.createManagedClient();

    assert.equal(scopedManaged.namespace, "scoped");
    assert.equal(rawManaged.namespace, undefined);

    await lifecycle.closeAll();
    assert.equal(scopedManaged.closeCalls, 1);
    assert.equal(rawManaged.closeCalls, 1);
});

test("createManagedSubscriber is unnamespaced and exposes nonthrowing health helpers", async () => {
    const { client, lifecycle } = createHarness({ namespace: "global" });
    const options = { name: "events", startupTimeout: 50 };

    const subscriber = await client.withNamespace("tenant").createManagedSubscriber(options);

    assert.equal(subscriber.namespace, undefined);
    assert.deepEqual(client.duplicateOptions[0], { name: "events" });
    assert.deepEqual(options, { name: "events", startupTimeout: 50 });
    assert.deepEqual(subscriber.readiness(), {
        isOpen: true,
        isReady: true,
        namespace: undefined,
    });
    assert.equal((await subscriber.healthcheck()).ping, "PONG");
    await assert.rejects(
        client.createManagedSubscriber({ namespace: "tenant" }),
        /must not include namespace or namespaceCommands/,
    );

    await Promise.all([lifecycle.closeAll(), lifecycle.closeAll()]);
    assert.equal(subscriber.closeCalls, 1);
    assertNoManagedLogListeners(subscriber);
});

test("managed shutdown aborts pending startup, awaits teardown, and rejects new clients", async () => {
    const connectStarted = createDeferred();
    const releaseDestroy = createDeferred();
    const { client, lifecycle } = createHarness({
        duplicateBehaviors: [
            {
                connect: async () => {
                    connectStarted.resolve();
                    await new Promise(() => {});
                },
                destroy: () => releaseDestroy.promise,
            },
        ],
        startupTimeout: 0,
    });

    const creation = client.createManagedSubscriber();
    const rejectedCreation = assert.rejects(creation, {
        code: "REDIS_MANAGED_CLIENT_CLOSING",
        message: "Cannot create managed Redis subscriber while Fastify is closing",
    });
    await connectStarted.promise;

    let shutdownSettled = false;
    const shutdown = lifecycle.closeAll().then(() => {
        shutdownSettled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(client.duplicates[0].destroyCalls, 1);
    assert.equal(shutdownSettled, false);
    releaseDestroy.resolve();
    await shutdown;
    await rejectedCreation;
    assert.equal(shutdownSettled, true);
    assertNoManagedLogListeners(client.duplicates[0]);

    await assert.rejects(client.createManagedClient(), {
        code: "REDIS_MANAGED_CLIENT_CLOSING",
    });
    assert.equal(lifecycle.closeAll(), lifecycle.closeAll());
});

test("managed startup enforces its deadline and awaits forceful cleanup", async () => {
    const { client, lifecycle } = createHarness({
        duplicateBehaviors: [{ connect: () => new Promise(() => {}) }],
    });

    await assert.rejects(client.createManagedSubscriber({ startupTimeout: 15 }), {
        code: "REDIS_STARTUP_TIMEOUT",
        message: "Redis startup timed out after 15ms",
    });
    assert.equal(client.duplicates[0].destroyCalls, 1);
    assert.equal(client.duplicates[0].isOpen, false);
    assertNoManagedLogListeners(client.duplicates[0]);

    await lifecycle.closeAll();
});

test("managed connect failure tears down once and removes logging listeners", async () => {
    const { client, lifecycle } = createHarness({
        duplicateBehaviors: [
            {
                connect: () => {
                    throw new Error("connect failed");
                },
            },
        ],
    });

    await assert.rejects(client.createManagedSubscriber(), /connect failed/);
    const failedClient = client.duplicates[0];
    assert.equal(failedClient.destroyCalls, 1);
    assert.equal(failedClient.closeCalls, 0);
    assertNoManagedLogListeners(failedClient);

    await lifecycle.closeAll();
    assert.equal(failedClient.destroyCalls, 1);
});

test("one managed cleanup failure does not block other clients or primary shutdown", async () => {
    const { client, lifecycle, logs } = createHarness();
    const first = await client.createManagedSubscriber({ name: "first" });
    const second = await client.createManagedSubscriber({ name: "second" });
    first.off = () => {
        throw new Error("listener disposal failed");
    };

    await lifecycle.closeAll();

    assert.equal(first.closeCalls, 1);
    assert.equal(second.closeCalls, 1);
    assertNoManagedLogListeners(second);
    assert.equal(
        logs.warn.some((entries) =>
            entries.some((entry) => String(entry).includes("managed Redis connection")),
        ),
        true,
    );
});

test("managed factories validate inputs before duplicating a client", async () => {
    const { client, lifecycle } = createHarness();

    await assert.rejects(client.createManagedClient(null), {
        name: "TypeError",
        message: "createManagedClient options must be a plain object",
    });
    await assert.rejects(client.createManagedSubscriber([]), {
        name: "TypeError",
        message: "createManagedSubscriber options must be a plain object",
    });
    await assert.rejects(client.createManagedClient(new Date()), {
        name: "TypeError",
        message: "createManagedClient options must be a plain object",
    });
    class ClientOptions {}
    await assert.rejects(client.createManagedSubscriber(new ClientOptions()), {
        name: "TypeError",
        message: "createManagedSubscriber options must be a plain object",
    });
    await assert.rejects(client.createManagedClient({ startupTimeout: -1 }), {
        name: "TypeError",
        message: "options.startupTimeout must be a non-negative number in milliseconds",
    });
    assert.equal(client.duplicates.length, 0);

    await lifecycle.closeAll();
});
