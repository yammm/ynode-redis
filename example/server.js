import Fastify from "fastify";

import redisPlugin from "../src/plugin.js";

const app = Fastify({ logger: true });

// Register the Redis plugin to expose global caching/pub-sub clients
await app.register(redisPlugin, {
    client: "redis://127.0.0.1:6379",
});

app.get("/ping", async function (request, reply) {
    try {
        // Use the globally decorated Redis client connection
        const pong = await this.redis.ping();
        return { success: true, response: pong };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

try {
    await app.listen({ port: 3000 });
} catch (err) {
    app.log.error(err);
    process.exit(1);
}
