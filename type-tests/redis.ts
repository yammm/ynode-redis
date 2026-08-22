import fastifyRedis, {
    type FastifyRedisOptions,
    type NamespacedRedisClientType,
    type RedisHealthcheckResult,
    type RedisNamespaceCommandMap,
    type RedisNamespaceScanOptions,
    type ScopedRedisClientType,
} from "@ynode/redis";
import metadata from "@ynode/redis/package.json" with { type: "json" };
import Fastify from "fastify";

const namespaceCommands = new Map([
    ["MODULEGET", { firstKey: 1, lastKey: 1 }],
    ["MODULE.INFO", { keyless: true }],
]) satisfies RedisNamespaceCommandMap;

const options = {
    name: "redis-consumer",
    namespace: "tenant",
    namespaceCommands,
    startupTimeout: 5_000,
    url: "redis://127.0.0.1:6379",
} satisfies FastifyRedisOptions;

const app = Fastify();
await app.register(fastifyRedis, options);

const client: NamespacedRedisClientType = app.redis;
const scoped: ScopedRedisClientType = client.withNamespace("other");
const health: RedisHealthcheckResult = await scoped.healthcheck({ timeoutMs: 100 });

client.registerNamespaceCommand("MODULEGET", { firstKey: 1, lastKey: 1, step: 1 });
client.registerNamespaceCommands({ "MODULE.INFO": { keyless: true } });
await client.raw.get("literal-key");

const namespaceScanOptions = {
    MATCH: "session:*",
    COUNT: 100,
    TYPE: "string",
} satisfies RedisNamespaceScanOptions;
for await (const keys of scoped.scanNamespaceIterator(namespaceScanOptions)) {
    keys satisfies Array<string | Buffer>;
}

// @ts-expect-error startupTimeout must be numeric.
const invalidOptions: FastifyRedisOptions = { startupTimeout: "slow" };

metadata.name satisfies string;
void health;
void invalidOptions;
