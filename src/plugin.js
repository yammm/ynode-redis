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
import { attachLifecycle } from "./lifecycle.js";
import { attachNamespace } from "./namespace.js";

/**
 * This plugin adds a "redis" decorator to the Fastify server instance,
 * allowing for easy access to the Redis client.
 *
 * @param {FastifyInstance} fastify The Fastify instance.
 * @param {object} options Plugin options, directly passed to redis.createClient.
 * @param {string} [options.name] Optionally set a connection name. Useful for debugging
 * @param {string} [options.namespace] Optional key namespace prefix for Redis key commands
 */
export default fp(
    async function (fastify, options) {
        const { namespace, ...clientOptions } = options ?? {};
        const client = createClient(clientOptions);
        assertRedisNotRegistered(fastify);

        attachNamespace(client, namespace);
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
