# Redis Standards

## Scope

Apply this profile to Redis-backed caches, sessions, rate limits, queues, streams, coordination, pub/sub, and authoritative data. It covers application code, key and value schemas, Lua scripts or Redis Functions, migrations, and code-visible operational behavior.

Use it with `CODING_STANDARDS.md` and the applicable language and runtime profiles. Record the supported Redis and client versions, standalone, Sentinel, Cluster, or managed topology, persistence and replication expectations, `maxmemory` and eviction policy, enabled modules, protocol, and exact validation commands in `PROJECT_PROFILE.md`.

Apply `LUA.md` to nontrivial Redis scripts, while treating the declared Redis version and its scripting or Functions API as the authoritative embedded host.

Classify each use before reviewing it: disposable cache, reproducible derived state, ephemeral coordination, durable messaging, or authoritative data. That classification determines whether loss, staleness, duplication, eviction, and failover are defects. Label alternative data structures and unmeasured tuning as optional improvements.

## Keyspace and data contracts

- Give keys a documented namespace, entity identity, purpose, schema version where needed, and cluster hash-tag policy. Avoid collisions between services, environments, tenants, tests, and incompatible value formats.
- Select the Redis data type from required operations, ordering, cardinality, precision, and memory behavior. Do not serialize an opaque blob when a native type materially improves atomicity or bounded access, and do not force a complex native structure when one bounded value is the clearer contract.
- Define encoding, serialization version, numeric range, timestamp units, missing semantics, and corruption behavior. Redis strings are bytes; client libraries do not create a universal text or object schema.
- For clients, adapters, plugins, and proxies, treat RESP version, command names and arity, binary inputs, nulls, error replies, push messages, response types, and ordering as public protocol contracts. Keep server errors distinct from transport and protocol failures.
- Bound key count, value size, collection cardinality, member size, and per-entity fan-out. Large keys and hot keys can block work, amplify replication, and make deletion, migration, failover, or resharding expensive.
- Give every ephemeral key an intentional TTL and define who creates, refreshes, observes, and removes it. Verify whether each write preserves, replaces, or drops the existing TTL.
- Do not treat expiration as an exact scheduler or proof of immediate physical deletion. Callers must handle a key disappearing between operations, and must not require cleanup work or keyspace notifications at the exact TTL deadline.
- Define whether absence means cache miss, expired state, deleted domain object, processing failure, or unauthorized access. Negative caching needs a short, explicit staleness policy.
- Do not use logical Redis databases as a security or strong tenancy boundary, and account for Cluster deployments supporting only database zero.

## Cache consistency

- Identify the authoritative source and use an explicit cache-aside, write-through, write-behind, or event-driven invalidation contract. Name the allowed stale window and recovery path.
- Order database writes and invalidation or cache writes so a failure cannot indefinitely preserve an incorrect value. Cross-system atomicity claims need a real coordination mechanism, not optimistic sequencing.
- Make cache misses, Redis unavailability, malformed entries, and version mismatch safe for the origin service. A performance dependency should not silently become a correctness dependency.
- Bound cache stampedes with an appropriate strategy such as jittered TTLs, request coalescing, stale-while-revalidate, or carefully designed leases when workload evidence shows the risk.
- Avoid caching authorization decisions, mutable security state, or sensitive responses beyond their safe invalidation and retention window.
- Observe hit rate, miss latency, origin load, stale serves, evictions, and regeneration failures. A high hit rate alone does not prove the cache improves the system.

## Atomicity and concurrency

- Prefer one atomic Redis command when it expresses the invariant. Avoid a client-side read-compute-write sequence for counters, conditional creation, TTL changes, or collection updates when concurrent clients can intervene.
- Pipelining reduces round trips but is not an atomicity boundary. Inspect every response in order and bound each pipeline so queued requests and replies do not create excessive client or server memory use.
- Redis transactions serialize the commands executed by `EXEC`, but do not provide relational rollback for runtime command errors. Validate types and commands and inspect every result rather than treating `EXEC` as all-success.
- Use `WATCH` as optimistic concurrency: handle an aborted `EXEC`, bound retries, and add backoff under contention. Writes and eviction can invalidate watched keys; expiration also invalidates them starting with Redis 6.0.9, so verify expiry behavior against the declared server version.
- Keep Lua scripts and Redis Functions deterministic, bounded, and fast. They run atomically with respect to other commands and can block the server; do not put unbounded scans, large loops, or untrusted generated source in them.
- Pass key names and values through the script API rather than interpolating source. Declare every key the script accesses as required by the API and cluster routing model.
- In Redis Cluster, all keys in a multi-key command, transaction, or script must satisfy the topology's slot rules. Use hash tags only for an intentional co-location boundary and consider the resulting hot-slot and resharding cost.
- Make retryable writes and message handlers idempotent. Network failure can make command outcome ambiguous even when the server executes each command atomically.
- For locks, define the required safety and liveness guarantees. Use unique owner tokens, bounded leases, and compare-and-delete release; add fencing tokens or a stronger coordinator when a stale holder could still mutate an external resource.
- Do not assume asynchronous replication or automatic failover preserves every acknowledged lock or write. A distributed lock is not a substitute for a database constraint or idempotent protected operation.

## Messaging, streams, and queues

- Redis Pub/Sub has at-most-once delivery semantics. Subscribers must tolerate loss and reconnect gaps, or the design must use a durable mechanism.
- For Streams consumer groups, define message identity, acknowledgment point, pending-entry ownership, retry, reclaim, duplicate handling, poison-message policy, trimming, and consumer cleanup.
- Acknowledge only after the durable side effect required by the contract, while making replay safe. Exactly-once business effects require idempotency or an atomic boundary outside the delivery claim.
- Bound list, sorted-set, and stream growth. Retention and trimming policies must account for slow or offline consumers rather than deleting required work silently.
- Use blocking operations on dedicated or client-supported connections, with cancellation and shutdown behavior. Do not let a blocking read starve unrelated commands in a constrained pool.
- Treat queue visibility, delayed delivery, priority, and ordering as explicit contracts. Confirm that the chosen data type and cluster layout actually preserve them.

## Command and memory performance

- Review command complexity against real key cardinality and value size. A command described as fast for one element can still perform unbounded work on a large collection or response.
- Do not use `KEYS` on a production request or maintenance path over a nontrivial keyspace. Use cursor-based `SCAN` when iteration is necessary, tolerate duplicates and concurrent changes, and make the work resumable and idempotent.
- Avoid unbounded `SMEMBERS`, `HGETALL`, list ranges, sorted-set ranges, set algebra, deletion, and script loops. Use bounded ranges, incremental scan, unlinking, or a revised data model as the workload requires.
- Prevent hot keys and hot slots from concentrating CPU, network, or memory. Splitting a key is an architectural change and needs atomicity and read-cost analysis, not only a benchmark.
- Use bounded pipelines for independent commands and server-side atomic logic for dependent read-modify-write work. Do not confuse fewer round trips with less server work.
- Account for serialization, compression, allocation, response size, and network transfer in addition to command latency. Compression is useful only when its CPU and failure costs fit the workload.
- Avoid frequent connect/disconnect cycles. Reuse the client's intended connection or pool model and separate blocking, pub/sub, and ordinary command connections when the library requires it.
- Support performance findings with latency distributions, `SLOWLOG`, command statistics, memory usage, key cardinality, hot-key evidence, or a clear complexity bound.

## Durability, failure, and code-visible operations

- Align application guarantees with the configured persistence, replication, failover, and eviction policy. RDB, AOF, no persistence, and combined modes have different loss and recovery windows.
- Treat replication as asynchronous unless the selected product and operation prove a stronger guarantee. Commands such as `WAIT` can improve acknowledgment evidence but do not automatically create a fully durable or linearizable system.
- Handle `maxmemory` behavior explicitly. With eviction, any eligible key can disappear according to policy; with `noeviction`, writes can fail while reads continue.
- Configure bounded connect, command, and retry timeouts. Use exponential backoff with jitter for reconnects and cap offline queues so an outage cannot create an unbounded memory burst or stale replay storm.
- Define startup, readiness, degraded mode, and recovery behavior. A cache may fail open to the origin; authoritative state or coordination may need to fail closed.
- Make connection ownership explicit and close clients, subscriptions, and blocking operations during shutdown. Re-subscribe or resume durable work only according to its delivery contract.
- Preserve error distinctions such as timeout, authentication, redirection, read-only replica, out-of-memory, type error, script failure, and unavailable topology without leaking keys or values.
- Observe latency, errors, reconnects, memory, fragmentation, evictions, expirations, hit rate, replication lag, persistence health, blocked clients, pending stream entries, hot keys, and big keys as applicable.

## Security and privacy

- Keep Redis on trusted private networks and never expose it directly to untrusted clients. Protected mode is defense in depth, not the access-control design.
- Use TLS and named ACL users with least-privilege command categories, explicit key patterns, and channel patterns. Separate application, worker, migration, monitoring, and administrative identities.
- Restrict administrative, scripting, module, configuration, persistence, replication, and destructive keyspace commands to identities that require them.
- Keep credentials, connection URLs, certificates, and encryption keys out of source, logs, examples, fixtures, process arguments, and client-visible errors.
- Use a normal client library's binary-safe command arguments. Still whitelist application-selected key namespaces, command choices, script identifiers, and query expressions rather than exposing a Redis command surface to users.
- Never construct Lua or Function source from untrusted strings. Script arguments prevent source injection only when the source itself is application-owned.
- Minimize sensitive values and retention. Review persistence files, replicas, backups, diagnostics, slow logs, MONITOR output, and caches as disclosure paths.
- Do not put secrets in key names; keys commonly appear in metrics, traces, diagnostics, ACL patterns, and operational tools.

## Migrations and compatibility

- Treat key names, hash tags, data types, serialization, TTL policy, script behavior, and stream field shapes as stored compatibility contracts.
- Prefer versioned keys or values and a staged rollout: deploy tolerant readers, introduce new writes or carefully bounded dual writes, backfill, verify, stop old writes, then expire or delete old data.
- Make scans and backfills resumable, bounded, idempotent, and safe under concurrent mutation. `SCAN` can return duplicates and does not provide a frozen snapshot.
- Preserve or deliberately replace TTLs during copy and transformation. An otherwise correct migration can turn ephemeral data into permanent memory use or expire it prematurely.
- Check command, protocol, client, module, scripting, ACL, and topology support against declared versions. Test redirection and multi-key behavior on Cluster when Cluster is claimed.
- Treat `EVALSHA` scripts as volatile cache entries: keep application-owned source available and handle cache loss or `NOSCRIPT` through a supported load-and-retry flow without replaying unsafe effects.
- Treat Redis Functions, available in Redis 7 and later, as versioned database artifacts. Deploy or replace complete libraries and verify their persistence, replication, backup, restore, and failover lifecycle rather than applying script-cache semantics.
- Evaluate resharding before changing hash tags or multi-key boundaries. A key rename that changes slots can remove the atomicity assumptions of transactions and scripts.
- Define rollback and cleanup for both schemas. Avoid mass synchronous deletion; assess server blocking, replication, persistence rewrite, and memory effects.

## Tests and validation

- Run integration tests against real Redis with the claimed version, modules, protocol, and topology. A mock cannot prove TTL, transaction, script, stream, failover, cluster-slot, eviction, or persistence behavior.
- Test serialization compatibility, missing and wrong-type keys, TTL creation and refresh, concurrent writers, ambiguous retries, transaction result inspection, and Lua or Function errors.
- Test cache-origin failure combinations, stampede control, stale-data bounds, negative caching, and regeneration behavior where applicable.
- Test stream retries, duplicate delivery, reclaim, poison messages, trimming, and subscriber reconnect according to the messaging contract.
- Exercise Cluster redirects, cross-slot rejection, Sentinel or managed failover, restart, and durability loss windows only when those topologies and guarantees are claimed.
- Use unique per-test namespaces or isolated instances. Never run `FLUSHALL` or broad deletion against a shared environment, and avoid tests that depend on wall-clock sleeps when bounded polling or controllable clocks can prove the contract.
- Test migrations from representative old values, interrupted scans, concurrent writes, duplicate scan entries, TTL preservation, mixed application versions, and cleanup.
- Run the exact focused tests, script validation, migration checks, topology smoke tests, and performance probes named in `PROJECT_PROFILE.md`; report Redis version, topology, configuration assumptions, commands, and outcomes exactly.

## Primary references

- [Redis data types](https://redis.io/docs/latest/develop/data-types/)
- [Redis command use](https://redis.io/docs/latest/develop/using-commands/)
- [Redis pipelining](https://redis.io/docs/latest/develop/using-commands/pipelining/)
- [Redis transactions](https://redis.io/docs/latest/develop/using-commands/transactions/)
- [Redis Lua API](https://redis.io/docs/latest/develop/interact/programmability/lua-api/)
- [Redis Functions](https://redis.io/docs/latest/develop/programmability/functions-intro/)
- [Redis Pub/Sub](https://redis.io/docs/latest/develop/pubsub/)
- [Redis Streams](https://redis.io/docs/latest/develop/data-types/streams/)
- [Redis distributed locks](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/)
- [Redis SCAN](https://redis.io/docs/latest/commands/scan/)
- [Redis key eviction](https://redis.io/docs/latest/develop/reference/eviction/)
- [Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
- [Redis Cluster specification](https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/)
- [Redis security](https://redis.io/docs/latest/operate/oss_and_stack/management/security/)
- [Redis ACL](https://redis.io/docs/latest/operate/oss_and_stack/management/security/acl/)
