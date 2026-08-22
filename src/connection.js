/**
 * Closes a Redis client, handling differences between node-redis v4 and v5 APIs.
 * Tries close(), then quit(), then destroy()/disconnect() in order of preference.
 *
 * Graceful preference order — the politest available close path runs first.
 * This is intentionally the reverse of abortStartup() in lifecycle.js, which
 * handles a timed-out startup and therefore reaches for the most forceful
 * teardown first.
 * @param {object} client - Redis client instance.
 * @returns {Promise<void>}
 */
export async function closeClient(client) {
    // node-redis v5: close(); v4: quit() / disconnect()
    if (typeof client.close === "function") {
        await client.close();
    } else if (typeof client.quit === "function") {
        await client.quit();
    } else if (typeof client.destroy === "function") {
        await client.destroy();
    } else if (typeof client.disconnect === "function") {
        await client.disconnect();
    }
}
