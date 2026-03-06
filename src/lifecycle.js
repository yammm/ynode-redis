import { closeClient } from "./connection.js";
import { clientInfo } from "./info.js";
import { connectionLabel } from "./label.js";

export function attachLifecycle(fastify, client, options) {
    let info;

    // Initiating a connection to the Redis server
    client.on("connect", () => fastify.log.debug(`Initiating a connection to the Redis server`));

    // Initiating a connection to the Redis server
    client.on("ready", async () => {
        try {
            await client.sendCommand(["CLIENT", "SETNAME", options?.name ?? "@ynode/redis"]);
            info = await clientInfo(client);
            fastify.log.info(`Redis client is ready to use ${connectionLabel(info, options)}`);
        } catch (error) {
            fastify.log.trace(`Redis CLIENT SETNAME or INFO error has occurred:`, error);
        }
    });

    // Connection has been closed (via .disconnect() / .close())
    client.on("end", () =>
        fastify.log.info(
            `Connection to the Redis server has been closed ${connectionLabel(info, options)}`,
        ),
    );

    // Always ensure there is a listener for errors in the client to prevent process crashes due to unhandled errors
    client.on("error", (error) => fastify.log.error(`Redis client error has occurred:`, error));

    // Initiating a connection to the Redis server
    client.on("reconnecting", () =>
        fastify.log.warn(
            `Client is trying to reconnect to the Redis server ${connectionLabel(info, options)}`,
        ),
    );

    fastify.addHook("onReady", async () => {
        await client.connect();
        info = await clientInfo(client);
    });

    fastify.addHook("onClose", async () => {
        if (!client.isOpen) {
            return;
        }

        fastify.log.debug(`Attempting to close our Redis client ${connectionLabel(info, options)}`);
        await closeClient(client);
    });
}
