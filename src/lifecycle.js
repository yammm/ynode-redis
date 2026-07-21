import { closeClient } from "./connection.js";
import { clientInfo } from "./info.js";
import { connectionLabel } from "./label.js";

const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;

/**
 * Resolves the startup timeout from plugin options. Falls back to the default
 * (10 s) when not specified. Throws on invalid values.
 * @param {object} [options] - Plugin options.
 * @returns {number} Timeout in milliseconds.
 */
export function startupTimeoutMs(options) {
    const timeout = options?.startupTimeout;
    if (timeout === undefined || timeout === null) {
        return DEFAULT_STARTUP_TIMEOUT_MS;
    }

    if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout < 0) {
        throw new TypeError("options.startupTimeout must be a non-negative number in milliseconds");
    }

    return timeout;
}

/**
 * Creates an Error indicating Redis startup exceeded the allowed timeout.
 * @param {number} timeoutMs - The timeout that was exceeded.
 * @returns {Error} Error with code REDIS_STARTUP_TIMEOUT.
 */
function startupTimeoutError(timeoutMs) {
    const error = new Error(`Redis startup timed out after ${timeoutMs}ms`);
    error.code = "REDIS_STARTUP_TIMEOUT";
    return error;
}

/**
 * Best-effort teardown of a Redis client after a startup timeout. Tries
 * destroy, disconnect, close, and quit in order, stopping at the first
 * available method.
 * @param {object} client - Redis client instance.
 */
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

/**
 * Races a startup flow against a timeout. If the timeout fires first, the
 * client is aborted and a REDIS_STARTUP_TIMEOUT error is thrown. A
 * timeoutMs of 0 disables the deadline entirely.
 *
 * Note: `clearTimeout` alone is not sufficient to suppress the timer
 * callback when startupFlow wins by a hair — a timer that has already
 * fired and queued its callback cannot be cancelled. A `settled` flag
 * checked inside the timer callback prevents `abortStartup` from tearing
 * down a client that startupFlow already finished connecting.
 *
 * @param {object} client - Redis client instance.
 * @param {number} timeoutMs - Deadline in milliseconds (0 to disable).
 * @param {function(): Promise<*>} startupFlow - Async function that
 *   connects and initializes the client.
 * @returns {Promise<*>} Result of the startup flow.
 */
async function startupWithTimeout(client, timeoutMs, startupFlow) {
    if (timeoutMs === 0) {
        return startupFlow();
    }

    let settled = false;
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            if (settled) {
                return;
            }
            settled = true;
            reject(startupTimeoutError(timeoutMs));

            // Fire-and-forget forced teardown after preserving timeout error identity.
            void abortStartup(client);
        }, timeoutMs);
    });

    const trackedStartup = (async () => {
        try {
            return await startupFlow();
        } finally {
            settled = true;
        }
    })();

    try {
        return await Promise.race([trackedStartup, timeoutPromise]);
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Wires Redis client event handlers and Fastify lifecycle hooks for connection
 * management, logging, and graceful shutdown.
 * @param {FastifyInstance} fastify - Fastify server instance.
 * @param {object} client - Redis client instance.
 * @param {object} [options] - Plugin options (used for url and startupTimeout).
 */
export function attachLifecycle(fastify, client, options) {
    let info;
    let startupComplete = false;
    const startupTimeout = startupTimeoutMs(options);

    // Initiating a connection to the Redis server
    client.on("connect", () => fastify.log.debug(`Initiating a connection to the Redis server`));

    // Connection established and ready to accept commands
    client.on("ready", async () => {
        if (!startupComplete) {
            return;
        }

        try {
            info = await clientInfo(client);
            fastify.log.info(`Redis client is ready to use ${connectionLabel(info, options)}`);
        } catch (error) {
            fastify.log.trace({ err: error }, `Redis CLIENT INFO error has occurred`);
        }
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
            startupComplete = true;
            fastify.log.info(`Redis client is ready to use ${connectionLabel(info, options)}`);
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
