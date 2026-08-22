/**
 * traceability-adapter.mjs — Read-only spine-adapter interface (D-7).
 *
 * Isolates the DATA STORE (ledger slices, journal events, doc/specs coverage,
 * charter objective) from the traceability graph assembler and render surfaces.
 * If a future store-swap (e.g. beads) is adopted, ONLY this adapter is
 * reimplemented; the traceability model, join engine, classification, and
 * render surfaces are unchanged.
 *
 * Slice → self-test linkage mechanism (S1 deliverable 3):
 *   A slice MAY carry an optional `test_paths` field — an array of
 *   repo-relative paths to its self-test files (e.g. ["test/hooks/foo.test.ts"]).
 *   The adapter emits these as "direct" self-test nodes.
 *
 *   When `test_paths` is absent, the adapter falls back to
 *   "decision-mediated" linkage: it cross-joins slice.decisions against
 *   spec-requirement origin_decision_ref values in coverage.json
 *   by_requirement, surfacing tests that cover requirements this slice
 *   implements. This path is coarse (one-to-many) and labeled accordingly.
 *
 *   The `test_paths` field is additive — the ledger slice schema already
 *   declares additionalProperties:true, so no schema migration is required.
 *
 * No I/O beyond what is delegated to NativeSpineAdapter. Pure interface +
 * default native implementation. Both are read-only.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { parseSpecRequirements } from './spec-io.mjs'
import { resolveMotiveSlug } from './motive-ref.mjs'

// ---------------------------------------------------------------------------
// SpineAdapter interface (JSDoc @typedef — no runtime representation)
// ---------------------------------------------------------------------------

/**
 * @typedef {object} SliceRecord
 * @property {string}   id          - Slice identifier (e.g. 'S1')
 * @property {string}   status      - 'pending' | 'in_progress' | 'complete' | 'skipped'
 * @property {string[]} [blocked_by] - Ids of prerequisite slices
 * @property {string[]} [covers_ac]  - AC ids this slice covers
 * @property {string[]} [decisions]  - Decision ids constraining this slice
 * @property {string[]} [test_paths] - OPTIONAL: repo-relative paths to self-test files (direct linkage mechanism)
 * @property {number|null} wave      - Wave number (integer) or null when absent/unset
 * @property {string}   [ticket]     - Linked ticket id
 * @property {string}   [desc]       - Human-readable description
 */

/**
 * @typedef {object} VerificationEvent
 * @property {string|null} claim    - Human-readable claim being verified
 * @property {string|null} evidence - Evidence citation
 * @property {string|null} result   - 'pass' | 'fail' | null
 * @property {number}      ord      - Ordinal position in the event stream
 * @property {string|null} [linkId] - OPTIONAL per-link scope (D-8 additive field)
 */

/**
 * @typedef {object} GateEvent
 * @property {string}      which    - Gate kind (e.g. 'advisor', 'qa')
 * @property {string}      verdict  - 'APPROVE' | 'CORRECTION' | 'REPLAN' | 'STOP'
 * @property {string|null} [citation]
 * @property {string|null} [rubric]
 * @property {string|null} [linkId] - OPTIONAL per-link scope (D-8 additive field)
 */

/**
 * @typedef {object} SpecReqRecord
 * @property {string}      id                   - Requirement id (e.g. 'TRACEABILITY-R-001')
 * @property {string}      title                - Human title
 * @property {string|null} verification         - 'automated' | 'manual' | null
 * @property {string|null} criticality          - 'must' | 'should' | null
 * @property {string|null} origin_decision_ref  - Decision ref (e.g. 'tracking-viz#D-7')
 */

/**
 * @typedef {Record<string, { declared: string|null, verified: boolean, tests: string[] }>} CoverageMap
 * Coverage map keyed by requirement id.
 */

/**
 * SpineAdapter — the read-only interface every consumer uses.
 *
 * Implement this interface to swap the backing store (native vs. beads, etc.).
 * All methods are synchronous for simplicity; the native implementation reads
 * from disk on each call (caching is the adapter's concern, not the caller's).
 *
 * @interface SpineAdapter
 */

/**
 * @typedef {object} SpineAdapter
 * @property {() => string}               getObjective         - Motive objective string
 * @property {() => string}               getMotive            - Motive slug
 * @property {() => SliceRecord[]}        getSlices            - All ledger slices
 * @property {() => VerificationEvent[]}  getVerificationEvents - VERIFICATION journal events
 * @property {() => GateEvent[]}          getGateEvents        - GATE journal events
 * @property {() => SpecReqRecord[]}      getSpecRequirements  - All spec-requirement nodes
 * @property {() => CoverageMap}          getCoverageMap       - coverage.json by_requirement map
 */

// ---------------------------------------------------------------------------
// NativeSpineAdapter — default implementation over the groundwork native store
// ---------------------------------------------------------------------------

/**
 * NativeSpineAdapter reads from the groundwork native data sources:
 *   - Active run ledger (.groundwork/runs/ or .groundwork/run.json)
 *   - Journal events (.groundwork/journal/)
 *   - doc/specs coverage.json
 *   - doc/specs/** /constraints.md (via spec-io parseSpecRequirements)
 *   - .groundwork/motives/<slug>/motive.md (for objective)
 *
 * @implements {SpineAdapter}
 */
export class NativeSpineAdapter {
  /**
   * @param {object} opts
   * @param {string} opts.projectDir - Absolute path to the project root
   * @param {string} opts.slug       - Motive slug
   */
  constructor({ projectDir, slug }) {
    this._projectDir = projectDir
    this._slug = slug
  }

  getObjective() {
    const motive = this._readMotive()
    return motive.objective ?? ''
  }

  getMotive() {
    return this._slug
  }

  getSlices() {
    const ledger = this._readLedger()
    if (!ledger) return []
    const slices = Array.isArray(ledger.slices) ? ledger.slices : []
    return slices.map((s) => ({
      id: s.id ?? '',
      status: s.status ?? 'pending',
      blocked_by: normStringArray(s.blocked_by),
      covers_ac: normStringArray(s.covers_ac),
      decisions: normStringArray(s.decisions),
      test_paths: normStringArray(s.test_paths),   // additive optional field
      wave: typeof s.wave === 'number' ? s.wave : null,
      ticket: typeof s.ticket === 'string' ? s.ticket : undefined,
      desc: typeof s.desc === 'string' ? s.desc : undefined,
    }))
  }

  getVerificationEvents() {
    const events = this._readJournalEvents()
    const out = []
    let ord = 0
    for (const ev of events) {
      if (ev.type !== 'VERIFICATION') continue
      const d = ev.data ?? {}
      out.push({
        claim:    typeof d.claim    === 'string' ? d.claim    : null,
        evidence: typeof d.evidence === 'string' ? d.evidence : null,
        result:   typeof d.result   === 'string' ? d.result   : null,
        ord:      ord++,
        linkId:   typeof d.link_id  === 'string' ? d.link_id  : null,
      })
    }
    return out
  }

  getGateEvents() {
    const events = this._readJournalEvents()
    const out = []
    for (const ev of events) {
      if (ev.type !== 'GATE') continue
      const d = ev.data ?? {}
      const which   = typeof d.which   === 'string' ? d.which   : (typeof d.gate === 'string' ? d.gate : 'unknown')
      const verdict = typeof d.verdict === 'string' ? d.verdict : 'unknown'
      out.push({
        which,
        verdict,
        citation: typeof d.citation === 'string' ? d.citation : null,
        rubric:   typeof d.rubric   === 'string' ? d.rubric   : null,
        linkId:   typeof d.link_id  === 'string' ? d.link_id  : null,
      })
    }
    return out
  }

  getSpecRequirements() {
    const reqs = parseSpecRequirements(this._projectDir)
    return reqs.map((r) => ({
      id:                  r.id ?? '',
      title:               r.title ?? '',
      verification:        r.verification ?? null,
      criticality:         r.criticality ?? null,
      origin_decision_ref: r.originDecisionRef ?? r.origin_decision_ref ?? null,
    }))
  }

  getCoverageMap() {
    const covPath = path.join(this._projectDir, 'doc', 'specs', '_generated', 'coverage.json')
    if (!existsSync(covPath)) return {}
    try {
      const raw = JSON.parse(readFileSync(covPath, 'utf8'))
      return raw.by_requirement ?? {}
    } catch {
      return {}
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** @returns {object|null} */
  _readLedger() {
    // Prefer the most-recently-modified run ledger matching this motive slug.
    const runsDir = path.join(this._projectDir, '.groundwork', 'runs')
    if (existsSync(runsDir)) {
      try {
        const files = readdirSync(runsDir)
          .filter((f) => f.endsWith('.json'))
          .map((f) => ({ f, mt: statSync(path.join(runsDir, f)).mtimeMs }))
          .sort((a, b) => b.mt - a.mt)
        for (const { f } of files) {
          try {
            const ledger = JSON.parse(readFileSync(path.join(runsDir, f), 'utf8'))
            // Canonical form is SLUG. resolveMotiveSlug normalises path-form values so
            // ledgers written with the old path form are not silently skipped.
            // Ledgers with no motive_ref are not filtered — they may be legacy runs.
            const _refSlug = ledger.motive_ref ? resolveMotiveSlug(ledger.motive_ref) : null
            if (this._slug && _refSlug !== null && _refSlug !== this._slug) continue
            if (ledger.active !== false) return ledger
          } catch { /* skip corrupt file */ }
        }
      } catch { /* skip unreadable dir */ }
    }
    // Legacy fallback: .groundwork/run.json
    const legacy = path.join(this._projectDir, '.groundwork', 'run.json')
    if (existsSync(legacy)) {
      try { return JSON.parse(readFileSync(legacy, 'utf8')) } catch { /* ignore */ }
    }
    return null
  }

  /** @returns {object[]} */
  _readJournalEvents() {
    const journalDir = path.join(this._projectDir, '.groundwork', 'journal')
    if (!existsSync(journalDir)) return []
    const events = []
    try {
      const files = readdirSync(journalDir)
        .filter((f) => f.endsWith('.jsonl'))
        .sort()
      for (const f of files) {
        const raw = readFileSync(path.join(journalDir, f), 'utf8')
        for (const line of raw.split('\n')) {
          const l = line.trim()
          if (!l) continue
          try {
            const ev = JSON.parse(l)
            // Filter to events belonging to this motive
            if (this._slug && ev.motive && ev.motive !== this._slug) continue
            events.push(ev)
          } catch { /* skip malformed lines */ }
        }
      }
    } catch { /* skip unreadable dir */ }
    return events
  }

  /** @returns {{ objective?: string }} */
  _readMotive() {
    const motiveFile = path.join(this._projectDir, '.groundwork', 'motives', this._slug, 'motive.md')
    if (!existsSync(motiveFile)) return {}
    try {
      const md = readFileSync(motiveFile, 'utf8')
      // Extract the first paragraph after "## Objective"
      const m = md.match(/##\s+Objective\s*\n+([\s\S]*?)(?:\n##|\s*$)/)
      return { objective: m ? m[1].trim() : undefined }
    } catch {
      return {}
    }
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Normalise a string | string[] | undefined field to string[].
 * @param {unknown} v
 * @returns {string[]}
 */
function normStringArray(v) {
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string')
  if (typeof v === 'string' && v) return [v]
  return []
}
