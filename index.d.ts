import type { FastifyPluginAsync } from "fastify";
import type { RedisClientOptions, RedisClientType } from "redis";

export type RedisNamespaceCommandSpec =
    | {
          /** One-based index of the first key argument. */
          firstKey: number;
          /** One-based index of the last key argument. Negative values count from the end. */
          lastKey: number;
          /** Distance between key arguments. Defaults to 1. */
          step?: number;
      }
    | {
          /** Marks a custom command as safe to run without key rewriting. */
          keyless: true;
      };

export type RedisNamespaceCommandMap =
    Record<string, RedisNamespaceCommandSpec> | Map<string, RedisNamespaceCommandSpec>;

export interface FastifyRedisOptions extends RedisClientOptions {
    name?: string;
    namespace?: string;
    namespaceCommands?: RedisNamespaceCommandMap;
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

export interface RedisHealthcheckOptions {
    /** Ping deadline in milliseconds. Defaults to 5000. */
    timeoutMs?: number;
}

export interface RedisNamespaceHelpers {
    readonly raw: RedisClientType;
    withNamespace(namespace?: string): ScopedRedisClientType;
    withoutNamespace<T>(callback: () => T): T;
    registerNamespaceCommand(
        command: string,
        spec: RedisNamespaceCommandSpec,
    ): NamespacedRedisClientType;
    registerNamespaceCommands(commands: RedisNamespaceCommandMap): NamespacedRedisClientType;
    readiness(): RedisReadinessStatus;
    healthcheck(options?: RedisHealthcheckOptions): Promise<RedisHealthcheckResult>;
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
