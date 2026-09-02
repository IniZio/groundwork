// Type declarations for verifies-scan.mjs

/**
 * Scan test files under `rootDir` for `@verifies <REQ-ID>` annotations.
 * Returns a mapping from requirement id to sorted array of test file paths
 * relative to rootDir.
 */
export declare function scanVerifies(rootDir: string): { [reqId: string]: string[] }

/**
 * Return the set of requirement IDs that have at least one `@verifies` annotation.
 */
export declare function verifiedIds(rootDir: string): Set<string>

/**
 * Normalizing lookup helper — lowercase reqId before indexing into a scanVerifies() map.
 * All consumers must call this instead of verifiesMap[reqId.toLowerCase()].
 */
export declare function lookupVerifies(verifiesMap: { [reqId: string]: string[] }, reqId: string): string[]
