// check-comments-exempt — hook lib; traceability invariants documented inline
/**
 * traceability-evidence.mjs
 *
 * ARTIFACT-EVIDENCE mechanism — typed evidence references, build/data-hash
 * stamping, and staleness detection.
 *
 * Slice S4 of motive tracking-viz (AC-6, D-4).
 *
 * Design:
 *  - No imports from traceability-join.mjs or traceability-adapter.mjs.
 *    Wiring evidence into the assembled graph happens in S3 (traceability-join).
 *  - No imports from traceability-model.mjs (model is additive; this module
 *    is additive on top of it). Both are standalone — callers compose them.
 *  - I/O is confined to the motive spine:
 *      <groundworkDir>/motives/<slug>/evidence/
 *  - computeBuildHash is pure (no I/O) so callers control what goes in.
 */

import { createHash } from 'node:crypto'
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

// ---------------------------------------------------------------------------
// Build-hash derivation
// ---------------------------------------------------------------------------

/**
 * Compute a stable, deterministic sha-256 hex digest of build/data content.
 *
 * HOW THE HASH IS DERIVED
 * -----------------------
 * The caller passes the bytes or text that represent the state of the
 * build artifact or data snapshot at the time the evidence was captured:
 *
 *  - For a file-based artifact (screenshot, CSV export, HTML report): pass
 *    the raw file bytes (`fs.readFileSync(path)` — returns a Buffer).
 *  - For an in-memory data snapshot (test output string, gate-record JSON):
 *    pass the JSON-stringified or serialised string directly.
 *  - For a multi-file build: concatenate the canonical sorted file contents
 *    (or use a manifest digest) and pass the result.
 *
 * The digest is sha-256 over the UTF-8 / binary encoding of `input`, returned
 * as a lowercase hex string.  The same input always yields the same hash
 * (deterministic), and any byte-level change to the artifact produces a
 * different hash — which is what markStaleness uses to detect regen.
 *
 * @param {string | Buffer} input - Build artifact content or data snapshot.
 * @returns {string} 64-character lowercase hex sha-256 digest.
 */
export function computeBuildHash(input) {
  return createHash('sha256').update(input).digest('hex')
}

// ---------------------------------------------------------------------------
// Evidence-ref factory
// ---------------------------------------------------------------------------

/**
 * Build an EvidenceRef object.  The caller may supply an explicit id; if
 * omitted one is generated deterministically from kind + path + captured_at.
 *
 * @param {object}   opts
 * @param {string}   [opts.id]                  - Explicit id; auto-generated if absent.
 * @param {string}   opts.kind                  - 'screenshot' | 'test-output' | 'gate-record' | string
 * @param {string}   opts.path                  - Path to the artifact file (absolute or repo-relative).
 * @param {string[]} opts.evidences             - Slice/AC ids this evidence supports (e.g. ['S4', 'AC-6']).
 * @param {string|null} [opts.captured_build_hash] - Hash at capture time; null if not yet stamped.
 * @param {string}   [opts.captured_at]         - ISO timestamp; defaults to now.
 * @returns {EvidenceRef}
 */
export function makeEvidenceRef({
  id,
  kind,
  path: artifactPath,
  evidences,
  captured_build_hash = null,
  captured_at,
}) {
  const ts = captured_at ?? new Date().toISOString()
  const resolvedId =
    id ??
    computeBuildHash(`${kind}:${artifactPath}:${ts}`).slice(0, 16)
  return {
    id: resolvedId,
    kind,
    path: artifactPath,
    evidences: Array.isArray(evidences) ? evidences : [evidences],
    captured_build_hash,
    captured_at: ts,
  }
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the evidence directory for a motive slug.
 *
 * @param {string} slug            - Motive slug (e.g. 'tracking-viz').
 * @param {string} [groundworkDir] - Absolute path to the .groundwork directory.
 *   Defaults to `<CLAUDE_PROJECT_DIR || cwd()>/.groundwork`.
 * @returns {string} Absolute path to the evidence directory.
 */
function evidenceDir(slug, groundworkDir) {
  const base =
    groundworkDir ??
    path.join(process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), '.groundwork')
  return path.join(base, 'motives', slug, 'evidence')
}

/**
 * Write an evidence ref into the motive spine's evidence store.  Additive:
 * each call writes one JSON file named `<id>.json`.  Existing files with the
 * same id are overwritten (idempotent for the same evidence record).
 *
 * The evidence store lives at:
 *   <groundworkDir>/motives/<slug>/evidence/<id>.json
 *
 * @param {string}     slug            - Motive slug.
 * @param {EvidenceRef} ref            - Evidence reference to persist.
 * @param {object}     [opts]
 * @param {string}     [opts.groundworkDir] - Override .groundwork dir.
 * @returns {string} The path of the written file.
 */
export function recordEvidence(slug, ref, { groundworkDir } = {}) {
  const dir = evidenceDir(slug, groundworkDir)
  mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, `${ref.id}.json`)
  writeFileSync(filePath, JSON.stringify(ref, null, 2) + '\n', 'utf8')
  return filePath
}

/**
 * Read all evidence refs stored for a motive.  Returns an empty array if the
 * evidence directory does not exist yet.
 *
 * @param {string} slug            - Motive slug.
 * @param {object} [opts]
 * @param {string} [opts.groundworkDir] - Override .groundwork dir.
 * @returns {EvidenceRef[]}
 */
export function readEvidence(slug, { groundworkDir } = {}) {
  const dir = evidenceDir(slug, groundworkDir)
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    // Directory does not exist yet — no evidence recorded.
    return []
  }
  const refs = []
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    try {
      const raw = readFileSync(path.join(dir, entry), 'utf8')
      refs.push(JSON.parse(raw))
    } catch {
      // Corrupt entry — skip rather than crash.
    }
  }
  return refs
}

// ---------------------------------------------------------------------------
// Staleness tagging
// ---------------------------------------------------------------------------

/**
 * Tag each evidence ref as fresh or stale by comparing its
 * `captured_build_hash` against the current build/data hash.
 *
 * AC-6 behaviour: any evidence captured against a different build (i.e.
 * `captured_build_hash !== currentBuildHash`) is marked stale — the data or
 * artifact it was captured from has been regenerated, so the evidence no
 * longer reliably represents the current state.
 *
 * An evidence ref with `captured_build_hash === null` is always stale (it was
 * never hash-stamped).
 *
 * @param {EvidenceRef[]} refs            - Evidence refs to evaluate.
 * @param {string}        currentBuildHash - Hash of the current build/data.
 * @returns {StampedEvidenceRef[]} Each ref extended with `freshness`.
 */
export function markStaleness(refs, currentBuildHash) {
  return refs.map((ref) => ({
    ...ref,
    freshness:
      ref.captured_build_hash !== null &&
      ref.captured_build_hash === currentBuildHash
        ? /** @type {'fresh'} */ ('fresh')
        : /** @type {'stale'} */ ('stale'),
  }))
}

// ---------------------------------------------------------------------------
// JSDoc typedefs (for editor tooling without TypeScript)
// ---------------------------------------------------------------------------

/**
 * @typedef {object} EvidenceRef
 * @property {string}      id                  - Unique identifier for this evidence record.
 * @property {string}      kind                - Category: 'screenshot' | 'test-output' | 'gate-record' | string.
 * @property {string}      path                - Path to the artifact file.
 * @property {string[]}    evidences           - Slice/AC ids this evidence supports.
 * @property {string|null} captured_build_hash - Build/data hash at capture time; null if un-stamped.
 * @property {string}      captured_at         - ISO 8601 timestamp of when evidence was captured.
 */

/**
 * @typedef {EvidenceRef & { freshness: 'fresh' | 'stale' }} StampedEvidenceRef
 */
