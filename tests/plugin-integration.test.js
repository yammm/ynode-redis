import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import { test } from "node:test";

import redisPlugin from "../src/plugin.js";

function createFastifyHarness() {
    const hooks = new Map();

    const fastify = {
        log: {
            debug: () => {},
            info: () => {},
            warn: () => {},
            error: () => {},
            trace: () => {},
        },
        hasDecorator(name) {
            return Object.prototype.hasOwnProperty.call(this, name);
        },
        decorate(name, value) {
            this[name] = value;
        },
        addHook(name, handler) {
            hooks.set(name, handler);
        },
    };

    return { fastify, hooks };
}

function hasRedisServerBinary() {
    const result = spawnSync("redis-server", ["--version"], { stdio: "ignore" });
    return result.status === 0;
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function canConnectTcp(port, host = "127.0.0.1") {
    return new Promise((resolve) => {
        const socket = net.createConnection({ host, port });
        socket.setTimeout(250);

        socket.once("connect", () => {
            socket.destroy();
            resolve(true);
        });

        socket.once("error", () => {
            resolve(false);
        });

        socket.once("timeout", () => {
            socket.destroy();
            resolve(false);
        });
    });
}

function stopProcess(proc) {
    if (!proc || proc.exitCode !== null) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        const hardKillTimer = setTimeout(() => {
            proc.kill("SIGKILL");
        }, 2000);

        proc.once("exit", () => {
            clearTimeout(hardKillTimer);
            resolve();
        });

        proc.kill("SIGTERM");
    });
}

function markClientOpen(client, value = true) {
    Object.defineProperty(client, "isOpen", {
        value,
        configurable: true,
        writable: true,
    });
}

async function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();

        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (!address || typeof address === "string") {
                reject(new Error("Unable to allocate a TCP port"));
                return;
            }
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(address.port);
            });
        });
    });
}

async function startRedis() {
    if (process.env.REDIS_URL) {
        return {
            url: process.env.REDIS_URL,
            stop: async () => {},
        };
    }

    if (!hasRedisServerBinary()) {
        return null;
    }

    let port;
    try {
        port = await getFreePort();
    } catch (error) {
        if (error && (error.code === "EPERM" || error.code === "EACCES")) {
            return null;
        }
        throw error;
    }

    const proc = spawn("redis-server", [
        "--save",
        "",
        "--appendonly",
        "no",
        "--port",
        String(port),
        "--bind",
        "127.0.0.1",
    ]);

    const startupTimeoutMs = 5000;
    const startupDeadline = Date.now() + startupTimeoutMs;
    let ready = false;

    while (Date.now() < startupDeadline) {
        if (proc.exitCode !== null) {
            break;
        }
        if (await canConnectTcp(port)) {
            ready = true;
            break;
        }
        await delay(100);
    }

    if (!ready) {
        await stopProcess(proc);
        throw new Error(`redis-server failed to start within ${startupTimeoutMs}ms`);
    }

    return {
        url: `redis://127.0.0.1:${port}`,
        stop: async () => {
            await stopProcess(proc);
        },
    };
}

async function waitForAssertion(assertion, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    let lastError;

    while (Date.now() < deadline) {
        try {
            await assertion();
            return;
        } catch (error) {
            lastError = error;
            await delay(50);
        }
    }

    throw lastError ?? new Error("Timed out waiting for assertion");
}

test("plugin connects to Redis and supports command round trips", async (t) => {
    const redis = await startRedis();
    if (!redis) {
        t.skip("No REDIS_URL provided or local redis-server cannot be started in this environment");
        return;
    }
    t.after(async () => {
        await redis.stop();
    });

    const { fastify, hooks } = createFastifyHarness();
    await redisPlugin(fastify, { url: redis.url, name: "ynode-redis-integration-test" });

    const onReady = hooks.get("onReady");
    const onClose = hooks.get("onClose");

    assert.equal(typeof onReady, "function");
    assert.equal(typeof onClose, "function");

    await onReady();

    const key = `ynode-redis:test:${Date.now()}`;
    const logicalSharedKey = `${key}:shared`;

    assert.equal(fastify.redis.namespace, undefined);

    const readiness = fastify.redis.readiness();
    assert.equal(readiness.isOpen, true);
    assert.equal(readiness.isReady, true);
    assert.equal(readiness.namespace, undefined);

    const health = await fastify.redis.healthcheck();
    assert.equal(health.ok, true);
    assert.equal(health.ping, "PONG");
    assert.equal(health.isOpen, true);
    assert.equal(health.isReady, true);
    assert.equal(health.namespace, undefined);

    const tenantA = fastify.redis.withNamespace("alpha");
    const tenantB = fastify.redis.withNamespace("beta");

    await tenantA.set(logicalSharedKey, "a");
    await tenantB.set(logicalSharedKey, "b");

    assert.equal(await tenantA.get(logicalSharedKey), "a");
    assert.equal(await tenantB.get(logicalSharedKey), "b");
    assert.equal(await fastify.redis.raw.get(`alpha:${logicalSharedKey}`), "a");
    assert.equal(await fastify.redis.raw.get(`beta:${logicalSharedKey}`), "b");
    assert.equal(fastify.redis.namespace, undefined);

    const multiKey = `${key}:multi`;
    const transactionA = tenantA.multi();
    transactionA.set(multiKey, "tx-a").get(multiKey);
    await transactionA.exec();

    const transactionB = tenantB.multi();
    transactionB.set(multiKey, "tx-b").get(multiKey);
    await transactionB.exec();

    assert.equal(await tenantA.get(multiKey), "tx-a");
    assert.equal(await tenantB.get(multiKey), "tx-b");
    assert.equal(await fastify.redis.raw.get(`alpha:${multiKey}`), "tx-a");
    assert.equal(await fastify.redis.raw.get(`beta:${multiKey}`), "tx-b");

    const pipelineKey = `${key}:pipeline`;
    const pipelineA = tenantA.multi();
    pipelineA.set(pipelineKey, "pipe-a").get(pipelineKey);
    await pipelineA.execAsPipeline();

    const pipelineB = tenantB.multi();
    pipelineB.set(pipelineKey, "pipe-b").get(pipelineKey);
    await pipelineB.execAsPipeline();

    assert.equal(await tenantA.get(pipelineKey), "pipe-a");
    assert.equal(await tenantB.get(pipelineKey), "pipe-b");
    assert.equal(await fastify.redis.raw.get(`alpha:${pipelineKey}`), "pipe-a");
    assert.equal(await fastify.redis.raw.get(`beta:${pipelineKey}`), "pipe-b");

    const rawMultiKey = `${key}:raw-multi`;
    const rawTransaction = tenantA.raw.multi();
    rawTransaction.set(rawMultiKey, "raw-value").get(rawMultiKey);
    await rawTransaction.exec();
    assert.equal(await fastify.redis.raw.get(rawMultiKey), "raw-value");
    assert.equal(await tenantA.get(rawMultiKey), null);
    assert.equal(await tenantB.get(rawMultiKey), null);
    assert.equal(fastify.redis.namespace, undefined);

    fastify.redis.namespace = "codex:";
    assert.equal(fastify.redis.namespace, "codex");

    await fastify.redis.set(key, "ok");
    const value = await fastify.redis.get(key);
    assert.equal(value, "ok");

    await fastify.redis.raw.set(key, "raw");
    assert.equal(await fastify.redis.raw.get(key), "raw");
    assert.equal(await fastify.redis.get(key), "ok");

    fastify.redis.namespace = undefined;
    assert.equal(await fastify.redis.get(key), "raw");
    assert.equal(await fastify.redis.raw.get(`codex:${key}`), "ok");

    await waitForAssertion(async () => {
        const info = await fastify.redis.sendCommand(["CLIENT", "INFO"]);
        assert.match(info, /\bname=ynode-redis-integration-test\b/);
    });

    await onClose();
    assert.equal(fastify.redis.isOpen, false);
});

test("plugin prevents duplicate registration on the same fastify instance", async () => {
    const { fastify, hooks } = createFastifyHarness();

    await redisPlugin(fastify, { url: "redis://127.0.0.1:6379" });

    await assert.rejects(async () => {
        await redisPlugin(fastify, { url: "redis://127.0.0.1:6379" });
    }, /already been registered/);

    const onClose = hooks.get("onClose");
    assert.equal(typeof onClose, "function");
    await onClose();
});

test("plugin startup fails fast when Redis is unreachable", async () => {
    const { fastify, hooks } = createFastifyHarness();
    await redisPlugin(fastify, {
        url: "redis://127.0.0.1:1",
        socket: {
            connectTimeout: 100,
            reconnectStrategy: false,
        },
    });

    const onReady = hooks.get("onReady");
    const onClose = hooks.get("onClose");

    assert.equal(typeof onReady, "function");
    assert.equal(typeof onClose, "function");

    await assert.rejects(async () => {
        await onReady();
    });

    await onClose();
});

test("plugin startup times out when connect does not resolve", async () => {
    const { fastify, hooks } = createFastifyHarness();
    await redisPlugin(fastify, {
        url: "redis://127.0.0.1:6379",
        startupTimeout: 50,
    });

    const onReady = hooks.get("onReady");
    const onClose = hooks.get("onClose");

    assert.equal(typeof onReady, "function");
    assert.equal(typeof onClose, "function");

    let destroyCalls = 0;
    fastify.redis.connect = async () => new Promise(() => {});
    fastify.redis.destroy = () => {
        destroyCalls += 1;
        markClientOpen(fastify.redis, false);
    };

    await assert.rejects(
        async () => {
            await onReady();
        },
        (error) => {
            assert.equal(error?.code, "REDIS_STARTUP_TIMEOUT");
            assert.match(error?.message ?? "", /Redis startup timed out after 50ms/);
            return true;
        },
    );

    assert.equal(destroyCalls, 1);
    await onClose();
});

test("plugin rejects invalid startupTimeout values", async () => {
    const { fastify } = createFastifyHarness();

    await assert.rejects(async () => {
        await redisPlugin(fastify, {
            url: "redis://127.0.0.1:6379",
            startupTimeout: -1,
        });
    }, /startupTimeout must be a non-negative number in milliseconds/);
});

test("plugin startup fails when CLIENT INFO is denied", async (t) => {
    const redis = await startRedis();
    if (!redis) {
        t.skip("No REDIS_URL provided or local redis-server cannot be started in this environment");
        return;
    }
    t.after(async () => {
        await redis.stop();
    });

    const { fastify, hooks } = createFastifyHarness();
    await redisPlugin(fastify, { url: redis.url, name: "ynode-redis-info-denied-test" });

    const onReady = hooks.get("onReady");
    const onClose = hooks.get("onClose");

    assert.equal(typeof onReady, "function");
    assert.equal(typeof onClose, "function");

    const originalSendCommand = fastify.redis.sendCommand.bind(fastify.redis);
    fastify.redis.sendCommand = async (args, ...rest) => {
        if (Array.isArray(args) && args[0] === "CLIENT" && args[1] === "INFO") {
            const error = new Error("NOPERM test: CLIENT INFO denied");
            error.code = "NOPERM";
            throw error;
        }
        return originalSendCommand(args, ...rest);
    };

    await assert.rejects(async () => {
        await onReady();
    }, /NOPERM/);

    await onClose();
});

test("onClose prefers close, then quit, then destroy/disconnect fallbacks", async () => {
    const scenarios = [
        { name: "close", expectedMethod: "close", removeMethod: null },
        { name: "quit", expectedMethod: "quit", removeMethod: "close" },
        { name: "destroy", expectedMethod: "destroy", removeMethod: "quit" },
        { name: "disconnect", expectedMethod: "disconnect", removeMethod: "destroy" },
    ];

    for (const scenario of scenarios) {
        const { fastify, hooks } = createFastifyHarness();
        await redisPlugin(fastify, { url: "redis://127.0.0.1:6379" });

        const onClose = hooks.get("onClose");
        assert.equal(typeof onClose, "function");

        const calls = {
            close: 0,
            quit: 0,
            destroy: 0,
            disconnect: 0,
        };

        markClientOpen(fastify.redis, true);
        fastify.redis.close = async () => {
            calls.close += 1;
        };
        fastify.redis.quit = async () => {
            calls.quit += 1;
        };
        fastify.redis.destroy = async () => {
            calls.destroy += 1;
        };
        fastify.redis.disconnect = async () => {
            calls.disconnect += 1;
        };

        if (scenario.removeMethod === "close") {
            fastify.redis.close = undefined;
        } else if (scenario.removeMethod === "quit") {
            fastify.redis.close = undefined;
            fastify.redis.quit = undefined;
        } else if (scenario.removeMethod === "destroy") {
            fastify.redis.close = undefined;
            fastify.redis.quit = undefined;
            fastify.redis.destroy = undefined;
        }

        await onClose();

        for (const method of Object.keys(calls)) {
            const expectedCalls = method === scenario.expectedMethod ? 1 : 0;
            assert.equal(
                calls[method],
                expectedCalls,
                `${scenario.name}: expected ${method} calls to equal ${expectedCalls}`,
            );
        }
    }
});
