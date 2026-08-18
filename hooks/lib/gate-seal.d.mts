// Type declarations for gate-seal.mjs

/** Schema version marking the sealed regime. Ledgers at this version carry a gate.seal field. */
export declare const SCHEMA_VERSION: number

/**
 * Reduce a ledger to its release-affecting state as a deterministic JSON string.
 * Included: schema_version, session_id, active, advisor_verdict, slices[{id,status,created_by}] sorted by id.
 * When scoped_tokens is present in the ledger, it is also included as sorted [{scope,token}] pairs
 * (sorted by scope then token). Absent scoped_tokens is excluded to preserve backward compatibility
 * with ledgers sealed before this field was introduced.
 */
export declare function canonicalReleaseState(ledger: object): string

/**
 * Compute HMAC-SHA256 over stateString using key.
 * @param stateString - output of canonicalReleaseState
 * @param key - raw 32-byte Buffer or hex-encoded string
 * @returns HMAC hex digest
 */
export declare function computeSeal(stateString: string, key: Buffer | string): string

/**
 * Verify the stored seal in a ledger against the provided key.
 * Uses timing-safe comparison. Returns false if seal is absent or does not match.
 */
export declare function verifySeal(ledger: object, key: Buffer | string): boolean

/**
 * Resolve the seal-key sidecar path (.groundwork/runs/<sessionId>.seal.key).
 * Mirrors the resolveLedgerPath validation in hooks/lib/ledger-io.mjs.
 */
export declare function keyPath(opts?: { projectDir: string; sessionId?: string }): string

/**
 * Mint and persist a fresh random 32-byte key (mode 0o600) if not already present.
 * Idempotent — returns existing key if file exists.
 */
export declare function ensureKey(opts: { projectDir: string; sessionId?: string }): Buffer

/**
 * Read the seal key from disk (synchronous raw fs read).
 */
export declare function readKey(opts: { projectDir: string; sessionId?: string }): Buffer
