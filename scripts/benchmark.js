#!/usr/bin/env node
import fastify from "fastify";

import redisPlugin from "../src/plugin.js";

async function runBenchmark() {
    const app = fastify();

    // Register our plugin
    await app.register(redisPlugin, {
        url: "redis://localhost:6379",
        namespace: "perf-test",
    });

    await app.ready();

    const client = app.redis;

    // Warm up the client to ensure commands specs are loaded
    await client.set("warmup", "1");
    await client.raw.set("warmup", "1");

    const ITERATIONS = 10000;
    const value = "bench-data-payload-string-to-simulate-workload";

    console.log(`Starting benchmark with ${ITERATIONS} iterations...`);

    // 1. Raw Client (Base Performance)
    console.log(`\n--- RAW CLIENT (No Namespace) ---`);
    const t0 = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
        await client.raw.set(`raw-key-${i}`, value);
    }
    const t1 = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
        await client.raw.get(`raw-key-${i}`);
    }
    const t2 = performance.now();

    const rawSetTime = t1 - t0;
    const rawGetTime = t2 - t1;
    console.log(
        `RAW SET: ${rawSetTime.toFixed(2)}ms (${(ITERATIONS / (rawSetTime / 1000)).toFixed(0)} ops/sec)`,
    );
    console.log(
        `RAW GET: ${rawGetTime.toFixed(2)}ms (${(ITERATIONS / (rawGetTime / 1000)).toFixed(0)} ops/sec)`,
    );

    // 2. Namespaced Client (Overhead Performance)
    const nsClient = client.withNamespace("tenant-abc");
    console.log(`\n--- NAMESPACED CLIENT ---`);
    const t3 = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
        await nsClient.set(`ns-key-${i}`, value);
    }
    const t4 = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
        await nsClient.get(`ns-key-${i}`);
    }
    const t5 = performance.now();

    const nsSetTime = t4 - t3;
    const nsGetTime = t5 - t4;
    console.log(
        `NS SET: ${nsSetTime.toFixed(2)}ms (${(ITERATIONS / (nsSetTime / 1000)).toFixed(0)} ops/sec)`,
    );
    console.log(
        `NS GET: ${nsGetTime.toFixed(2)}ms (${(ITERATIONS / (nsGetTime / 1000)).toFixed(0)} ops/sec)`,
    );

    // Cleanup and exit
    performance.now();
    const pipeline = client.raw.multi();
    for (let i = 0; i < ITERATIONS; i++) {
        pipeline.del(`raw-key-${i}`);
        pipeline.del(`tenant-abc:ns-key-${i}`);
    }
    await pipeline.execAsPipeline();
    performance.now();

    console.log(`\nSummary:`);
    console.log(
        `SET Overhead: ${(((nsSetTime - rawSetTime) / rawSetTime) * 100).toFixed(2)}% (+${(nsSetTime - rawSetTime).toFixed(2)}ms)`,
    );
    console.log(
        `GET Overhead: ${(((nsGetTime - rawGetTime) / rawGetTime) * 100).toFixed(2)}% (+${(nsGetTime - rawGetTime).toFixed(2)}ms)`,
    );

    await app.close();
}

runBenchmark().catch(console.error);
