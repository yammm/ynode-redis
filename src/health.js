import { raceWithDeadline } from "./deadline.js";

const DEFAULT_HEALTHCHECK_TIMEOUT_MS = 5_000;

/**
 * Creates an Error indicating the healthcheck ping exceeded its deadline.
 * @param {number} timeoutMs - The deadline that was exceeded.
 * @returns {Error} Error with code REDIS_HEALTHCHECK_TIMEOUT.
 */
function healthcheckTimeoutError(timeoutMs) {
    const error = new Error(`Redis healthcheck ping timed out after ${timeoutMs}ms`);
    error.code = "REDIS_HEALTHCHECK_TIMEOUT";
    return error;
}

/**
 * Converts an error into a plain serializable object with name, message, and optional code.
 * @param {*} error - Error instance or arbitrary value.
 * @returns {{ name: string, message: string, code: (string|number|undefined) }} Serializable error descriptor.
 */
function errorToObject(error) {
    if (!error || typeof error !== "object") {
        return { name: "Error", message: String(error) };
    }

    return {
        name: error.name ?? "Error",
        message: error.message ?? String(error),
        code: error.code,
    };
}

/**
 * Attaches readiness() and healthcheck() methods to a Redis client.
 * readiness() returns synchronous open/ready/namespace state.
 * healthcheck() sends a PING via the raw client and returns latency and ok status; never throws.
 * The ping is bounded by a deadline (default 5000 ms, override via options.timeoutMs) so a
 * stalled socket resolves unhealthy instead of hanging the probe.
 * @param {object} client - Redis client instance.
 */
export function attachHealth(client) {
    const sendRawCommand =
        typeof client.raw?.sendCommand === "function"
            ? client.raw.sendCommand.bind(client.raw)
            : client.sendCommand.bind(client);

    function readiness() {
        return {
            isOpen: Boolean(client.isOpen),
            isReady: Boolean(client.isReady),
            namespace: client.namespace,
        };
    }

    Object.defineProperty(client, "readiness", {
        configurable: true,
        enumerable: false,
        value: readiness,
    });

    Object.defineProperty(client, "healthcheck", {
        configurable: true,
        enumerable: false,
        value: async (options = {}) => {
            const requestedTimeoutMs = options?.timeoutMs;
            // healthcheck never throws, so invalid overrides fall back to the default.
            const timeoutMs =
                typeof requestedTimeoutMs === "number" &&
                Number.isFinite(requestedTimeoutMs) &&
                requestedTimeoutMs > 0
                    ? requestedTimeoutMs
                    : DEFAULT_HEALTHCHECK_TIMEOUT_MS;
            const startedAtMs = Date.now();
            try {
                const pingResponse = await raceWithDeadline(
                    sendRawCommand(["PING"]),
                    timeoutMs,
                    () => healthcheckTimeoutError(timeoutMs),
                );
                const ping = Buffer.isBuffer(pingResponse)
                    ? pingResponse.toString("utf8")
                    : String(pingResponse);
                return {
                    ...readiness(),
                    ok: ping === "PONG",
                    ping,
                    latencyMs: Date.now() - startedAtMs,
                };
            } catch (error) {
                return {
                    ...readiness(),
                    ok: false,
                    latencyMs: Date.now() - startedAtMs,
                    error: errorToObject(error),
                };
            }
        },
    });
}
