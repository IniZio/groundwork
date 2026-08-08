/**
 * graph-seal.mjs — tamper-evident seal over a folded motive graph.
 *
 * Ports the gate-seal.mjs HMAC approach (commit 76b5a3f) onto the
 * graph-revision fold produced by motive-graph-fold.mjs.
 *
 * Provides:
 *   - canonicalGraphState(graph): deterministic, order-insensitive serialization.
 *   - computeSeal(stateString, key): HMAC-SHA256 hex over canonical state.
 *   - verifySeal(graph, key): timing-safe comparison against graph.seal.
 *   - keyPath({projectDir, slug}): resolves per-motive .graph.seal.key sidecar.
 *   - ensureKey({projectDir, slug}): mints + persists a fresh 32-byte key (mode 0600).
 *   - readKey({projectDir, slug}): raw fs read of the key Buffer.
 *
 * Dependency-free (node:crypto + node:fs + node:path only). ESM, no build step.
 * MUST NOT be imported by motive-graph-fold.mjs — fold purity contract (S1-AC3).
 *
 * Implements MOTIVE-DAG-R-005 (tamper-evident seal), D-5, D-10.
 */

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Safe slug guard — mirrors SAFE_ID in gate-seal.mjs / ledger-io.mjs. */
const SAFE_SLUG = /^[A-Za-z0-9_-]{1,128}$/

/**
 * Recursively produce a copy of an object/array with all object keys sorted.
 * Primitives and null are returned as-is.
 * @param {unknown} value
 * @returns {unknown}
 */
function sortedValue(value) {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(sortedValue)
  const sorted = /** @type {Record<string, unknown>} */ ({})
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortedValue(/** @type {Record<string, unknown>} */ (value)[key])
  }
  return sorted
}

// ---------------------------------------------------------------------------
// Canonical serialization
// ---------------------------------------------------------------------------

/**
 * Reduce a folded graph to a deterministic JSON string that covers all
 * tamper-detectable fields.
 *
 * Included (and only these):
 *   schema_version, motive,
 *   nodes: [{kind, id, attrs (deep sorted), retired}] sorted by id ascending,
 *   edges: [{kind, from, to, retired}] sorted by (kind, from, to) ascending.
 *
 * Top-level `attrs` (gates / sessions / milestones) is intentionally excluded
 * to keep the canonical surface minimal and stable across motive-graph-fold
 * schema evolution — the node/edge graph is the structural invariant.
 *
 * Key ordering is fixed; all arrays are sorted — the same logical graph always
 * produces the same byte string regardless of insertion order.
 *
 * @param {object} graph - folded graph: {schema_version, motive, nodes[], edges[], ...}
 * @returns {string} deterministic JSON string
 */
export function canonicalGraphState(graph) {
  const rawNodes = Array.isArray(graph.nodes) ? graph.nodes : []
  const rawEdges = Array.isArray(graph.edges) ? graph.edges : []

  const nodes = rawNodes
    .map(n => ({
      kind: String(n.kind ?? ''),
      id: String(n.id ?? ''),
      attrs: sortedValue(n.attrs != null && typeof n.attrs === 'object' ? n.attrs : {}),
      retired: Boolean(n.retired),
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const edges = rawEdges
    .map(e => ({
      kind: String(e.kind ?? ''),
      from: String(e.from ?? ''),
      to: String(e.to ?? ''),
      retired: Boolean(e.retired),
    }))
    .sort((a, b) => {
      const ka = `${a.kind}\0${a.from}\0${a.to}`
      const kb = `${b.kind}\0${b.from}\0${b.to}`
      return ka < kb ? -1 : ka > kb ? 1 : 0
    })

  const state = {
    schema_version: graph.schema_version ?? null,
    motive: graph.motive ?? null,
    nodes,
    edges,
  }
  return JSON.stringify(state)
}

// ---------------------------------------------------------------------------
// HMAC-SHA256 compute + verify
// ---------------------------------------------------------------------------

/**
 * Compute HMAC-SHA256 over stateString using key.
 *
 * @param {string} stateString - output of canonicalGraphState
 * @param {Buffer | string} key - raw 32-byte Buffer or hex-encoded string
 * @returns {string} HMAC hex digest
 */
export function computeSeal(stateString, key) {
  const keyBuf = Buffer.isBuffer(key) ? key : Buffer.from(key, 'hex')
  return createHmac('sha256', keyBuf).update(stateString, 'utf8').digest('hex')
}

/**
 * Verify the stored seal on a graph object against the provided key.
 * The seal is expected at graph.seal (hex string).
 *
 * Returns false if the seal field is absent, not a string, wrong length,
 * or does not match the HMAC recomputed from canonicalGraphState.
 * Uses timing-safe comparison to avoid timing side-channels.
 *
 * @param {object} graph - graph object bearing a .seal hex string
 * @param {Buffer | string} key - raw 32-byte Buffer or hex-encoded string
 * @returns {boolean}
 */
export function verifySeal(graph, key) {
  const storedSeal = /** @type {Record<string, unknown>} */ (graph)?.seal
  if (!storedSeal || typeof storedSeal !== 'string') return false
  try {
    const stateString = canonicalGraphState(graph)
    const expected = computeSeal(stateString, key)
    // Both are HMAC-SHA256 hex — 64 chars / 32 bytes.
    const storedBuf = Buffer.from(storedSeal, 'hex')
    const expectedBuf = Buffer.from(expected, 'hex')
    if (storedBuf.length !== expectedBuf.length) return false
    return timingSafeEqual(storedBuf, expectedBuf)
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Key management — per-motive sidecar (mirrors gate-seal.mjs pattern)
// ---------------------------------------------------------------------------

/**
 * Resolve the seal-key sidecar path for a given motive slug.
 *   .groundwork/motives/<slug>/graph.seal.key
 *
 * @param {{projectDir: string, slug: string}} opts
 * @returns {string} absolute path to the key file
 */
export function keyPath({ projectDir, slug } = {}) {
  if (slug && typeof slug === 'string' && SAFE_SLUG.test(slug)) {
    return path.join(projectDir, '.groundwork', 'motives', slug, 'graph.seal.key')
  }
  return path.join(projectDir, '.groundwork', 'motives', 'unknown', 'graph.seal.key')
}

/**
 * Mint and persist a fresh random 32-byte key (mode 0o600) if not already present.
 * Idempotent: returns existing key when the file already exists.
 *
 * @param {{projectDir: string, slug: string}} opts
 * @returns {Buffer} the key bytes
 */
export function ensureKey({ projectDir, slug }) {
  const kp = keyPath({ projectDir, slug })
  if (existsSync(kp)) {
    return readFileSync(kp)
  }
  mkdirSync(path.dirname(kp), { recursive: true })
  const key = randomBytes(32)
  writeFileSync(kp, key, { mode: 0o600 })
  return key
}

/**
 * Read the seal key from disk (synchronous raw fs read).
 *
 * @param {{projectDir: string, slug: string}} opts
 * @returns {Buffer} the raw key bytes
 */
export function readKey({ projectDir, slug }) {
  const kp = keyPath({ projectDir, slug })
  return readFileSync(kp)
}
