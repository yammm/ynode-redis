# @ynode/redis

Copyright (c) 2025 Michael Welter <me@mikinho.com>

[![npm version](https://img.shields.io/npm/v/@ynode/redis.svg)](https://www.npmjs.com/package/@ynode/redis)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A better [Redis](https://redis.io/) [Fastify](https://www.fastify.io/) plugin that uses the official 
[Redis](https://www.npmjs.com/package/redis) library

## Installation

Install the package and its required peer dependency, `redis`.

```sh
npm install @ynode/redis redis


## Installation

```sh
npm install @ynode/redis
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

Register the plugin with your Fastify instance. Any options you provide are passed directly to the underlying `node-redis` `createClient` method.

```javascript
import Fastify from "fastify";
import fastifyRedis from "@ynode/redis";

const fastify = Fastify({
    logger: true
});

// Register the plugin with options
fastify.register(fastifyRedis, {
    url: "redis://localhost:6379"
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

## Options

This plugin passes all options directly to the `createClient` function from the official `redis` library.

For a full list of available options, please see the **[official `node-redis` documentation](https://github.com/redis/node-redis/blob/master/docs/client-configuration.md)**.

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

This project is licensed under the [MIT Lisence](./LICENSE).