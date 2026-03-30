/**
 * Checks whether the Fastify instance already has a "redis" decorator.
 * @param {FastifyInstance} fastify - Fastify server instance.
 * @returns {boolean} True if the redis decorator is already registered.
 */
export function hasRedisDecorator(fastify) {
    if (typeof fastify.hasDecorator === "function") {
        return fastify.hasDecorator("redis");
    }
    return Object.prototype.hasOwnProperty.call(fastify, "redis");
}

/**
 * Throws if @ynode/redis has already been registered on the Fastify instance.
 * @param {FastifyInstance} fastify - Fastify server instance.
 * @throws {Error} When the redis decorator already exists.
 */
export function assertRedisNotRegistered(fastify) {
    if (hasRedisDecorator(fastify)) {
        throw new Error("@ynode/redis has already been registered");
    }
}
