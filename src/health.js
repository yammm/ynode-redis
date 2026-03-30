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
        value: async () => {
            const startedAtMs = Date.now();
            try {
                const ping = await sendRawCommand(["PING"]);
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
