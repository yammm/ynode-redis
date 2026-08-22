/**
 *  A better redis Fastify plugin
 *
 * @module @ynode/redis
 */

/*
The MIT License (MIT)

Copyright (c) 2025 Michael Welter <me@mikinho.com>

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

import fp from "fastify-plugin";
import { createClient } from "redis";

import { assertRedisNotRegistered } from "./guard.js";
import { attachHealth } from "./health.js";
import { attachLifecycle, startupTimeoutMs } from "./lifecycle.js";
import { attachNamespace, normalizeNamespace } from "./namespace.js";

/**
 * This plugin adds a "redis" decorator to the Fastify server instance,
 * allowing for easy access to the Redis client.
 *
 * @param {FastifyInstance} fastify The Fastify instance.
 * @param {object} options Plugin options. Keys other than `namespace`,
 *   `namespaceCommands`, and `startupTimeout` are passed to redis.createClient.
 * @param {string} [options.name] Optionally set a connection name. Useful for debugging
 * @param {string} [options.namespace] Optional key namespace prefix for Redis key commands
 * @param {object|Map} [options.namespaceCommands] Optional custom command key metadata
 * @param {number} [options.startupTimeout=10000] Startup timeout in milliseconds. Set to 0 to disable.
 */
export default fp(
    async function redisPlugin(fastify, options) {
        assertRedisNotRegistered(fastify);
        // Validation-only call: fail fast on a bad startupTimeout before the
        // client is created. attachLifecycle resolves the value again when it
        // arms the startup deadline, so the result here is intentionally unused.
        startupTimeoutMs(options);
        const {
            namespace,
            namespaceCommands,
            startupTimeout: _startupTimeout,
            ...clientOptions
        } = options ?? {};
        const normalizedNamespace = normalizeNamespace(namespace);
        clientOptions.name ??= "@ynode/redis";
        const client = createClient(clientOptions);

        attachNamespace(client, normalizedNamespace, { namespaceCommands });
        attachHealth(client);

        // sharing is caring
        fastify.decorate("redis", client);
        attachLifecycle(fastify, client, options);
    },
    {
        fastify: "5.x",
        name: "@ynode/redis",
    },
);
