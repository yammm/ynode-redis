import { closeClient } from "./connection.js";
import { clientInfo } from "./info.js";
import { connectionLabel } from "./label.js";

const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;

function startupTimeoutMs(options) {
    const timeout = options?.startupTimeout;
    if (timeout === undefined || timeout === null) {
        return DEFAULT_STARTUP_TIMEOUT_MS;
    }

    if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout < 0) {
        throw new TypeError("options.startupTimeout must be a non-negative number in milliseconds");
    }

    return timeout;
}

function startupTimeoutError(timeoutMs) {
    const error = new Error(`Redis startup timed out after ${timeoutMs}ms`);
    error.code = "REDIS_STARTUP_TIMEOUT";
    return error;
}

async function abortStartup(client) {
    const closeMethods = ["destroy", "disconnect", "close", "quit"];

    for (const method of closeMethods) {
        if (typeof client[method] !== "function") {
            continue;
        }

        if ((method === "close" || method === "quit") && !client.isOpen) {
            continue;
        }

        try {
            await client[method]();
        } catch {
            // Best effort shutdown on startup timeout.
        }
        return;
    }
}

async function startupWithTimeout(client, timeoutMs, startupFlow) {
    if (timeoutMs === 0) {
        return startupFlow();
    }

    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            void abortStartup(client).finally(() => {
                reject(startupTimeoutError(timeoutMs));
            });
        }, timeoutMs);
    });

    try {
        return await Promise.race([startupFlow(), timeoutPromise]);
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Wires Redis client event handlers and Fastify lifecycle hooks for connection
 * management, logging, and graceful shutdown.
 * @param {FastifyInstance} fastify - Fastify server instance.
 * @param {object} client - Redis client instance.
 * @param {object} [options] - Plugin options (used for name, url, startupTimeout).
 */
export function attachLifecycle(fastify, client, options) {
    let info;
    const startupTimeout = startupTimeoutMs(options);

    // Initiating a connection to the Redis server
    client.on("connect", () => fastify.log.debug(`Initiating a connection to the Redis server`));

    // Connection established and ready to accept commands
    client.on("ready", () => {
        client
            .sendCommand(["CLIENT", "SETNAME", options?.name ?? "@ynode/redis"])
            .then(() => clientInfo(client))
            .then((result) => {
                info = result;
                fastify.log.info(`Redis client is ready to use ${connectionLabel(info, options)}`);
            })
            .catch((error) => {
                fastify.log.trace(
                    { err: error },
                    `Redis CLIENT SETNAME or INFO error has occurred`,
                );
            });
    });

    // Connection has been closed (via .disconnect() / .close())
    client.on("end", () =>
        fastify.log.info(
            `Connection to the Redis server has been closed ${connectionLabel(info, options)}`,
        ),
    );

    // Always ensure there is a listener for errors in the client to prevent process crashes due to unhandled errors
    client.on("error", (error) =>
        fastify.log.error(
            { err: error },
            `Redis client error has occurred ${connectionLabel(info, options)}`,
        ),
    );

    // Driver is attempting to re-establish a lost connection
    client.on("reconnecting", () =>
        fastify.log.warn(
            `Client is trying to reconnect to the Redis server ${connectionLabel(info, options)}`,
        ),
    );

    fastify.addHook("onReady", async () => {
        await startupWithTimeout(client, startupTimeout, async () => {
            await client.connect();
            info = await clientInfo(client);
        });
    });

    fastify.addHook("onClose", async () => {
        if (!client.isOpen) {
            return;
        }

        fastify.log.debug(`Attempting to close our Redis client ${connectionLabel(info, options)}`);
        try {
            await closeClient(client);
        } catch (error) {
            fastify.log.warn(
                { err: error },
                `Error closing Redis client ${connectionLabel(info, options)}`,
            );
        }
    });
}
