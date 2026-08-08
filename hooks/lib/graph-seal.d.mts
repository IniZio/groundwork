// Type declarations for graph-seal.mjs
// Tamper-evident HMAC seal over the folded motive graph (MOTIVE-DAG-R-005).

/**
 * Reduce a folded graph to a deterministic, order-insensitive JSON string.
 * Covers schema_version, motive, nodes (sorted by id, attrs deep-sorted),
 * and edges (sorted by kind+from+to). Same logical graph always produces
 * the same byte string regardless of insertion order.
 */
export declare function canonicalGraphState(graph: object): string

/**
 * Compute HMAC-SHA256 over stateString using key.
 * @param stateString - output of canonicalGraphState
 * @param key - raw 32-byte Buffer or hex-encoded string
 * @returns HMAC hex digest (64 chars)
 */
export declare function computeSeal(stateString: string, key: Buffer | string): string

/**
 * Verify the stored seal on a graph object against the provided key.
 * Seal is read from graph.seal (hex string). Uses timing-safe comparison.
 * Returns false if seal is absent, wrong length, or does not match.
 */
export declare function verifySeal(graph: object, key: Buffer | string): boolean

/**
 * Resolve the seal-key sidecar path for a motive.
 *   .groundwork/motives/<slug>/graph.seal.key
 */
export declare function keyPath(opts?: { projectDir: string; slug: string }): string

/**
 * Mint and persist a fresh random 32-byte key (mode 0o600) if not already present.
 * Idempotent — returns existing key if the file exists.
 */
export declare function ensureKey(opts: { projectDir: string; slug: string }): Buffer

/**
 * Read the seal key from disk (synchronous raw fs read).
 */
export declare function readKey(opts: { projectDir: string; slug: string }): Buffer
