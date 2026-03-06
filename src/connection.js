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
