# @ynode/redis

Copyright (c) 2025 Michael Welter <me@mikinho.com>

[![npm version](https://img.shields.io/npm/v/@ynode/redis.svg)](https://www.npmjs.com/package/@ynode/redis)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A better [Redis](https://redis.io/) [Fastify](https://www.fastify.io/) plugin that uses the official
[Redis](https://www.npmjs.com/package/redis) library

## Why?

A lightweight **Fastify** plugin that exposes a single **node‑redis** client (`redis` package) on
your Fastify instance and handles connection lifecycle (connect → ready → reconnect → close) for
you.

- ✅ Uses the **official** [`redis`](https://www.npmjs.com/package/redis) client (not ioredis)
- ✅ Clean Fastify integration with proper startup/shutdown hooks
- ✅ Simple API: `fastify.redis` everywhere in your app

> If you are looking for the ioredis‑based plugin, see
> [`@fastify/redis`](https://github.com/fastify/fastify-redis).

## Installation

Install the package and its required peer dependency, `redis`.

```sh
npm install @ynode/redis redis
```

## Basic Usage

```javascript
import redis from "@ynode/redis";

if (fastify.argv.redis) {
    // connect to redis
    await fastify.register(redis, { url: fastify.argv.redis });
}
```

## Usage

Register the plugin with your Fastify instance. Any options you provide are passed directly to the
underlying `node-redis` `createClient` method.

```javascript
import Fastify from "fastify";
import fastifyRedis from "@ynode/redis";

const fastify = Fastify({
    logger: true,
});

// Register the plugin with options
fastify.register(fastifyRedis, {
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

Startup is fail-fast. If Redis cannot be reached (or startup metadata commands fail), `fastify.listen()`
rejects and the server will not start.

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

To bypass namespacing for specific operations, use `raw` (works for base and scoped clients):

```javascript
await fastify.redis.raw.get("status"); // reads the literal key "status" (no prefix)
await fastify.redis.raw.set("status", "manual"); // writes key "status" (no prefix)

const tenantRedis = fastify.redis.withNamespace("codex");
await tenantRedis.raw.get("status"); // still unprefixed
```

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

- `name` (`string`, optional): connection name used with Redis `CLIENT SETNAME`.
  Default: `@ynode/redis`
- `namespace` (`string`, optional): key prefix for Redis commands that operate on keys.
  Example: `namespace: "codex"` prefixes keys as `codex:<key>`.

### Redis client options

All other options are passed directly to the `createClient` function from the official `redis`
library.

For a full list of available options, please see the
**[official `node-redis` documentation](https://github.com/redis/node-redis/blob/master/docs/client-configuration.md)**.

## TypeScript

This package ships TypeScript declarations, including Fastify instance augmentation for
`fastify.redis`.

```typescript
import Fastify from "fastify";
import fastifyRedis from "@ynode/redis";

const app = Fastify();
await app.register(fastifyRedis, { url: "redis://localhost:6379" });

await app.redis.set("health", "ok");
```

## Testing and CI

- `npm test` runs project linting, unit tests, and integration tests.
- Integration tests use `REDIS_URL` when provided.
- If `REDIS_URL` is not set, tests try to start a local `redis-server` automatically.
- CI runs on push and pull request, starts a Redis service, and executes `npm test`.

## Release

To release a new version, use the included Makefile.

```sh
make release VERSION=1.2.3
```

This command will:

1.  Check that `npm` and `package.json` exist.
2.  Run `npm version` to update `package.json` and create a git tag.
3.  Publish the package to npm.
4.  Push the commit and tags to the git remote.

## License

This project is licensed under the [MIT License](./LICENSE).
