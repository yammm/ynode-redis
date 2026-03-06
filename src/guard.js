export function hasRedisDecorator(fastify) {
    if (typeof fastify.hasDecorator === "function") {
        return fastify.hasDecorator("redis");
    }
    return Object.prototype.hasOwnProperty.call(fastify, "redis");
}

export function assertRedisNotRegistered(fastify) {
    if (hasRedisDecorator(fastify)) {
        throw new Error("@ynode/redis has already been registered");
    }
}
