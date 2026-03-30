/**
 * Closes a Redis client, handling differences between node-redis v4 and v5 APIs.
 * Tries close(), then quit(), then destroy()/disconnect() in order of preference.
 * @param {object} client - Redis client instance.
 * @returns {Promise<void>}
 */
export async function closeClient(client) {
    // node-redis v5: close(); v4: quit() / disconnect()
    if (typeof client.close === "function") {
        await client.close();
    } else if (typeof client.quit === "function") {
        await client.quit();
    } else if (typeof client.destroy === "function" || typeof client.disconnect === "function") {
        await (client.destroy?.() ?? client.disconnect());
    }
}
