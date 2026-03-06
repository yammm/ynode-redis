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
