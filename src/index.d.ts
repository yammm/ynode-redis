import type { FastifyPluginAsync } from "fastify";
import type { RedisClientOptions, RedisClientType } from "redis";

export interface FastifyRedisOptions extends RedisClientOptions {
    name?: string;
    namespace?: string;
}

export interface NamespacedRedisClientType extends RedisClientType {
    namespace?: string;
    raw: RedisClientType;
    withoutNamespace<T>(callback: () => T): T;
}

declare module "fastify" {
    interface FastifyInstance {
        redis: NamespacedRedisClientType;
    }
}

declare const fastifyRedis: FastifyPluginAsync<FastifyRedisOptions>;

export default fastifyRedis;
