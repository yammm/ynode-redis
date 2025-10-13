/**
 *  A better redis Fastify plugin
 *
 * @module @ynode/redis
 */

/*
The MIT License (MIT)

Copyright (c) 2025 Michael Welter <me@mikinho.com>

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
import fp from "fastify-plugin";

import { createClient } from "redis";

async function clientInfo(client) {
    const info = await client.sendCommand(["CLIENT", "INFO"]);

    // Remove only trailing \n or \\n
    const cleaned = info.replace(/(?:\\n|\n)$/, "");

    const parsed = Object.fromEntries(
        cleaned
            .trim()
            .split(/\s+/)
            .map((pair) => {
                const [key, ...rest] = pair.split("=");
                return [key, rest.join("=")];
            }),
    );

    return parsed;
}

export default fp(async function (fastify, opts) {
    // const { url, namespace } = opts;

    const client = createClient(opts);
    let info = {};

    if (fastify.redis) {
        throw new Error("@ynode/redis has already been registered");
    }

    // sharing is caring
    fastify.decorate("redis", client);

    // Initiating a connection to the Redis server
    client.on("connect", () => fastify.log.debug(`Initiating a connection to the Redis server`));

    // Initiating a connection to the Redis server
    client.on("ready", async () => {
        info = await clientInfo(client);
        fastify.log.info(`Redis client is ready to use [${info.id}] redis://${info.addr}`);
    });

    // Connection has been closed (via .disconnect() / .close())
    client.on("end", () =>
        fastify.log.info(
            `Connection to the Redis server has been closed [${info.id}] redis://${info.addr}`,
        ),
    );

    // Always ensure there is a listener for errors in the client to prevent process crashes due to unhandled errors
    client.on("error", (error) => fastify.log.error(`Redis client error has occurred:`, error));

    // Initiating a connection to the Redis server
    client.on("reconnecting", () =>
        fastify.log.warn(
            `Client is trying to reconnect to the Redis server [${info.id}] redis://${info.addr}`,
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
        fastify.log.debug(`Attempting to close our Redis client [${info.id}] redis://${info.addr}`);
        await client.close();
    });
}, {
    fastify: "5.x",
    name: "@ynode/redis",
});
