export async function clientInfo(client) {
    const info = await client.sendCommand(["CLIENT", "INFO"]);

    // Remove only trailing \n or \\n
    const cleaned = info.replace(/(?:\\n|\n)$/, "");

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
