# @ynode/redis

Copyright (c) 2025 Michael Welter <me@mikinho.com>

[![npm version](https://img.shields.io/npm/v/@ynode/redis.svg)](https://www.npmjs.com/package/@ynode/redis) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A better [Redis](https://redis.io/) [Fastify](https://www.fastify.io/) plugin that uses the official [Redis](https://www.npmjs.com/package/redis) library

## Why?

A lightweight **Fastify** plugin that exposes a single **node‑redis** client (`redis` package) on your Fastify instance and handles connection lifecycle (connect → ready → reconnect → close) for you.

- ✅ Uses the **official** [`redis`](https://www.npmjs.com/package/redis) client (not ioredis)
- ✅ Clean Fastify integration with proper startup/shutdown hooks
- ✅ Simple API: `fastify.redis` everywhere in your app

> If you are looking for the ioredis‑based plugin, see [`@fastify/redis`](https://github.com/fastify/fastify-redis).

## Installation

Requires Node.js 20 or newer, Fastify 5, node-redis 6, and Redis server 7.2 or newer. Install the package and its Redis peer dependency:

```sh
npm install @ynode/redis redis
```

## Usage

Register the plugin with your Fastify instance. The plugin consumes `namespace` and `startupTimeout`; all other options are passed to the underlying node-redis `createClient` method.

```javascript
import Fastify from "fastify";
import fastifyRedis from "@ynode/redis";

const fastify = Fastify({
    logger: true,
});

// Register the plugin with options
await fastify.register(fastifyRedis, {
    url: "redis://localhost:6379",
});

// Access the redis client from the fastify instance
fastify.get("/", async (request, reply) => {
    const value = await fastify.redis.get("mykey");
    return { key: "mykey", value: value };
});

const start = async () => {
    try {
        await fastify.listen({ port: 3000 });
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
```

## Connection Lifecycle

This plugin manages Redis connection lifecycle using Fastify hooks:

- Connects during Fastify startup (`onReady`)
- Closes the Redis client during Fastify shutdown (`onClose`)

Startup is fail-fast. If Redis cannot be reached (or startup metadata commands fail), `fastify.listen()` rejects and the server will not start.

Startup is bounded to 10 seconds by default. Set `startupTimeout: 0` to use node-redis connection behavior without a plugin-level deadline.

## Key Namespacing

Use `withNamespace(namespace)` as the default, concurrency-safe way to scope keys. It returns a scoped client view without mutating global `fastify.redis.namespace`.

```javascript
await fastify.register(fastifyRedis, {
    url: "redis://localhost:6379",
});

const tenantRedis = fastify.redis.withNamespace("codex");

await tenantRedis.set("status", "online"); // writes "codex:status"
await tenantRedis.get("status"); // reads "codex:status"
```

Scoped clients can safely coexist:

```javascript
const tenantA = fastify.redis.withNamespace("alpha");
const tenantB = fastify.redis.withNamespace("beta");

await tenantA.set("counter", "1"); // alpha:counter
await tenantB.set("counter", "1"); // beta:counter
```

The mutable `fastify.redis.namespace` property is still supported for backward compatibility:

```javascript
fastify.redis.namespace = "klingon";
await fastify.redis.set("status", "battle-ready"); // writes "klingon:status"
```

If future `node-redis` internals change in a way that prevents safe namespace interception, this plugin now fails fast at startup with `REDIS_NAMESPACE_INCOMPATIBLE_CLIENT` instead of silently writing unprefixed keys.

To bypass namespacing for specific operations, use `raw` (works for base and scoped clients):

```javascript
await fastify.redis.raw.get("status"); // reads the literal key "status" (no prefix)
await fastify.redis.raw.set("status", "manual"); // writes key "status" (no prefix)

const tenantRedis = fastify.redis.withNamespace("codex");
await tenantRedis.raw.get("status"); // still unprefixed
```

Advanced flows inherit the scope of the client that creates them:

```javascript
const tenantRedis = fastify.redis.withNamespace("codex");

const transaction = tenantRedis.multi();
transaction.set("status", "ready").get("status");
await transaction.exec(); // operates on codex:status

const pipeline = tenantRedis.multi();
pipeline.set("counter", "1").get("counter");
await pipeline.execAsPipeline(); // operates on codex:counter

const rawTransaction = tenantRedis.raw.multi();
rawTransaction.set("status", "literal");
await rawTransaction.exec(); // operates on literal "status"
```

Hash, set, and sorted-set scan iterators retain the scope of the client that creates them. Logical keys are always prefixed, even when they already begin with the namespace text; use `raw` when you intentionally have a physical Redis key.

Namespacing is a key-rewriting convenience, not an authorization boundary. Database-wide commands such as `SCAN`, `KEYS`, and `RANDOMKEY` operate on the physical database and are not tenant-filtered. A client returned by `duplicate()` is also independent and is not namespaced or closed by this plugin. Use Redis ACLs or separate databases/instances when hostile tenants must be isolated.

Commands whose key positions Redis reports as movable are rewritten when the plugin has an exact resolver. If an active namespace cannot be applied safely, the command fails closed instead of running against unprefixed keys; use `raw` only when that database-wide access is intentional.

Namespacing rewrites command inputs, not Redis replies. Commands that return key names, such as the pop families, can therefore return their physical prefixed names.

## Health and Readiness

This plugin exposes simple probe helpers:

- `fastify.redis.readiness()`: lightweight state snapshot
- `fastify.redis.healthcheck()`: ping-based health check that never throws

```javascript
const readiness = fastify.redis.readiness();
// { isOpen: true, isReady: true, namespace: "codex" }

const health = await fastify.redis.healthcheck();
// { ok: true, ping: "PONG", latencyMs: 1, isOpen: true, isReady: true, namespace: "codex" }
```

## Options

### Plugin-specific options

- `name` (`string`, optional): connection name used with Redis `CLIENT SETNAME`. Default: `@ynode/redis`
- `namespace` (`string`, optional): key prefix for Redis commands that operate on keys. `:` is reserved as the separator; a trailing colon is normalized away, while embedded colons are rejected. Example: `namespace: "codex"` prefixes keys as `codex:<key>`.
- `startupTimeout` (`number`, default: `10000`): maximum startup time in milliseconds. Set to `0` to disable the plugin deadline.

### Redis client options

All other options are passed directly to the `createClient` function from the official `redis` library.

For a full list of available options, please see the **[official `node-redis` documentation](https://github.com/redis/node-redis/blob/master/docs/client-configuration.md)**.

## TypeScript

This package ships TypeScript declarations, including Fastify instance augmentation for `fastify.redis`.

```typescript
import Fastify from "fastify";
import fastifyRedis from "@ynode/redis";

const app = Fastify();
await app.register(fastifyRedis, { url: "redis://localhost:6379" });

await app.redis.set("health", "ok");
```

## Testing and CI

- `npm test` runs unit and integration tests. Use `npm run lint` and `npm run format:check` for static checks.
- Integration tests use `REDIS_URL` when provided.
- If `REDIS_URL` is not set, tests try to start a local `redis-server` automatically.
- CI runs on push and pull request, starts a Redis service, and executes formatting, lint, and test gates.

## License

This project is licensed under the [MIT License](./LICENSE).
