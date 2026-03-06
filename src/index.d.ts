import type { FastifyPluginAsync } from "fastify";
import type { RedisClientOptions, RedisClientType } from "redis";

export interface FastifyRedisOptions extends RedisClientOptions {
    name?: string;
}

declare module "fastify" {
    interface FastifyInstance {
        redis: RedisClientType;
    }
}

declare const fastifyRedis: FastifyPluginAsync<FastifyRedisOptions>;

export default fastifyRedis;
