import Fastify from "fastify";

import redisPlugin from "../src/plugin.js";

const app = Fastify({ logger: true });

// Register the Redis plugin to expose global caching/pub-sub clients
await app.register(redisPlugin, {
    url: "redis://127.0.0.1:6379",
});

app.get("/ping", async function (_request, reply) {
    try {
        // Use the globally decorated Redis client connection
        const pong = await this.redis.ping();
        return { success: true, response: pong };
    } catch (err) {
        reply.code(503);
        return { success: false, error: err.message };
    }
});

let closing = false;
const shutdown = async (signal) => {
    if (closing) {
        return;
    }
    closing = true;
    app.log.info({ signal }, "Closing Fastify and Redis");
    try {
        await app.close();
    } catch (err) {
        app.log.error({ err }, "Shutdown failed");
        process.exitCode = 1;
    }
};

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
        // Intentional fire-and-forget: shutdown handles and records its own errors.
        void shutdown(signal);
    });
}

try {
    await app.listen({ port: 3000 });
} catch (err) {
    app.log.error({ err }, "Startup failed");
    await shutdown("startup-error");
    process.exitCode = 1;
}
