/**
 * Installs namespace interception on node-redis MULTI and pipeline queues.
 * This module owns the private v6 queue-shape integration so namespace.js can
 * focus on namespace context and command metadata.
 *
 * @param {object} options - Interception dependencies.
 * @param {object} options.client - node-redis client to patch.
 * @param {boolean} options.requiresPrivateQueueInterception - Whether the detected
 *   client shape requires both private queue executors.
 * @param {function(): object} options.captureInvocationContext - Captures the active
 *   raw/scoped namespace context.
 * @param {function(object, function(): *): *} options.runWithInvocationContext - Runs
 *   a callback in a captured namespace context.
 * @param {function(object): {prefix: string, prefixBuffer: Buffer|null}} options.activePrefixForInvocationContext
 *   Resolves the active prefix for a captured context.
 * @param {function(): boolean} options.areCommandSpecsLoaded - Returns command-spec state.
 * @param {function(): Promise<void>} options.loadCommandSpecs - Loads server command metadata.
 * @param {function(Array<*>, string, (Buffer|null)): Array<*>} options.namespacedArgs -
 *   Rewrites one Redis command argument array.
 * @param {WeakSet<Array<*>>} options.namespaceProcessedCommands - Tracks arrays
 *   already transformed by a private executor.
 * @param {function(function(): *): *} options.withoutNamespace - Runs raw operations.
 * @param {function(string): Error} options.namespaceCompatibilityError - Creates a
 *   fail-closed client compatibility error.
 */
export function attachMultiInterception({
    client,
    requiresPrivateQueueInterception,
    captureInvocationContext,
    runWithInvocationContext,
    activePrefixForInvocationContext,
    areCommandSpecsLoaded,
    loadCommandSpecs,
    namespacedArgs,
    namespaceProcessedCommands,
    withoutNamespace,
    namespaceCompatibilityError,
}) {
    const rawExecuteMulti =
        typeof client._executeMulti === "function" ? client._executeMulti.bind(client) : null;
    const rawExecutePipeline =
        typeof client._executePipeline === "function" ? client._executePipeline.bind(client) : null;
    const originalMULTI = typeof client.MULTI === "function" ? client.MULTI.bind(client) : null;
    const originalMulti = typeof client.multi === "function" ? client.multi.bind(client) : null;

    if (requiresPrivateQueueInterception && (!rawExecuteMulti || !rawExecutePipeline)) {
        throw namespaceCompatibilityError(
            "node-redis v6 MULTI/pipeline executors _executeMulti and _executePipeline are required.",
        );
    }
    if (Boolean(rawExecuteMulti) !== Boolean(rawExecutePipeline)) {
        throw namespaceCompatibilityError(
            "node-redis must expose both _executeMulti and _executePipeline, or neither.",
        );
    }

    const wrappedMultiClients = new WeakSet();

    function rewriteMultiCommandArguments(parameters, activePrefix, activePrefixBuffer) {
        if (!activePrefix || !Array.isArray(parameters) || parameters.length === 0) {
            return parameters;
        }

        const commandArgsIndex = parameters.findIndex((value) => Array.isArray(value));
        if (commandArgsIndex === -1) {
            return parameters;
        }

        const rewrittenCommandArgs = namespacedArgs(
            parameters[commandArgsIndex],
            activePrefix,
            activePrefixBuffer,
        );
        if (rewrittenCommandArgs === parameters[commandArgsIndex]) {
            return parameters;
        }

        namespaceProcessedCommands.add(rewrittenCommandArgs);

        const rewrittenParameters = [...parameters];
        rewrittenParameters[commandArgsIndex] = rewrittenCommandArgs;
        return rewrittenParameters;
    }

    function copyRewrittenCommandArgs(commandArgs, rewrittenCommandArgs) {
        if (rewrittenCommandArgs === commandArgs) {
            return;
        }

        commandArgs.length = rewrittenCommandArgs.length;
        for (let index = 0; index < rewrittenCommandArgs.length; index += 1) {
            commandArgs[index] = rewrittenCommandArgs[index];
        }
        for (const key of Object.keys(rewrittenCommandArgs)) {
            commandArgs[key] = rewrittenCommandArgs[key];
        }
    }

    function createPendingMultiCommandHooks(rawAddCommand, multiClient, invocationContext) {
        const pendingRewrites = [];
        let flushPendingRewritesPromise = null;

        function addCommand(...parameters) {
            return runWithInvocationContext(invocationContext, () => {
                const { prefix: activePrefix, prefixBuffer: activePrefixBuffer } =
                    activePrefixForInvocationContext(invocationContext);
                const commandArgsIndex = parameters.findIndex((value) => Array.isArray(value));

                if (!activePrefix || commandArgsIndex === -1) {
                    rawAddCommand(...parameters);
                    return multiClient;
                }

                if (!client.isOpen || areCommandSpecsLoaded()) {
                    const rewrittenParameters = rewriteMultiCommandArguments(
                        parameters,
                        activePrefix,
                        activePrefixBuffer,
                    );
                    rawAddCommand(...rewrittenParameters);
                    return multiClient;
                }

                // Queue a defensive copy so the deferred rewrite mutates only the
                // queued arguments, never the caller's array.
                const commandArgs = parameters[commandArgsIndex];
                const queuedCommandArgs = Object.assign([...commandArgs], commandArgs);
                const queuedParameters = [...parameters];
                queuedParameters[commandArgsIndex] = queuedCommandArgs;
                pendingRewrites.push({
                    args: queuedCommandArgs,
                    prefix: activePrefix,
                    prefixBuffer: activePrefixBuffer,
                });
                rawAddCommand(...queuedParameters);
                return multiClient;
            });
        }

        async function flushPendingRewrites() {
            if (flushPendingRewritesPromise) {
                return flushPendingRewritesPromise;
            }
            if (pendingRewrites.length === 0) {
                return undefined;
            }

            flushPendingRewritesPromise = (async () => {
                const rewrites = pendingRewrites.slice();
                if (client.isOpen && !areCommandSpecsLoaded()) {
                    await loadCommandSpecs();
                }

                for (const { args, prefix, prefixBuffer } of rewrites) {
                    const rewrittenArgs = namespacedArgs(args, prefix, prefixBuffer);
                    copyRewrittenCommandArgs(args, rewrittenArgs);
                    namespaceProcessedCommands.add(args);
                }
                pendingRewrites.splice(0, rewrites.length);
            })();

            try {
                return await flushPendingRewritesPromise;
            } finally {
                flushPendingRewritesPromise = null;
            }
        }

        return { addCommand, flushPendingRewrites };
    }

    async function rewritePrivateCommandQueue(commands, invocationContext) {
        if (!Array.isArray(commands)) {
            throw namespaceCompatibilityError(
                "node-redis MULTI/pipeline command queue is not an array.",
            );
        }

        const { prefix: activePrefix, prefixBuffer: activePrefixBuffer } =
            activePrefixForInvocationContext(invocationContext);
        if (!activePrefix) {
            return;
        }

        if (client.isOpen && !areCommandSpecsLoaded()) {
            await loadCommandSpecs();
        }

        for (const command of commands) {
            if (
                !command ||
                typeof command !== "object" ||
                !Array.isArray(command.args) ||
                command.args.length === 0
            ) {
                throw namespaceCompatibilityError(
                    "node-redis MULTI/pipeline command queue entry has an unsupported shape.",
                );
            }

            if (namespaceProcessedCommands.has(command.args)) {
                continue;
            }

            command.args = namespacedArgs(command.args, activePrefix, activePrefixBuffer);
            namespaceProcessedCommands.add(command.args);
        }
    }

    function createPrivateQueueExecutor(rawExecutor) {
        return async (commands, ...executorArgs) => {
            const invocationContext = captureInvocationContext();
            if (!invocationContext.bypass) {
                await rewritePrivateCommandQueue(commands, invocationContext);
            }
            return rawExecutor(commands, ...executorArgs);
        };
    }

    const usesPrivateQueueInterception = Boolean(rawExecuteMulti || rawExecutePipeline);
    if (rawExecuteMulti) {
        client._executeMulti = createPrivateQueueExecutor(rawExecuteMulti);
    }
    if (rawExecutePipeline) {
        client._executePipeline = createPrivateQueueExecutor(rawExecutePipeline);
    }

    function wrapMultiClient(multiClient, invocationContext) {
        if (!multiClient || typeof multiClient !== "object") {
            return multiClient;
        }
        if (wrappedMultiClients.has(multiClient)) {
            return multiClient;
        }

        if (typeof multiClient.addCommand !== "function") {
            return multiClient;
        }
        wrappedMultiClients.add(multiClient);

        const rawAddCommand = multiClient.addCommand.bind(multiClient);
        const { addCommand, flushPendingRewrites } = createPendingMultiCommandHooks(
            rawAddCommand,
            multiClient,
            invocationContext,
        );
        multiClient.addCommand = addCommand;

        if (typeof multiClient.sendCommand === "function") {
            multiClient.sendCommand = (args, ...rest) =>
                multiClient.addCommand(Array.isArray(args) ? args.slice() : args, ...rest);
        }

        for (const methodName of [
            "exec",
            "EXEC",
            "execTyped",
            "execAsPipeline",
            "execAsPipelineTyped",
        ]) {
            if (typeof multiClient[methodName] !== "function") {
                continue;
            }

            const rawMethod = multiClient[methodName].bind(multiClient);
            multiClient[methodName] = async (...methodArgs) =>
                runWithInvocationContext(invocationContext, async () => {
                    await flushPendingRewrites();
                    return usesPrivateQueueInterception
                        ? rawMethod(...methodArgs)
                        : withoutNamespace(() => rawMethod(...methodArgs));
                });
        }

        return multiClient;
    }

    function createNamespacedMultiFactory(rawFactory) {
        return (...factoryArgs) => {
            const invocationContext = captureInvocationContext();
            const multiClient = runWithInvocationContext(invocationContext, () =>
                rawFactory(...factoryArgs),
            );
            return wrapMultiClient(multiClient, invocationContext);
        };
    }

    if (originalMULTI) {
        client.MULTI = createNamespacedMultiFactory(originalMULTI);
    }
    if (originalMulti) {
        client.multi = createNamespacedMultiFactory(originalMulti);
    }
}
