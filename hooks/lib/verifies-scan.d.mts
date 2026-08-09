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
