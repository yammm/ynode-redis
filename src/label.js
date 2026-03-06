export function connectionLabel(info, options) {
    const id = info?.id ?? "unknown";
    const rawAddress = info?.addr ?? options?.url ?? "unknown";
    const address =
        typeof rawAddress === "string" && rawAddress.includes("://")
            ? rawAddress
            : `redis://${rawAddress}`;

    return `[${id}] ${address}`;
}
