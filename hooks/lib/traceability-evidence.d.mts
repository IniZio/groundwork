// Type declarations for traceability-evidence.mjs
// Slice S4 — ARTIFACT-EVIDENCE mechanism (AC-6, D-4).

/**
 * A typed evidence reference: a record linking an artifact file to the
 * slice/AC ids it evidences, stamped with the build/data hash it was
 * captured against.
 */
export interface EvidenceRef {
  /** Unique identifier for this evidence record. */
  id: string
  /**
   * Artifact category.
   * Common values: 'screenshot', 'test-output', 'gate-record'.
   * Open-ended string for extensibility.
   */
  kind: string
  /** Path to the artifact file (absolute or repo-relative). */
  path: string
  /** Slice id(s) and/or AC id(s) that this evidence supports. */
  evidences: string[]
  /**
   * sha-256 hex digest of the build/data content at capture time.
   * null when the evidence was recorded without hash-stamping.
   */
  captured_build_hash: string | null
  /** ISO 8601 timestamp of when the evidence was captured. */
  captured_at: string
}

/**
 * An EvidenceRef extended with a freshness tag produced by markStaleness().
 * 'fresh'  — captured_build_hash matches the current build hash.
 * 'stale'  — hash mismatch or null (evidence predates or misses a regen).
 */
export interface StampedEvidenceRef extends EvidenceRef {
  freshness: 'fresh' | 'stale'
}

/** Options accepted by recordEvidence() and readEvidence(). */
export interface EvidenceStoreOpts {
  /**
   * Absolute path to the .groundwork directory.
   * Defaults to `<CLAUDE_PROJECT_DIR || cwd()>/.groundwork`.
   */
  groundworkDir?: string
}

/**
 * Compute a deterministic sha-256 hex digest of build/data content.
 *
 * Pass the raw bytes of a file artifact (Buffer) or a JSON-stringified /
 * serialised data snapshot (string).  The same input always yields the same
 * 64-character lowercase hex string.
 */
export declare function computeBuildHash(input: string | Buffer): string

/**
 * Construct an EvidenceRef object.
 *
 * If `id` is omitted it is derived deterministically from kind + path +
 * captured_at (first 16 hex chars of their sha-256 digest).
 * `captured_at` defaults to the current UTC timestamp.
 */
export declare function makeEvidenceRef(opts: {
  id?: string
  kind: string
  path: string
  evidences: string[]
  captured_build_hash?: string | null
  captured_at?: string
}): EvidenceRef

/**
 * Persist an evidence ref to the motive spine's evidence store.
 *
 * Written to: `<groundworkDir>/motives/<slug>/evidence/<id>.json`
 * Additive — never deletes existing refs.  Idempotent for the same id.
 *
 * @returns Absolute path of the written JSON file.
 */
export declare function recordEvidence(
  slug: string,
  ref: EvidenceRef,
  opts?: EvidenceStoreOpts,
): string

/**
 * Read all evidence refs for a motive.
 *
 * Returns an empty array when the evidence directory does not yet exist.
 * Corrupt JSON files are silently skipped.
 */
export declare function readEvidence(
  slug: string,
  opts?: EvidenceStoreOpts,
): EvidenceRef[]

/**
 * Tag each evidence ref fresh or stale.
 *
 * AC-6 behaviour: a ref is 'stale' when its captured_build_hash differs from
 * currentBuildHash (meaning the underlying data/artifact has been regenerated
 * since the evidence was captured).  A null hash is always 'stale'.
 */
export declare function markStaleness(
  refs: EvidenceRef[],
  currentBuildHash: string,
): StampedEvidenceRef[]
