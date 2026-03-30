/**
 * Retrieves and parses CLIENT INFO from the Redis server into a key-value object.
 * @param {object} client - Redis client with a sendCommand method.
 * @returns {Promise<Object<string, string>>} Parsed info key-value pairs.
 */
export async function clientInfo(client) {
    const info = await client.sendCommand(["CLIENT", "INFO"]);

    // Guard against Buffer or non-string responses from certain Redis client configurations
    const raw = Buffer.isBuffer(info)
        ? info.toString("utf8")
        : typeof info === "string"
          ? info
          : String(info ?? "");
    if (!raw) {
        return {};
    }

    // Remove only trailing \n or \\n
    const cleaned = raw.replace(/(?:\\n|\n)$/, "");

    return Object.fromEntries(
        cleaned
            .trim()
            .split(/\s+/)
            .map((pair) => {
                const [key, ...rest] = pair.split("=");
                return [key, rest.join("=")];
            }),
    );
}
