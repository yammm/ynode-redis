import type { FastifyPluginAsync } from "fastify";
import type { RedisClientOptions, RedisClientType } from "redis";

export interface FastifyRedisOptions extends RedisClientOptions {
    name?: string;
    namespace?: string;
    startupTimeout?: number;
}

export interface RedisReadinessStatus {
    isOpen: boolean;
    isReady: boolean;
    namespace?: string;
}

export interface RedisHealthError {
    name: string;
    message: string;
    code?: string | number;
}

export interface RedisHealthcheckResult extends RedisReadinessStatus {
    ok: boolean;
    ping?: string;
    latencyMs: number;
    error?: RedisHealthError;
}

export interface RedisNamespaceHelpers {
    readonly raw: RedisClientType;
    withNamespace(namespace?: string): ScopedRedisClientType;
    withoutNamespace<T>(callback: () => T): T;
    readiness(): RedisReadinessStatus;
    healthcheck(): Promise<RedisHealthcheckResult>;
}

export interface NamespacedRedisClientType extends RedisClientType, RedisNamespaceHelpers {
    namespace?: string;
}

export interface ScopedRedisClientType extends RedisClientType, RedisNamespaceHelpers {
    readonly namespace?: string;
}

declare module "fastify" {
    interface FastifyInstance {
        redis: NamespacedRedisClientType;
    }
}

declare const fastifyRedis: FastifyPluginAsync<FastifyRedisOptions>;

export default fastifyRedis;
