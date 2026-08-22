import { closeClient } from "./connection.js";
import { attachHealth } from "./health.js";
import { clientInfo } from "./info.js";
import { connectionLabel } from "./label.js";
import { abortStartup, startupTimeoutMs, startupWithTimeout } from "./lifecycle.js";
import { attachNamespace, normalizeNamespace } from "./namespace.js";

/**
 * Validates and normalizes managed-client factory options.
 * @param {*} options - Candidate options.
 * @param {string} method - Public factory method name.
 * @returns {object} Original options or a fresh empty object.
 */
function managedOptions(options, method) {
    if (options === undefined) {
        return {};
    }
    if (!options || typeof options !== "object" || Array.isArray(options)) {
        throw new TypeError(`${method} options must be a plain object`);
    }
    let prototype;
    try {
        prototype = Object.getPrototypeOf(options);
    } catch {
        throw new TypeError(`${method} options must be a plain object`);
    }
    if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`${method} options must be a plain object`);
    }
    return options;
}

/**
 * Creates the stable error returned when a managed client cannot be created
 * because Fastify shutdown has started.
 * @param {string} role - Managed connection role.
 * @returns {Error} Error with code REDIS_MANAGED_CLIENT_CLOSING.
 */
function managedClientClosingError(role) {
    const error = new Error(`Cannot create managed Redis ${role} while Fastify is closing`);
    error.code = "REDIS_MANAGED_CLIENT_CLOSING";
    return error;
}

/**
 * Adds defensive event logging to a managed Redis connection.
 * @param {FastifyInstance} fastify - Fastify server instance.
 * @param {object} client - Managed Redis client.
 * @param {string} role - Human-readable connection role.
 * @param {object} options - node-redis connection overrides.
 * @returns {{ dispose: function(): void, markStartupComplete: function(): Promise<void>, label: function(): string }}
 */
function attachManagedLogging(fastify, client, role, options) {
    let info;
    let startupComplete = false;
    const infoClient = client.raw ?? client;

    const label = () => connectionLabel(info, options);

    async function refreshInfo() {
        try {
            info = await clientInfo(infoClient);
        } catch (error) {
            fastify.log.trace(
                { err: error },
                `Managed Redis ${role} CLIENT INFO error has occurred`,
            );
        }
    }

    const handlers = {
        connect: () => fastify.log.debug(`Initiating a managed Redis ${role} connection`),
        ready: async () => {
            if (!startupComplete) {
                return;
            }
            await refreshInfo();
            fastify.log.info(`Managed Redis ${role} is ready to use ${label()}`);
        },
        end: () => fastify.log.info(`Managed Redis ${role} connection has been closed ${label()}`),
        error: (error) =>
            fastify.log.error(
                { err: error },
                `Managed Redis ${role} error has occurred ${label()}`,
            ),
        reconnecting: () =>
            fastify.log.warn(`Managed Redis ${role} is trying to reconnect ${label()}`),
    };

    for (const [event, handler] of Object.entries(handlers)) {
        client.on(event, handler);
    }

    let disposed = false;
    return {
        dispose() {
            if (disposed) {
                return;
            }
            disposed = true;
            const removeListener =
                typeof client.off === "function"
                    ? client.off.bind(client)
                    : client.removeListener?.bind(client);
            if (!removeListener) {
                return;
            }
            for (const [event, handler] of Object.entries(handlers)) {
                removeListener(event, handler);
            }
        },
        label,
        async markStartupComplete() {
            await refreshInfo();
            startupComplete = true;
            fastify.log.info(`Managed Redis ${role} is ready to use ${label()}`);
        },
    };
}

/**
 * Attaches factories for independently connected Redis clients that are owned
 * by the Fastify lifecycle. Regular managed clients receive namespace and
 * health helpers; subscribers remain deliberately un-namespaced because Redis
 * pub/sub channels are global, but still receive health helpers.
 *
 * @param {FastifyInstance} fastify - Fastify server instance.
 * @param {object} client - Primary namespaced Redis client.
 * @param {object} [defaults] - Plugin defaults inherited by managed clients.
 * @param {object|Map} [defaults.namespaceCommands] - Default custom command metadata.
 * @param {number} [defaults.startupTimeout] - Default managed startup deadline.
 * @returns {{ closeAll: function(): Promise<void> }} Managed lifecycle controller.
 */
export function attachManagedClients(fastify, client, defaults = {}) {
    const records = new Set();
    const defaultStartupTimeout = startupTimeoutMs(defaults);
    let closing = false;
    let closeAllPromise;

    async function closeRecord(record, { force = false } = {}) {
        if (record.closePromise) {
            return record.closePromise;
        }

        record.closePromise = (async () => {
            try {
                if (!record.startupSettled) {
                    record.controller.abort();
                    await abortStartup(record.client);
                    await record.startupPromise.catch(() => {});
                } else if (force) {
                    await abortStartup(record.client);
                }

                if (record.client.isOpen) {
                    fastify.log.debug(
                        `Attempting to close managed Redis ${record.role} ${record.logging.label()}`,
                    );
                    try {
                        await closeClient(record.client);
                    } catch (error) {
                        fastify.log.warn(
                            { err: error },
                            `Error closing managed Redis ${record.role} ${record.logging.label()}`,
                        );
                    }
                }
            } finally {
                records.delete(record);
                record.logging.dispose();
            }
        })();

        return record.closePromise;
    }

    async function createManagedConnection(role, rawOptions, namespaced) {
        const method = namespaced ? "createManagedClient" : "createManagedSubscriber";
        const options = managedOptions(rawOptions, method);
        if (closing) {
            throw managedClientClosingError(role);
        }

        if (
            !namespaced &&
            (Object.hasOwn(options, "namespace") || Object.hasOwn(options, "namespaceCommands"))
        ) {
            throw new TypeError(
                "createManagedSubscriber options must not include namespace or namespaceCommands",
            );
        }

        const {
            namespace,
            namespaceCommands,
            startupTimeout: _startupTimeout,
            ...duplicateOptions
        } = options;
        const startupTimeout = Object.hasOwn(options, "startupTimeout")
            ? startupTimeoutMs(options)
            : defaultStartupTimeout;
        const duplicateSource = client.raw ?? client;
        const managedClient = duplicateSource.duplicate(duplicateOptions);

        if (namespaced) {
            const inheritedNamespace = Object.hasOwn(options, "namespace")
                ? normalizeNamespace(namespace)
                : normalizeNamespace(client.namespace);
            const inheritedNamespaceCommands = Object.hasOwn(options, "namespaceCommands")
                ? namespaceCommands
                : defaults.namespaceCommands;
            attachNamespace(managedClient, inheritedNamespace, {
                namespaceCommands: inheritedNamespaceCommands,
            });
        }
        attachHealth(managedClient);

        const logging = attachManagedLogging(fastify, managedClient, role, duplicateOptions);
        const controller = new AbortController();
        const record = {
            client: managedClient,
            closePromise: undefined,
            controller,
            logging,
            role,
            startupPromise: undefined,
            startupSettled: false,
        };
        records.add(record);

        record.startupPromise = (async () => {
            try {
                return await startupWithTimeout(
                    managedClient,
                    startupTimeout,
                    async () => {
                        await managedClient.connect();
                        await logging.markStartupComplete();
                        return managedClient;
                    },
                    {
                        signal: controller.signal,
                        abortError: () => managedClientClosingError(role),
                        // closeRecord awaits forceful teardown on timeout or shutdown.
                        abortOnSignal: false,
                        abortOnTimeout: false,
                    },
                );
            } finally {
                record.startupSettled = true;
            }
        })();

        let connected = false;
        try {
            const connectedClient = await record.startupPromise;
            connected = true;
            if (closing) {
                throw managedClientClosingError(role);
            }
            return connectedClient;
        } catch (error) {
            try {
                await closeRecord(record, { force: !connected });
            } catch (cleanupError) {
                try {
                    fastify.log.warn(
                        { err: cleanupError },
                        `Error cleaning up managed Redis ${role} after startup failure`,
                    );
                } catch {
                    // Preserve the original startup or shutdown error.
                }
            }
            throw error;
        }
    }

    Object.defineProperty(client, "createManagedClient", {
        configurable: true,
        enumerable: false,
        value: (options) => createManagedConnection("client", options, true),
    });

    Object.defineProperty(client, "createManagedSubscriber", {
        configurable: true,
        enumerable: false,
        value: (options) => createManagedConnection("subscriber", options, false),
    });

    return {
        closeAll() {
            if (!closeAllPromise) {
                closing = true;
                closeAllPromise = (async () => {
                    const results = await Promise.allSettled(
                        [...records].map((record) => closeRecord(record)),
                    );
                    for (const result of results) {
                        if (result.status !== "rejected") {
                            continue;
                        }
                        try {
                            fastify.log.warn(
                                { err: result.reason },
                                "Error cleaning up a managed Redis connection",
                            );
                        } catch {
                            // Logging must not make Fastify shutdown fail.
                        }
                    }
                })();
            }
            return closeAllPromise;
        },
    };
}
