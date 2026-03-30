/**
 * Builds a human-readable connection label from CLIENT INFO and plugin options.
 * Format: "[<id>] <address>" — used in log messages to identify the connection.
 * @param {object} [info] - Parsed CLIENT INFO result.
 * @param {object} [options] - Plugin options (fallback for address via options.url).
 * @returns {string} Formatted connection label.
 */
export function connectionLabel(info, options) {
    const id = info?.id ?? "unknown";
    const rawAddress = info?.addr ?? options?.url ?? "unknown";
    const address =
        typeof rawAddress === "string" && rawAddress.includes("://")
            ? rawAddress
            : `redis://${rawAddress}`;

    return `[${id}] ${address}`;
}
