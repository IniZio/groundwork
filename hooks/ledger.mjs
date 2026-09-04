#!/usr/bin/env node
/**
 * Groundwork ledger CLI — the orchestrator's context-cheap interface to
 * `.groundwork/run.json`.
 *
 * WHY THIS EXISTS: the orchestrator runs on opus. Mutating the ledger by
 * Read+Edit pushed the entire ~5 KB file into context on every slice flip and
 * gate update — 15-40K opus tokens of pure bookkeeping per run — and broke
 * whenever the stop-gate hook rewrote the file behind the orchestrator's back
 * (stale Edit match). This CLI moves the read-modify-write inside one locked,
 * atomic process: the orchestrator issues a one-line command and gets a one-line
 * confirmation, never holding the ledger in context.
 *
 * Usage (invoke via Bash; path auto-resolves to $CLAUDE_PROJECT_DIR/.groundwork/run.json):
 *   ledger.mjs help                             global usage (also: -h, --help, or bare invocation)
 *   ledger.mjs <cmd> --help                     per-command usage
 *   ledger.mjs status                           compact one-line-per-slice view
 *   ledger.mjs complete S3 [S4 ...]             mark slice(s) complete
 *   ledger.mjs gate advisor APPROVE [--citation "x" --rubric "y" \
 *               --axes-correctness 3 --axes-completeness 3 --axes-over_engineering 0 \
 *               --axes-contract-fitness 2 --axes-plan-soundness 2]
 *               // advisor verdicts: APPROVE | CORRECTION | STOP | GAPS | REPLAN (bare string or {verdict})
 *   ledger.mjs abandon                          set active:false (releases the gate)
 *   ledger.mjs init <file|->                    write the initial ledger atomically
 *   ledger.mjs add <id> [--wave N] [--desc "…"] [--blocked-by a,b] [--acceptance "a;b"] [--status pending]
 *   ledger.mjs rm <id> [<id> …]                 remove slice(s)
 *   ledger.mjs set <id> [--status …] [--wave N] [--desc "…"] [--blocked-by a,b] [--acceptance "a;b"]
 *   ledger.mjs claim <id> [<id> …] [--json] [--strict]  claim slice(s) for the current session (no --token)
 *   ledger.mjs show <id>                        print all fields of one slice
 *
 * All writes are atomic and lock-serialized with the stop-gate hook (lib/ledger-io.mjs).
 * Exit 0 on success, 2 on usage error, 1 on operational failure.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { mutateLedger, readLedger, atomicWriteJsonSync, resolveLedgerPath, pruneStaleSessionLedgers } from './lib/ledger-io.mjs'
import { SCHEMA_VERSION, canonicalReleaseState, computeSeal, ensureKey, readKey, keyPath } from './lib/gate-seal.mjs'
import { checkPace, resolvedUnits, checkMilestoneArtifacts } from './lib/pacing.mjs'
import { emitHookEvent, readAllEvents, filterEvents } from './lib/journal-io.mjs'
import { loadSchema, ajvErrorsToLines } from './lib/schema-io.mjs'
import { regenerateMotiveMap } from './lib/motive-map.mjs'
import { regenerateMotiveTraceHtml } from './lib/traceability-ambient.mjs'
import { assembleGraphFold, validateFoldRefs } from './lib/motive-dag.mjs'
import { frontier as dagFrontier } from './lib/dag-utils.mjs'

/**
 * Resolve the effective session id from --session flag or CLAUDE_CODE_SESSION_ID env.
 * Returns undefined if neither is set.
 */
function resolveSessionId(flags) {
  return flags?.session || process.env.CLAUDE_CODE_SESSION_ID || undefined
}

/** Module-level resolved ledger path — set once in main() before dispatch. */
let _ledgerPath = null
function ledgerPath() {
  return _ledgerPath
}

/**
 * Best-effort MAP.md refresh after a ledger mutation.
 * Reads the current ledger to find the motive, then regenerates.
 * Never throws; silently skips when no motive is stamped.
 */
function _tryRefreshMap(projectDir) {
  try {
    const ledger = readLedger(ledgerPath())
    if (ledger?.motive) {
      regenerateMotiveMap(projectDir, ledger.motive)
      regenerateMotiveTraceHtml(projectDir, ledger.motive)
    }
  } catch { /* best-effort */ }
}

function die(msg, code = 1) {
  process.stderr.write(`ledger: ${msg}\n`)
  process.exit(code)
}

/** Pull `--flag value` pairs out of argv; returns { flags, positionals }.
 * A `--flag` followed by another `--`-prefixed token (or by nothing) is set to
 * boolean `true`; otherwise the next token is consumed as its value.
 * Exported for unit testing.
 */
export function parseFlags(args) {
  const flags = {}
  const positionals = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = args[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else {
      positionals.push(a)
    }
  }
  return { flags, positionals }
}

const SYMBOL = { complete: '✓', in_progress: '⋯', pending: '·' }
const VALID_STATUSES = new Set(['pending', 'in_progress', 'complete', 'skipped'])
const VALID_KINDS = new Set(['plan', 'diagnose', 'design', 'impl', 'fog'])
const KIND_LABEL = { plan: '📋 plan', diagnose: '🔍 diagnose', design: '🎨 design', impl: '⚙ impl', fog: '🌫 fog' }

/** Validate a kind string, die(exit 2) if invalid. */
function assertKind(val) {
  if (!VALID_KINDS.has(val)) die(`invalid kind "${val}". Must be: plan | diagnose | design | impl | fog`, 2)
}

function advisorVerdict(gate) {
  const a = gate?.advisor
  if (typeof a === 'string') return a
  if (a && typeof a === 'object' && a.verdict != null) return String(a.verdict)
  return 'pending'
}

/** Validate a status string, die(exit 2) if invalid. */
function assertStatus(val) {
  if (!VALID_STATUSES.has(val)) die(`invalid status "${val}". Must be: pending | in_progress | complete | skipped`, 2)
}

/** Validate a ticket id, die(exit 2) if it looks like a path or has a .md suffix. */
const VALID_TICKET_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/
function assertTicket(val) {
  if (!VALID_TICKET_RE.test(val)) {
    die(`invalid ticket id "${val}". Must be a bare id (e.g. "t1", "my-ticket") — no path separators or .md suffix.`, 2)
  }
}

/**
 * Load the canonical fold for a motive from its journal events.
 *
 * Graceful-degradation rule (R-008): returns null when motiveId is falsy,
 * the journal directory does not exist, no events are found for the motive,
 * or fold assembly fails for any reason. Callers skip validation on null.
 *
 * @param {string} projectDir
 * @param {string|undefined} motiveId
 * @returns {object|null}
 */
function _loadMotiveFold(projectDir, motiveId) {
  if (!motiveId) return null
  const journalDir = path.join(projectDir, '.groundwork', 'journal')
  if (!existsSync(journalDir)) return null
  try {
    const allEvents = readAllEvents(journalDir)
    const { shown: motiveEvents } = filterEvents(allEvents, { motive: motiveId })
    if (motiveEvents.length === 0) return null
    return assembleGraphFold(motiveEvents)
  } catch {
    return null // never crash a ledger write due to fold loading failure
  }
}

/**
 * Load the declared acceptance-criterion ids from the motive's charter (motive.md).
 *
 * Parses the "## Acceptance criteria" section and extracts the id from each
 * list item of the form "- <id>: description". Returns a Set of raw id strings
 * (e.g. {'AC-1', 'AC-2', 'T1-AC1'}).
 *
 * This is the authoritative source for `covers_ac` validation: a charter AC is
 * valid to reference even before any AC_COVERAGE event has been emitted for it.
 *
 * Graceful-degradation: returns an empty Set when motiveId is falsy, the
 * motive.md file does not exist, or parsing fails for any reason.
 *
 * @param {string} projectDir
 * @param {string|undefined} motiveId
 * @returns {Set<string>}
 */
function _loadCharterAcIds(projectDir, motiveId) {
  if (!motiveId || !projectDir) return new Set()
  const motivePath = path.join(projectDir, '.groundwork', 'motives', motiveId, 'motive.md')
  if (!existsSync(motivePath)) return new Set()
  try {
    const content = readFileSync(motivePath, 'utf8')
    // Find the ## Acceptance criteria section (stops at next ## heading or EOF)
    const headingMatch = content.match(/^## Acceptance criteria[^\n]*/m)
    if (!headingMatch) return new Set()
    const afterHeading = content.slice(headingMatch.index + headingMatch[0].length)
    const nextHeadingIdx = afterHeading.search(/^## /m)
    const section = nextHeadingIdx === -1 ? afterHeading : afterHeading.slice(0, nextHeadingIdx)
    const ids = new Set()
    for (const line of section.split('\n')) {
      const m = line.match(/^- (\S+):/)
      if (m) ids.add(m[1])
    }
    return ids
  } catch {
    return new Set()  // never crash a ledger write due to charter loading failure
  }
}

/**
 * Validate slice ref ids against the canonical fold (MOTIVE-DAG-R-008).
 * Writes a named diagnostic to stderr and exits nonzero for dangling refs.
 * No-op when fold is null (graceful degradation: no motive / no journal / no events).
 *
 * @param {object|null} fold      — canonical fold from _loadMotiveFold, or null
 * @param {string[]} rawIds       — raw values from the ledger field (e.g. ['D-1', 'AC-1'])
 * @param {string} fieldName      — 'covers_ac' or 'decisions'
 * @param {string} nodeType       — 'ac' or 'decision' (passed to validateFoldRefs)
 * @param {string} idPrefix       — 'ac:' or 'decision:' (prepended for fold lookup)
 */
function _assertFoldRefs(fold, rawIds, fieldName, nodeType, idPrefix) {
  if (!fold || !rawIds || rawIds.length === 0) return
  const prefixedIds = rawIds.map((id) => `${idPrefix}${id}`)
  const { missing } = validateFoldRefs(fold, prefixedIds, nodeType)
  if (missing.length === 0) return
  for (const prefixedId of missing) {
    const rawId = prefixedId.slice(idPrefix.length)
    process.stderr.write(
      `ledger error [MOTIVE-DAG-R-008]: ${fieldName} references unknown id "${rawId}" — not found in motive canonical fold\n`,
    )
  }
  process.exit(1)
}

/** Validate decision ids (shape-only). Ids not matching /^D-\d+$/ warn to stderr; exits 0. */
const VALID_DECISION_RE = /^D-\d+$/
function warnDecisions(ids) {
  for (const id of ids) {
    if (!VALID_DECISION_RE.test(id)) {
      process.stderr.write(`warning: decision id "${id}" does not match expected format D-<n> (e.g. "D-40")\n`)
    }
  }
}

// ---------------------------------------------------------------------------
// LEDGER VALIDATION — schema + custom structural invariants
// ---------------------------------------------------------------------------

/**
 * Known slice keys. Keys not in this set that resemble a known key (edit
 * distance ≤ 2) are flagged as near-miss warnings so typos like `blocked_bY`
 * are surfaced rather than silently ignored.
 */
const KNOWN_SLICE_KEYS = new Set([
  'id', 'status', 'wave', 'kind', 'desc',
  'blocked_by', 'depends_on', // depends_on = legacy alias for blocked_by
  'acceptance', 'name',
  'claimed_by', 'claimed_at', // concurrent-session claiming (S5)
  'created_by',               // S4: agent/scope identifier that created this slice (free-form string)
  'covers_ac',                // AC coverage: string | string[] — which AC<n> labels this slice covers
  'ticket',                   // ticket document id/path this slice is scoped to
  'decisions',                // decision ids constraining this slice: string | string[]
])

/** Simple Levenshtein distance, capped at 3 for performance. */
function levenshtein(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 4
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) => Array(n + 1).fill(0).map((_, j) => i === 0 ? j : j === 0 ? i : 0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

/**
 * Validate a parsed ledger document.
 *
 * Returns { errors, warnings }:
 *   errors   — hard invariants: blocked_by/depends_on referential integrity,
 *              acceptance non-empty-string elements. These fail writes.
 *   warnings — schema violations (structural issues, missing required fields) and
 *              near-miss unknown slice keys. Always surfaced to stderr, never block.
 *              NOTE: advisor verdict enum is enforced inline in cmdGate, not here,
 *              so that the error message is specific and other schema issues stay soft.
 */
function validateLedgerDoc(ledger, { strictSchema = false } = {}) {
  const errors = []
  const warnings = []

  if (ledger == null || typeof ledger !== 'object') {
    errors.push('ledger: not an object')
    return { errors, warnings }
  }

  // 1. JSON Schema validation.
  //    On the READ path (strictSchema=false): soft — structural issues surface as warnings
  //    so a corrupt pre-existing ledger doesn't brick a running session.
  //    On the WRITE path (strictSchema=true): hard — never commit new corruption to disk.
  //    advisor verdict enum is enforced inline in cmdGate with a targeted check.
  try {
    const validate = loadSchema('run-ledger')
    if (!validate(ledger) && validate.errors) {
      for (const line of ajvErrorsToLines(validate.errors, 'ledger')) {
        if (strictSchema) {
          errors.push(line)
        } else {
          warnings.push(line)
        }
      }
    }
  } catch (e) {
    warnings.push(`schema: could not load run-ledger schema (${e?.message ?? e})`)
  }

  // Build slice-id set for referential integrity checks.
  const slices = Array.isArray(ledger.slices) ? ledger.slices : []
  // Duplicate id detection: a dup means the stop-gate can never drain the ledger.
  const sliceIdCounts = new Map()
  for (const s of slices) {
    if (!s?.id) continue
    sliceIdCounts.set(s.id, (sliceIdCounts.get(s.id) ?? 0) + 1)
  }
  for (const [id, count] of sliceIdCounts) {
    if (count > 1) errors.push(`slice "${id}": duplicate id appears ${count} times`)
  }
  const sliceIds = new Set(slices.map((s) => s?.id).filter(Boolean))

  for (const s of slices) {
    if (!s || typeof s !== 'object') continue
    const sid = s.id ?? '?'

    // 2. blocked_by referential integrity (also checks depends_on legacy alias)
    for (const field of ['blocked_by', 'depends_on']) {
      if (!Array.isArray(s[field])) continue
      for (const ref of s[field]) {
        if (typeof ref === 'string' && ref && !sliceIds.has(ref)) {
          errors.push(`slice "${sid}": ${field} references unknown id "${ref}"`)
        }
      }
    }

    // 3. acceptance: if present must be non-empty array of non-empty strings
    if (Object.prototype.hasOwnProperty.call(s, 'acceptance')) {
      const acc = s.acceptance
      if (!Array.isArray(acc) || acc.length === 0) {
        errors.push(`slice "${sid}": acceptance must be a non-empty array when present (omit the key to indicate no criteria)`)
      } else if (acc.some((item) => typeof item !== 'string' || item.trim() === '')) {
        errors.push(`slice "${sid}": acceptance items must be non-empty strings`)
      }
    }

    // 4. Near-miss unknown key detection — catches typos like blocked_bY
    //    (soft warning: schema has additionalProperties:true; we cannot change it)
    for (const key of Object.keys(s)) {
      if (KNOWN_SLICE_KEYS.has(key)) continue
      let best = null, bestDist = 3
      for (const known of KNOWN_SLICE_KEYS) {
        const d = levenshtein(key, known)
        if (d < bestDist) { best = known; bestDist = d }
      }
      if (best !== null) {
        warnings.push(`slice "${sid}": unknown key "${key}" — did you mean "${best}"? (possible typo; field will be ignored)`)
      }
    }
  }

  // 5. Wave-order invariant: every blocker must be in a strictly earlier wave.
  //    Checks both blocked_by and depends_on (legacy alias for blocked_by).
  //    Violations are WARNINGS only — never errors — so existing runs with this
  //    inconsistency are not bricked; they just surface a diagnostic.
  const sliceById = new Map(slices.map((s) => [s?.id, s]))
  for (const s of slices) {
    if (!s || typeof s !== 'object') continue
    const sid = s.id ?? '?'
    const sWave = s.wave  // may be undefined / null

    for (const field of ['blocked_by', 'depends_on']) {
      if (!Array.isArray(s[field])) continue
      for (const ref of s[field]) {
        if (typeof ref !== 'string' || !ref) continue
        const blocker = sliceById.get(ref)
        if (!blocker) {
          // Dangling ref — already caught by referential integrity above.
          // Emit a distinct wave-check note so callers can identify the source.
          warnings.push(`slice "${sid}": ${field} "${ref}" — wave order cannot be verified (blocker not found in ledger)`)
          continue
        }
        const bWave = blocker.wave  // may be undefined / null
        if (sWave == null || bWave == null) {
          // Cannot compare: at least one wave is undefined.
          // Skip silently — legacy ledgers without wave fields are valid shapes
          // and must not produce spurious warnings. No throw.
          continue
        }
        if (bWave >= sWave) {
          warnings.push(
            `slice "${sid}" (wave ${sWave}): ${field} "${ref}" is in wave ${bWave} — blocker must be in a strictly earlier wave`,
          )
        }
      }
    }
  }

  return { errors, warnings }
}

/**
 * Emit validation issues to stderr as warnings (never throws).
 * Used by read-only commands so corrupt-but-parseable ledgers don't brick a session.
 */
function warnValidate(ledger) {
  const { errors, warnings } = validateLedgerDoc(ledger)
  for (const w of warnings) process.stderr.write(`ledger warn: ${w}\n`)
  for (const e of errors) process.stderr.write(`ledger warn: ${e}\n`)
}

/**
 * Validate ledger; throw on hard errors. Warnings always go to stderr.
 * Used before writes so new corruption is never committed to disk.
 * Schema violations are soft here (warnings) so that existing ledgers with minor
 * structural quirks remain mutable (complete, gate, set). Use checkLedgerStrict
 * for new ledger creation (cmdInit) where there is no excuse for writing corruption.
 */
function checkLedger(ledger) {
  const { errors, warnings } = validateLedgerDoc(ledger)
  for (const w of warnings) process.stderr.write(`ledger warn: ${w}\n`)
  if (errors.length) {
    const err = new Error('ledger validation failed:\n' + errors.map((x) => '  ' + x).join('\n'))
    err.exitCode = 1
    throw err
  }
}

/**
 * Strict variant of checkLedger for cmdInit (new ledger creation).
 * Schema violations are hard errors here because "never write new corruption"
 * is a stronger rule than "tolerate corruption already on disk".
 * Duplicate slice ids are also caught here since a dup at init-time can never
 * be drained by the stop-gate.
 */
function checkLedgerStrict(ledger) {
  const { errors, warnings } = validateLedgerDoc(ledger, { strictSchema: true })
  for (const w of warnings) process.stderr.write(`ledger warn: ${w}\n`)
  if (errors.length) {
    const err = new Error('ledger validation failed:\n' + errors.map((x) => '  ' + x).join('\n'))
    err.exitCode = 1
    throw err
  }
}

/**
 * Like mutateLedger but validates the resulting state before committing.
 * If validation finds hard errors the write is aborted and an error is thrown
 * (which the main() catch converts to exit 1).
 */
function mutateLedgerChecked(lPath, fn) {
  return mutateLedger(lPath, (l) => {
    const result = fn(l)
    const next = result === undefined ? l : result
    if (next != null) checkLedger(next)
    return result
  })
}

/**
 * Re-seal the ledger if it is in the sealed regime (gate.seal present OR key file on disk).
 * No-op for legacy in-flight ledgers (no gate.seal AND no key file — pre-fix runs).
 * Must be called INSIDE a mutateLedgerChecked callback so the updated seal is written atomically.
 * @param {object} ledger  — the ledger object being mutated in place
 * @param {string} projectDir — resolved project directory
 */
function reSeal(ledger, projectDir) {
  const sid = ledger?.session_id
  const kp = keyPath({ projectDir, sessionId: sid })
  const isSealed = ledger?.gate?.seal != null
  if (!isSealed && !existsSync(kp)) return  // legacy in-flight: skip silently
  const key = readKey({ projectDir, sessionId: sid })
  ledger.gate = ledger.gate ?? {}
  ledger.gate.seal = computeSeal(canonicalReleaseState(ledger), key)
}

/**
 * Enforce write-token authority for gate/complete/abandon/set-terminal. FAIL-CLOSED.
 * Cases:
 *   token_free === true AND no write_token → legacy opt-out ledger; bypass (backward compat)
 *   write_token present  → caller must supply the matching --token
 *   neither present      → ledger is misconfigured; reject (the fail-open window has closed)
 * NOTE: new ledgers can no longer be initialized with token_free via --no-token (D-6),
 *       but existing ledgers carrying token_free:true are still honoured for backward compat.
 * (caller is always inside mutateLedger which has a finally-cleanup for the lockfile;
 * we must throw rather than call die/process.exit to avoid bypassing that cleanup).
 */
function assertWriteToken(ledger, passedToken) {
  // token_free bypass REMOVED (D-6, D-9): every ledger must have a write_token; fail closed.
  const stored = ledger?.write_token
  if (!stored) {
    const e = new Error(
      'gate/complete/abandon require write_token authority — this ledger has none.\n' +
      '  Re-initialize via `ledger init <file>` (embeds a token).',
    )
    e.exitCode = 1
    throw e
  }
  if (!passedToken || passedToken !== stored) {
    const e = new Error(
      'gate/complete/abandon are orchestrator-only — pass --token <write_token> printed at init\n' +
      '  (run `ledger status` to check run state; the token itself is never displayed)',
    )
    e.exitCode = 1
    throw e
  }
}

/**
 * Token check for `complete` — the ONLY command that accepts scoped tokens.
 * Explicit allowlist: every other command calls `assertWriteToken` directly,
 * so any new command defaults to full-token-required unless deliberately added here.
 *
 * Accepts either:
 *   (a) the orchestrator write_token  → full authority over all slices
 *   (b) a scoped token in ledger.scoped_tokens  → only slices whose
 *       `created_by` matches the token's scope
 *
 * Returns the scope string when a scoped token was used, or null for full authority.
 * Throws (fail-closed) on any authorization failure — absent, empty, mismatched, or
 * a scoped token that doesn't own all requested slices.
 */
function assertScopedOrWriteToken(ledger, passedToken, sliceIds) {
  const stored = ledger?.write_token
  if (!stored) {
    const e = new Error(
      'complete requires write_token authority — this ledger has none.\n' +
      '  Re-initialize via `ledger init <file>` (embeds a token).',
    )
    e.exitCode = 1
    throw e
  }
  // (a) Orchestrator full authority — write_token matches
  if (passedToken && passedToken === stored) return null

  // (b) Scoped token authority — explicit allowlist for `complete` only.
  // A scoped token must be found in ledger.scoped_tokens AND every target slice
  // must carry a matching created_by.  If either check fails → reject.
  const scopedTokens = Array.isArray(ledger.scoped_tokens) ? ledger.scoped_tokens : []
  const entry = passedToken
    ? scopedTokens.find((st) => st?.token && st.token === passedToken)
    : undefined
  if (!entry) {
    const e = new Error(
      'complete requires the orchestrator write_token or a valid scoped token.\n' +
      '  Orchestrator: pass --token <write_token> printed at init.\n' +
      '  Junior orchestrator: pass --token <scoped_token> issued by `ledger scope-token <scope> --token <write_token>`.',
    )
    e.exitCode = 1
    throw e
  }
  // Scoped token verified — check ownership of every requested slice.
  const scope = entry.scope
  const slices = Array.isArray(ledger.slices) ? ledger.slices : []
  const byId = new Map(slices.map((s) => [s?.id, s]))
  for (const id of sliceIds) {
    const s = byId.get(id)
    if (!s) continue  // unknown slice id — handled separately by cmdComplete
    if (!s.created_by) {
      const e = new Error(
        `scoped token for "${scope}" cannot complete slice "${id}": no created_by set.\n` +
        '  Set --created-by when adding the slice, or use the orchestrator write_token.',
      )
      e.exitCode = 1
      throw e
    }
    if (s.created_by !== scope) {
      const e = new Error(
        `scoped token for "${scope}" cannot complete slice "${id}": owned by "${s.created_by}".`,
      )
      e.exitCode = 1
      throw e
    }
  }
  return scope
}

// ---------------------------------------------------------------------------
// HELP
// ---------------------------------------------------------------------------

/** Single source-of-truth for command usage strings. */
const HELP = {
  status: {
    summary: 'compact one-line-per-slice view of the current run',
    usage: 'ledger status',
    flags: [],
  },
  complete: {
    summary: 'mark one or more slices complete (sugar for set --status complete)',
    usage: 'ledger complete <id> [<id> ...] [--token <write_token>]',
    flags: [
      '--token <t>          write-token printed at init (required unless ledger is token-free)',
    ],
  },
  gate: {
    summary: 'set a gate verdict (advisor | verifier | qa)',
    usage: 'ledger gate <advisor|verifier|qa> <verdict> [flags]',
    flags: [
      '--token <t>          write-token printed at init (required unless ledger is token-free)',
      '--citation <text>    (advisor) citation string stored with verdict',
      '--rubric <text>      (advisor) rubric string stored with verdict',
      '--axes-correctness N (advisor) 0-3 axis score',
      '--axes-completeness N',
      '--axes-over_engineering N',
      '--axes-contract-fitness N (advisor) 0-3, or omit if N/A',
      '--axes-plan-soundness N',
    ],
  },
  abandon: {
    summary: 'set active:false — releases the stop-gate for the current run',
    usage: 'ledger abandon [--session <id>] [--token <write_token>]',
    flags: [
      '--session <id>   override session id (default: CLAUDE_CODE_SESSION_ID env)',
      '--token <t>      write-token printed at init (required for sealed runs)',
    ],
  },
  init: {
    summary: 'write the initial ledger atomically from a JSON file or stdin',
    usage: 'ledger init <file|-> [--motive <id>] [--token <existing-token>]',
    flags: [
      '--motive <id>        motive id to stamp on the ledger (overrides JSON input)',
      '--token <t>          write-token of the existing active run (required to overwrite a live run)',
    ],
  },
  add: {
    summary: 'insert a new slice into the ledger',
    usage: 'ledger add <id> [flags]',
    flags: [
      '--wave N             wave number (default 0)',
      '--desc "…"           human description (default "")',
      '--kind <k>           plan | diagnose | design | impl (default impl)',
      '--status <s>         pending | in_progress | complete | skipped (default pending)',
      '--blocked-by a,b,c  comma-separated list of blocking slice ids',
      '--acceptance "a;b"  semicolon-separated acceptance criteria strings',
      '--ticket <tid>      ticket document id or path this slice is scoped to',
      '--covers-ac "a,b"   comma-separated AC labels this slice covers (drives AC_COVERAGE on complete)',
      '--decisions "D-1"   comma-separated decision ids this slice is constrained by',
      '--claimed-by <sid>  (optional) set claimed_by on the new slice',
      '--created-by <scope> agent/scope identifier that owns this slice',
    ],
  },
  'scope-token': {
    summary: 'issue a scoped token authorizing a junior-orchestrator to complete its own slices',
    usage: 'ledger scope-token <scope> --token <write_token>',
    flags: [
      '--token <t>   orchestrator write-token (required — issuance is orchestrator-only)',
    ],
  },
  'await-human': {
    summary: 'set or clear the awaiting-human hold (silences the stop-gate while paused for a human decision)',
    usage: 'ledger await-human [clear] --token <write_token>',
    flags: [
      'clear         positional — pass "clear" as the first argument to release the hold',
      '--token <t>   orchestrator write-token (required — hold is orchestrator-only)',
    ],
  },
  'milestone-signoff': {
    summary: 'record a human sign-off on the current milestone (policy=milestone only; SECURITY: requires write_token)',
    usage: 'ledger milestone-signoff --verdict APPROVE|REJECT --verified-by <name> --token <write_token>',
    flags: [
      '--verdict APPROVE|REJECT    required — APPROVE releases the pacing gate; REJECT holds it',
      '--verified-by <name>        required — identity of the human signer',
      '--note "…"                  optional — remediation note (recommended for REJECT)',
      '--build-hash <hash>         optional — current build hash; artifacts with a different captured_build_hash are rejected as stale',
      '--token <t>                 orchestrator write-token (required — sign-off is orchestrator-only; subagents must not self-sign)',
    ],
  },
  rm: {
    summary: 'remove one or more slices from the ledger',
    usage: 'ledger rm <id> [<id> ...]',
    flags: [],
  },
  set: {
    summary: 'update fields on an existing slice (only provided fields change)',
    usage: 'ledger set <id> [flags]',
    flags: [
      '--status <s>         pending | in_progress | complete',
      '--wave N             new wave number',
      '--desc "…"           new description',
      '--blocked-by a,b,c  comma-separated list of blocking slice ids',
      '--acceptance "a;b"  semicolon-separated acceptance criteria strings',
      '--ticket <tid>      ticket document id or path this slice is scoped to',
      '--covers-ac "a,b"   comma-separated AC labels this slice covers (drives AC_COVERAGE on complete)',
      '--decisions "D-1"   comma-separated decision ids this slice is constrained by',
      '--claimed-by <sid>  set claimed_by on the slice',
    ],
  },
  claim: {
    summary: 'claim one or more slices for the current session (no --token required)',
    usage: 'ledger claim <id> [<id> ...] [--json] [--strict]',
    flags: [
      '--session <id>   override session id (default: CLAUDE_CODE_SESSION_ID env)',
      '--json           print JSON result to stdout: {claimed, refused, ok} (ok=false on any refusal)',
      '--strict         exit non-zero when any id was refused (default: always exit 0)',
    ],
  },
  show: {
    summary: 'print all fields of one slice in a readable form',
    usage: 'ledger show <id>',
    flags: [],
  },
  view: {
    summary: 'render run.json as a human-readable markdown table grouped by wave/status',
    usage: 'ledger view',
    flags: [],
  },
  fog: {
    summary: 'add an open-question (fog) slice with no acceptance criteria required',
    usage: 'ledger fog <id> --desc "…" --question "…" [--wave N]',
    flags: [
      '--desc "…"       human description (required)',
      '--question "…"   the open question being tracked (required)',
      '--wave N         wave number (default 0)',
    ],
  },
  frontier: {
    summary: 'print slices a session can start right now (pending/open, unblocked, unclaimed or same session)',
    usage: 'ledger frontier [--session <id>]',
    flags: [
      '--session <id>   override session id (default: CLAUDE_CODE_SESSION_ID env)',
    ],
  },
  autopilot: {
    summary: 'extend session pacing budget by N units (requires write-token authority)',
    usage: 'ledger autopilot --range N --token <write_token> --reason "..."',
    flags: [
      '--range N        number of additional units to grant (required, ≥1)',
      '--token <t>      write-token printed at init (required if ledger has write_token)',
      '--reason "..."   human-readable rationale for the grant (required, must be non-empty)',
    ],
  },
}

function cmdHelp(args) {
  // `ledger help <cmd>` or `ledger <cmd> --help`
  if (args.length) {
    const cmd = args[0]
    const h = HELP[cmd]
    if (!h) die(`unknown command "${cmd}". Run ledger help for a list.`, 2)
    const lines = [`Usage: ${h.usage}`, `  ${h.summary}`]
    if (h.flags.length) {
      lines.push('', 'Flags:')
      h.flags.forEach((f) => lines.push(`  ${f}`))
    }
    process.stdout.write(lines.join('\n') + '\n')
    return
  }
  // global help
  const cmds = Object.entries(HELP)
    .map(([name, h]) => `  ${name.padEnd(10)} ${h.summary}`)
    .join('\n')
  process.stdout.write(
    [
      'Usage: ledger <command> [args] [flags]',
      '',
      'Commands:',
      cmds,
      '',
      'Run `ledger help <command>` or `ledger <command> --help` for per-command details.',
      'Exit codes: 0 success  1 operational failure  2 usage error',
    ].join('\n') + '\n',
  )
}

// ---------------------------------------------------------------------------
// EXISTING COMMANDS
// ---------------------------------------------------------------------------

function cmdStatus() {
  const l = readLedger(ledgerPath())
  if (!l) die('no ledger at ' + ledgerPath(), 1)
  warnValidate(l)
  const slices = Array.isArray(l.slices) ? l.slices : []
  const done = slices.filter((s) => s?.status === 'complete').length
  const head = `run: ${l.brief ?? '(no brief)'}${l.active === false ? '  [ABANDONED]' : ''}`
  const rows = slices.map((s) => {
    const sym = SYMBOL[s?.status] ?? `?${s?.status ?? ''}`
    const dep = Array.isArray(s?.blocked_by) && s.blocked_by.length ? ` ⟵${s.blocked_by.join(',')}` : ''
    const wave = s?.wave != null ? `w${s.wave}` : ''
    const claim = s?.claimed_by ? ` [claimed:${s.claimed_by}]` : ''
    return `${s?.id ?? '?'}${sym}${wave ? ' ' + wave : ''}${dep}${claim}`
  })
  const gate = l.gate ?? {}
  process.stdout.write(
    `${head}\n${rows.join('  ')}\n` +
      `gate: advisor=${advisorVerdict(gate)}\n` +
      `${done}/${slices.length} slices complete\n`,
  )
}

function cmdComplete(args) {
  const { flags, positionals: ids } = parseFlags(args)
  if (!ids.length) die('usage: ledger complete <id> [<id> ...] [--token <write_token>]', 2)
  let done = 0
  let total = 0
  const missing = []
  let capturedLedger = null
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  mutateLedgerChecked(ledgerPath(), (l) => {
    if (!l) throw new Error('no ledger to update')
    // S5: accept orchestrator write_token (full authority) OR a valid scoped token
    // (restricted to slices owned by the token's scope).  All other commands
    // retain assertWriteToken — this explicit allowlist is the security boundary.
    assertScopedOrWriteToken(l, flags.token, ids)
    capturedLedger = l
    const slices = Array.isArray(l.slices) ? l.slices : []
    const byId = new Map(slices.map((s) => [s?.id, s]))
    const now = new Date().toISOString()
    for (const id of ids) {
      const s = byId.get(id)
      if (!s) missing.push(id)
      else {
        s.status = 'complete'
        s.completed_at = now
        s.session_id = l.session_id ?? null
        delete s.claimed_by
        delete s.claimed_at
      }
    }
    total = slices.length
    done = slices.filter((s) => s?.status === 'complete').length
    reSeal(l, projectDir)  // S2-AC5: re-seal after mutation (no-op for legacy runs)
  })
  // Emit one TASK_COMPLETE per found-and-marked id; must precede die() so partial
  // successes (e.g. "ledger complete S1 BOGUS") are still recorded (AC8).
  if (capturedLedger) {
    const sliceMap = new Map((capturedLedger.slices ?? []).map((s) => [s?.id, s]))
    for (const id of ids.filter((id) => !missing.includes(id))) {
      emitHookEvent({
        projectDir,
        sessionId: capturedLedger.session_id,
        type: 'TASK_COMPLETE',
        source: 'hook:ledger',
        data: { slice: id },
        ledger: capturedLedger,
      })
      // Emit one AC_COVERAGE event per (slice, AC) pair declared in covers_ac.
      const slice = sliceMap.get(id)
      const raw = slice?.covers_ac
      const acKeys = Array.isArray(raw) ? raw : raw != null ? [String(raw)] : []
      for (const ac of acKeys) {
        emitHookEvent({
          projectDir,
          sessionId: capturedLedger.session_id,
          type: 'AC_COVERAGE',
          source: 'hook:ledger',
          data: { slice: id, ac },
          ledger: capturedLedger,
        })
      }
    }
  }
  if (missing.length) die(`unknown slice id(s): ${missing.join(', ')}`, 2)
  _tryRefreshMap(process.env.CLAUDE_PROJECT_DIR || process.cwd())
  process.stdout.write(`${ids.join(', ')} ✓ (${done}/${total} complete)\n`)
}

/**
 * S5: Set or clear the awaiting-human hold on the ledger.
 *
 * While the hold is active (awaiting_human:true, valid seal), the stop-gate will
 * NOT block and will NOT increment the reinforcements counter.  The hold defers
 * nagging; it does NOT bypass the completion gate — releasing it resumes normal
 * enforcement (all slices complete + advisor APPROVE still required).
 *
 * The hold requires the orchestrator write_token (same as complete/gate/abandon).
 * Any direct file write adding awaiting_human:true changes the canonical release
 * state without updating the HMAC → seal fails → stop-gate blocks (fail-closed).
 */
function cmdAwaitHuman(args) {
  const { flags, positionals } = parseFlags(args ?? [])
  // Use a positional subcommand "clear" rather than a boolean --flag so that
  // `await-human clear --token X` is unambiguous across all callers.
  const clearing = positionals[0] === 'clear'
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  mutateLedgerChecked(ledgerPath(), (l) => {
    if (!l) throw new Error('no ledger to update')
    assertWriteToken(l, flags.token)  // orchestrator-only — same authority as complete/gate/abandon
    if (clearing) {
      delete l.awaiting_human
    } else {
      l.awaiting_human = true
    }
    reSeal(l, projectDir)  // re-seal so stop-gate can verify the hold was set legitimately
  })
  if (clearing) {
    process.stdout.write('awaiting-human hold cleared — normal gate enforcement resumes\n')
  } else {
    process.stdout.write('awaiting-human hold set — stop-gate will not nag until the hold is cleared\n')
  }
}

/**
 * S7: Record a human milestone sign-off on the ledger.
 *
 * SECURITY — write_token required (same authority as complete/gate/abandon).
 * A subagent cannot present the write_token (CLAUDE.md: "MUST NOT pass it to
 * subagents"), so requiring it here structurally prevents self-signing.
 *
 * For verdict=APPROVE with --build-hash supplied, each declared artifact whose
 * captured_build_hash differs from the supplied current hash is rejected as stale;
 * the command exits 1 and does NOT write the sign-off.
 *
 * The written milestone_signoff is included in canonicalReleaseState (gate-seal.mjs),
 * so any direct file write that injects an APPROVE verdict without going through this
 * command changes the seal → stop-gate blocks (fail-closed).
 */
function cmdMilestoneSignoff(args) {
  const { flags } = parseFlags(args ?? [])

  const verdict = flags.verdict
  if (!verdict || !['APPROVE', 'REJECT'].includes(verdict)) {
    die('milestone-signoff requires --verdict APPROVE|REJECT', 2)
  }
  const verifiedBy = flags['verified-by']
  if (!verifiedBy) {
    die('milestone-signoff requires --verified-by <name>', 2)
  }
  const note = flags.note ?? undefined
  const currentBuildHash = flags['build-hash'] ?? null

  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  mutateLedgerChecked(ledgerPath(), (l) => {
    if (!l) throw new Error('no ledger to update')
    assertWriteToken(l, flags.token)  // SECURITY: orchestrator-only — same authority as complete/gate/abandon

    if (l.pacing?.policy !== 'milestone') {
      const e = new Error(
        `milestone-signoff requires pacing.policy = "milestone". Current policy: ${l.pacing?.policy ?? 'none'}.`,
      )
      e.exitCode = 1
      throw e
    }

    // Artifact freshness gate: reject stale artifacts before writing APPROVE.
    if (verdict === 'APPROVE') {
      // Hash-based staleness (pure, via pacing.mjs — same mechanism as traceability-classify.mjs).
      const hashCheck = checkMilestoneArtifacts(l, currentBuildHash)
      if (!hashCheck.satisfied) {
        const e = new Error(
          `Milestone sign-off rejected: ${hashCheck.reason}\n` +
          `Stale artifacts must be re-captured against the current build before an APPROVE can be recorded.\n` +
          `Stale paths: ${hashCheck.staleArtifacts.join(', ')}`,
        )
        e.exitCode = 1
        throw e
      }

      // File-existence gate: each declared artifact path must exist on disk.
      const artifacts = Array.isArray(l.pacing.milestone_artifacts) ? l.pacing.milestone_artifacts : []
      for (const artifact of artifacts) {
        if (artifact.kind !== 'live_url' && artifact.path && !existsSync(artifact.path)) {
          const e = new Error(
            `Milestone artifact not found on disk: ${artifact.path}\n` +
            `Ensure the artifact exists before recording an APPROVE sign-off.`,
          )
          e.exitCode = 1
          throw e
        }
      }
    }

    const artifacts = Array.isArray(l.pacing?.milestone_artifacts) ? l.pacing.milestone_artifacts : []
    const artifactsVerified = artifacts.map((a) => a.path ?? '').filter(Boolean)

    if (!l.pacing) l.pacing = {}
    l.pacing.milestone_signoff = {
      verdict,
      verified_by: verifiedBy,
      verified_at: new Date().toISOString(),
      artifacts_verified: artifactsVerified,
      ...(note !== undefined ? { note } : {}),
    }
    reSeal(l, projectDir)
  })
  process.stdout.write(`milestone-signoff: ${verdict} by ${verifiedBy}\n`)
}

/**
 * S5: Issue a scoped token bound to <scope>.  Only slices whose `created_by`
 * matches this scope can be completed using the returned token.  Issuance
 * requires the orchestrator write_token — scoped tokens cannot bootstrap
 * themselves and cannot escalate to full authority.
 */
function cmdScopeToken(args) {
  const { flags, positionals } = parseFlags(args)
  const scope = positionals[0]
  if (!scope) die('usage: ledger scope-token <scope> --token <write_token>', 2)
  let scopedToken = null
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  mutateLedgerChecked(ledgerPath(), (l) => {
    if (!l) throw new Error('no ledger to update')
    assertWriteToken(l, flags.token)  // orchestrator-only
    const tok = 'sct_' + randomBytes(8).toString('hex')
    if (!Array.isArray(l.scoped_tokens)) l.scoped_tokens = []
    l.scoped_tokens.push({ scope, token: tok })
    scopedToken = tok
    reSeal(l, projectDir)
  })
  process.stdout.write(
    `scoped_token: ${scopedToken}\n` +
    `  scope: ${scope}\n` +
    `  (pass as --token to \`ledger complete\` for slices with created_by="${scope}")\n`,
  )
}

function cmdGate(args) {
  const { flags, positionals } = parseFlags(args)
  const [which, verdictRaw] = positionals
  if (!which || !verdictRaw) die('usage: ledger gate <advisor|verifier|qa> <verdict> [--token <t>] [--citation .. --rubric ..]', 2)
  if (!['advisor', 'verifier', 'qa'].includes(which)) die(`unknown gate "${which}"`, 2)
  // Advisor verdicts (from agents-src/advisor.md): APPROVE | CORRECTION | STOP | GAPS | REPLAN
  // (REPLAN is non-terminal — stop-gate routes back to interview/vertical-slice).
  const VALID_ADVISOR_VERDICTS = new Set(['APPROVE', 'CORRECTION', 'STOP', 'GAPS', 'REPLAN'])
  if (which === 'advisor' && !VALID_ADVISOR_VERDICTS.has(verdictRaw)) {
    die(`invalid advisor verdict "${verdictRaw}". Must be: APPROVE | CORRECTION | STOP | GAPS | REPLAN`, 1)
  }
  const AXIS_KEYS = ['correctness', 'completeness', 'over_engineering', 'contract_fitness', 'plan_soundness']
  const hasAxes = AXIS_KEYS.some((k) => flags[`axes-${k}`] != null)
  const hasObj = which === 'advisor' && (flags.citation || flags.rubric || hasAxes)
  let value
  if (hasObj) {
    value = { verdict: verdictRaw }
    if (flags.rubric) value.rubric = flags.rubric
    if (flags.citation) value.citation = flags.citation
    const axes = {}
    for (const k of AXIS_KEYS) {
      if (flags[`axes-${k}`] != null) axes[k] = Number(flags[`axes-${k}`])
    }
    if (Object.keys(axes).length) value.axes = axes
  } else {
    value = verdictRaw
  }
  let runId = null
  let capturedLedger = null
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  mutateLedgerChecked(ledgerPath(), (l) => {
    if (!l) throw new Error('no ledger to update')
    assertWriteToken(l, flags.token)
    capturedLedger = l
    l.gate = l.gate ?? {}
    l.gate[which] = value
    runId = l.session_id ?? l.run_id ?? null
    reSeal(l, projectDir)  // S2-AC5: re-seal after gate mutation (no-op for legacy runs)
  })
  // Write gate artifact
  writeGateArtifact({ runId, which, verdictRaw, value, hasObj, flags })
  if (capturedLedger) {
    emitHookEvent({
      projectDir,
      sessionId: capturedLedger.session_id,
      type: 'GATE',
      source: 'hook:ledger',
      data: { which, verdict: verdictRaw, ...(flags.citation ? { citation: flags.citation } : {}), ...(flags.rubric ? { rubric: flags.rubric } : {}) },
      ledger: capturedLedger,
    })
    regenerateMotiveMap(projectDir, capturedLedger.motive)
    regenerateMotiveTraceHtml(projectDir, capturedLedger.motive)
  }
  process.stdout.write(`${which}: ${hasObj ? value.verdict : value}\n`)
}

/** Write .groundwork/gates/<run-id>.md with a machine-parseable header + human body. */
function writeGateArtifact({ runId, which, verdictRaw, value, hasObj }) {
  const base = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  const gatesDir = path.join(base, '.groundwork', 'gates')
  try {
    mkdirSync(gatesDir, { recursive: true })
  } catch {
    return // best-effort; never block the gate write itself
  }
  const filename = `${runId ?? 'unknown'}.md`
  const filePath = path.join(gatesDir, filename)
  const verdictLine = `verdict: ${verdictRaw}`
  const lines = [verdictLine, '']
  lines.push(`# Gate Record — ${which}`)
  lines.push(``)
  lines.push(`**Verdict:** ${verdictRaw}`)
  if (hasObj && value && typeof value === 'object') {
    if (value.rubric) lines.push(`**Rubric:** ${value.rubric}`)
    if (value.citation) lines.push(`**Citation:** ${value.citation}`)
    if (value.axes && typeof value.axes === 'object') {
      lines.push(``)
      lines.push('**Axes:**')
      for (const [k, v] of Object.entries(value.axes)) {
        lines.push(`- ${k}: ${v}`)
      }
    }
  }
  lines.push(``)
  lines.push(`*Recorded at ${new Date().toISOString()}*`)
  try {
    writeFileSync(filePath, lines.join('\n') + '\n')
  } catch {
    // best-effort
  }
}

function cmdAbandon(args) {
  const { flags } = parseFlags(args ?? [])
  let capturedLedger = null
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  mutateLedgerChecked(ledgerPath(), (l) => {
    if (!l) throw new Error('no ledger to abandon')
    // S2-AC3: abandon requires token (vector 4) — including cross-session abandon (--session
    // flag). The caller must supply the target session's write_token via --token.
    assertWriteToken(l, flags.token)
    capturedLedger = l
    l.active = false
    reSeal(l, projectDir)  // S2-AC3: re-seal with active:false so stop-gate accepts abandon
  })
  if (capturedLedger) {
    emitHookEvent({
      projectDir,
      sessionId: capturedLedger.session_id,
      type: 'SESSION_END',
      source: 'hook:ledger',
      data: { outcome: 'abandoned' },
      ledger: capturedLedger,
    })
    regenerateMotiveMap(projectDir, capturedLedger.motive)
    regenerateMotiveTraceHtml(projectDir, capturedLedger.motive)
  }
  process.stdout.write('run cancelled (active:false) — gate released\n')
}

function cmdInit(args) {
  // Support both legacy single-positional form and new flag-based form.
  // When args is a string (old call site), wrap it; this path should not occur
  // after the main() update below but kept defensively.
  const argv = Array.isArray(args) ? args : (args ? [args] : [])
  const { flags, positionals } = parseFlags(argv)
  const src = positionals[0]

  if (!src) die('usage: ledger init <file|-> [--motive <id>] [--token <existing-token>]', 2)

  let obj = {}

  if (src) {
    let raw
    try {
      raw = src === '-' ? readFileSync(0, 'utf8') : readFileSync(src, 'utf8')
    } catch (e) {
      die(`cannot read initial ledger from ${src}: ${e?.message ?? e}`, 1)
    }
    try {
      obj = JSON.parse(raw)
    } catch (e) {
      die(`initial ledger is not valid JSON: ${e?.message ?? e}`, 2)
    }
  }

  // S2-AC2 (vectors 1 & 2): refuse to overwrite an active tokened run without --token.
  // This prevents a subagent from re-initializing the orchestrator's live run and
  // either hijacking its seal or minting a new token it controls.
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  try {
    const existing = readLedger(ledgerPath())
    if (existing?.active === true && existing?.write_token) {
      if (!flags.token || flags.token !== existing.write_token) {
        die(
          'init would overwrite an active run — pass --token <write_token> to confirm overwrite,\n' +
          '  or wait for the run to end (abandon/gate) before re-initializing.',
          2,
        )
      }
    }
  } catch { /* no existing ledger or unreadable — fresh init, proceed */ }

  // Generate and embed the write-token for gate/complete/abandon authority (D-6).
  // The --no-token escape hatch has been retired; every new run gets a token.
  const writeToken = randomBytes(8).toString('hex')
  obj.write_token = writeToken
  delete obj.token_free  // retire any stale token_free from input

  // Stamp schema_version to mark this ledger as sealed-regime (S2-AC1).
  obj.schema_version = SCHEMA_VERSION

  // Ensure required field `active` is present (schema requires it; cmdInit always starts active).
  if (!('active' in obj)) obj.active = true
  // Stamp session_id: always overwrite with the current session so that ledgers
  // seeded from a prior session's JSON carry the correct (new) session id.
  // The file path already encodes the new session id; the body must match.
  const sessionId = resolveSessionId(null)
  obj.session_id = sessionId ?? randomBytes(16).toString('hex')
  // Stamp motive: --motive flag overrides JSON input; JSON input is preserved as-is.
  if (flags.motive != null) obj.motive = flags.motive
  // Stamp pacing defaults on new runs (D-28): only when the input has no pacing field.
  // Existing ledgers that already carry a pacing field are preserved as-is.
  if (!('pacing' in obj)) {
    obj.pacing = { policy: 'wave', budget: 1, exempt_kinds: ['plan', 'diagnose', 'design', 'fog'] }
  }
  // Record pacing offset: the number of already-resolved units carried in from
  // the seed JSON.  The pacing engine subtracts this so that prior-session
  // completions don't count against this session's budget (F14 fix).
  // We compute it AFTER the pacing field is guaranteed present but BEFORE
  // validation so the schema can enforce the field type.
  obj.pacing.offset = resolvedUnits(obj)
  // Validate before writing — strict: schema violations are hard errors at init
  // time because there is no excuse for persisting corruption in a fresh ledger.
  checkLedgerStrict(obj)
  // Best-effort prune stale per-session ledgers FIRST.
  // Order matters: prune co-deletes each stale ledger's `.seal.key` sibling, and
  // a prior run for THIS session id (abandoned → active:false) shares that exact
  // key path.  Minting before pruning let the prune delete the key it had just
  // created, leaving a ledger no token-authenticated write could reseal.
  try { pruneStaleSessionLedgers(projectDir) } catch { /* best-effort */ }
  // Mint the seal key and compute the initial seal (S2-AC1).
  const key = ensureKey({ projectDir, sessionId: obj.session_id })
  obj.gate = obj.gate ?? {}
  obj.gate.seal = computeSeal(canonicalReleaseState(obj), key)
  atomicWriteJsonSync(ledgerPath(), obj)
  if (obj.motive) regenerateMotiveMap(projectDir, obj.motive)
  if (obj.motive) regenerateMotiveTraceHtml(projectDir, obj.motive)
  const n = Array.isArray(obj?.slices) ? obj.slices.length : 0
  process.stdout.write(`ledger initialized: ${n} slices → ${ledgerPath()}\n`)
  process.stdout.write(`write_token: ${writeToken}  (orchestrator: pass --token on gate/complete/abandon)\n`)
}

// ---------------------------------------------------------------------------
// SLICE CRUD
// ---------------------------------------------------------------------------

function cmdAdd(args) {
  const { flags, positionals } = parseFlags(args)
  const id = positionals[0]
  if (!id) die('usage: ledger add <id> [--wave N] [--desc "…"] [--kind <k>] [--blocked-by a,b] [--acceptance "a;b"] [--status pending]', 2)
  const status = flags.status ?? 'pending'
  assertStatus(status)
  if (flags.kind != null) assertKind(flags.kind)
  const wave = flags.wave != null ? Number(flags.wave) : 0
  const desc = flags.desc ?? ''
  const blocked_by = flags['blocked-by'] ? flags['blocked-by'].split(',').map((s) => s.trim()).filter(Boolean) : []
  const acceptance = flags.acceptance ? flags.acceptance.split(';').map((s) => s.trim()).filter(Boolean) : []
  const coversAcRaw = flags['covers-ac'] != null ? flags['covers-ac'].split(',').map((s) => s.trim()).filter(Boolean) : null
  const decisionsRaw = flags['decisions'] != null ? flags['decisions'].split(',').map((s) => s.trim()).filter(Boolean) : null

  // R-008: validate covers_ac and decisions against the canonical fold when motive is present.
  // covers_ac: valid if declared in the motive's charter AC list OR present as a fold AC node.
  // decisions: valid only if present as a fold decision node.
  // Graceful degradation: skips validation when no motive, no journal, or no motive events.
  if (coversAcRaw != null || decisionsRaw != null) {
    const addProjectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()
    const existingLedger = readLedger(ledgerPath())
    const fold = _loadMotiveFold(addProjectDir, existingLedger?.motive)
    if (coversAcRaw != null) {
      const charterAcIds = _loadCharterAcIds(addProjectDir, existingLedger?.motive)
      const unknownAcIds = coversAcRaw.filter((id) => !charterAcIds.has(id))
      _assertFoldRefs(fold, unknownAcIds, 'covers_ac', 'ac', 'ac:')
    }
    if (decisionsRaw != null) _assertFoldRefs(fold, decisionsRaw, 'decisions', 'decision', 'decision:')
  }

  mutateLedgerChecked(ledgerPath(), (l) => {
    // Create a minimal ledger skeleton if none exists yet
    const ledger = l ?? { active: true, brief: '', slices: [], gate: {} }
    ledger.slices = Array.isArray(ledger.slices) ? ledger.slices : []
    if (ledger.slices.some((s) => s?.id === id)) {
      // signal dup — throw so we can die(exit 2) after; we catch specially below
      const e = new Error(`slice "${id}" already exists`)
      e.exitCode = 2
      throw e
    }
    const item = { id, wave, status, desc, blocked_by }
    // Only set acceptance when explicitly provided (omitting [] keeps the key
    // absent, which is valid; present+empty is now a validation error).
    if (acceptance.length > 0) item.acceptance = acceptance
    if (flags.kind != null) item.kind = flags.kind
    if (flags.ticket != null) { assertTicket(flags.ticket); item.ticket = flags.ticket }
    if (coversAcRaw != null && coversAcRaw.length > 0) item.covers_ac = coversAcRaw
    if (decisionsRaw != null && decisionsRaw.length > 0) { warnDecisions(decisionsRaw); item.decisions = decisionsRaw }
    if (flags['claimed-by'] != null) {
      item.claimed_by = flags['claimed-by']
      item.claimed_at = new Date().toISOString()
    }
    if (flags['created-by'] != null) item.created_by = flags['created-by']
    ledger.slices.push(item)
    return l === null ? ledger : undefined // return new object only if we created it
  })
  const kindNote = flags.kind != null ? `, kind=${flags.kind}` : ''
  _tryRefreshMap(process.env.CLAUDE_PROJECT_DIR || process.cwd())
  process.stdout.write(`${id} added (wave ${wave}, ${status}${kindNote})\n`)
}

function cmdRm(args) {
  const { flags, positionals: ids } = parseFlags(Array.isArray(args) ? args : [])
  if (!ids.length) die('usage: ledger rm <id> [<id> ...] [--token <write_token>]', 2)
  let remaining = 0
  const missing = []
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  mutateLedgerChecked(ledgerPath(), (l) => {
    if (!l) throw new Error('no ledger to update')
    // Vector 6: rm changes the canonical release state (slice set) — requires write token.
    assertWriteToken(l, flags.token)
    const slices = Array.isArray(l.slices) ? l.slices : []
    const existingIds = new Set(slices.map((s) => s?.id))
    for (const id of ids) {
      if (!existingIds.has(id)) missing.push(id)
    }
    if (missing.length) {
      // abort: throw so no write happens, then die exit 2
      const e = new Error(`unknown slice id(s): ${missing.join(', ')}`)
      e.exitCode = 2
      throw e
    }
    const removeSet = new Set(ids)
    l.slices = slices.filter((s) => !removeSet.has(s?.id))
    remaining = l.slices.length
    reSeal(l, projectDir)  // Vector 6: re-seal after rm (slice removal changes release predicate)
  })
  _tryRefreshMap(projectDir)
  process.stdout.write(`removed: ${ids.join(', ')} (${remaining} slice${remaining === 1 ? '' : 's'} remain)\n`)
}

function cmdSet(args) {
  const { flags, positionals } = parseFlags(args)
  const id = positionals[0]
  if (!id) die('usage: ledger set <id> [--status …] [--wave N] [--desc "…"] [--blocked-by a,b] [--acceptance "a;b"]', 2)
  const hasFields = ['status', 'wave', 'desc', 'blocked-by', 'acceptance', 'claimed-by', 'ticket', 'covers-ac', 'decisions'].some((k) => flags[k] != null)
  if (!hasFields) die('ledger set: no fields provided. Specify at least one of --status --wave --desc --blocked-by --acceptance --claimed-by --ticket --covers-ac --decisions', 2)
  if (flags.status != null) assertStatus(flags.status)

  const updated = []
  const TERMINAL_STATUSES = new Set(['complete', 'skipped'])
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()

  // R-008: validate covers_ac and decisions against the canonical fold when motive is present.
  // covers_ac: valid if declared in the motive's charter AC list OR present as a fold AC node.
  // decisions: valid only if present as a fold decision node.
  // Graceful degradation: skips validation when no motive, no journal, or no motive events.
  if (flags['covers-ac'] != null || flags['decisions'] != null) {
    const setLedger = readLedger(ledgerPath())
    const fold = _loadMotiveFold(projectDir, setLedger?.motive)
    if (flags['covers-ac'] != null) {
      const acIds = flags['covers-ac'].split(',').map((v) => v.trim()).filter(Boolean)
      const charterAcIds = _loadCharterAcIds(projectDir, setLedger?.motive)
      const unknownAcIds = acIds.filter((id) => !charterAcIds.has(id))
      _assertFoldRefs(fold, unknownAcIds, 'covers_ac', 'ac', 'ac:')
    }
    if (flags['decisions'] != null) {
      const decIds = flags['decisions'].split(',').map((v) => v.trim()).filter(Boolean)
      _assertFoldRefs(fold, decIds, 'decisions', 'decision', 'decision:')
    }
  }

  mutateLedgerChecked(ledgerPath(), (l) => {
    if (!l) throw new Error('no ledger to update')
    const slices = Array.isArray(l.slices) ? l.slices : []
    const s = slices.find((s) => s?.id === id)
    if (!s) {
      const e = new Error(`unknown slice id "${id}"`)
      e.exitCode = 2
      throw e
    }
    // S2-AC4 (vector 3): raw `set` to a terminal status requires the write token —
    // prevents a subagent bypassing the complete guard. Fails closed if no write_token.
    if (flags.status != null && TERMINAL_STATUSES.has(flags.status)) {
      assertWriteToken(l, flags.token)
    }
    if (flags.status != null) {
      // Pacing enforcement (D-28): block in_progress transitions when budget is exhausted.
      // --build-hash enables milestone artifact-freshness check (pure — no I/O in checkPace).
      if (flags.status === 'in_progress') {
        const pace = checkPace(l, id, flags['build-hash'] ?? null)
        if (!pace.allowed) {
          const e = new Error(`${pace.reason}\n${pace.remedy}`)
          e.exitCode = 1
          throw e
        }
      }
      s.status = flags.status
      if (flags.status === 'complete') {
        s.completed_at = new Date().toISOString()
        s.session_id = l.session_id ?? null
        delete s.claimed_by
        delete s.claimed_at
      } else if (flags.status === 'skipped') {
        delete s.claimed_by
        delete s.claimed_at
      }
      updated.push(`status=${flags.status}`)
    }
    if (flags.wave != null) { s.wave = Number(flags.wave); updated.push(`wave=${s.wave}`) }
    if (flags.desc != null) { s.desc = flags.desc; updated.push(`desc="${flags.desc}"`) }
    if (flags['blocked-by'] != null) {
      s.blocked_by = flags['blocked-by'].split(',').map((v) => v.trim()).filter(Boolean)
      updated.push(`blocked_by=[${s.blocked_by.join(',')}]`)
    }
    if (flags.acceptance != null) {
      s.acceptance = flags.acceptance.split(';').map((v) => v.trim()).filter(Boolean)
      updated.push(`acceptance(${s.acceptance.length})`)
    }
    if (flags['claimed-by'] != null) {
      s.claimed_by = flags['claimed-by']
      s.claimed_at = new Date().toISOString()
      updated.push(`claimed_by=${flags['claimed-by']}`)
    }
    if (flags.ticket != null) { assertTicket(flags.ticket); s.ticket = flags.ticket; updated.push(`ticket=${flags.ticket}`) }
    if (flags['covers-ac'] != null) {
      s.covers_ac = flags['covers-ac'].split(',').map((v) => v.trim()).filter(Boolean)
      updated.push(`covers_ac=[${s.covers_ac.join(',')}]`)
    }
    if (flags['decisions'] != null) {
      s.decisions = flags['decisions'].split(',').map((v) => v.trim()).filter(Boolean)
      warnDecisions(s.decisions)
      updated.push(`decisions=[${s.decisions.join(',')}]`)
    }
    reSeal(l, projectDir)  // S2-AC4: re-seal after any set (no-op for legacy runs)
  })
  _tryRefreshMap(process.env.CLAUDE_PROJECT_DIR || process.cwd())
  process.stdout.write(`${id} updated: ${updated.join(' ')}\n`)
}

function cmdShow(id) {
  if (!id) die('usage: ledger show <id>', 2)
  const l = readLedger(ledgerPath())
  if (!l) die('no ledger at ' + ledgerPath(), 1)
  warnValidate(l)
  const slices = Array.isArray(l.slices) ? l.slices : []
  const s = slices.find((s) => s?.id === id)
  if (!s) die(`unknown slice id "${id}"`, 2)
  const acceptance = Array.isArray(s.acceptance) && s.acceptance.length
    ? s.acceptance.map((a, i) => `    [${i + 1}] ${a}`).join('\n')
    : '    (none)'
  const blocked = Array.isArray(s.blocked_by) && s.blocked_by.length
    ? s.blocked_by.join(', ')
    : '(none)'
  const kindDisplay = s.kind != null ? s.kind : 'impl (default)'
  const coversAc = Array.isArray(s.covers_ac) && s.covers_ac.length
    ? s.covers_ac.join(', ')
    : typeof s.covers_ac === 'string' && s.covers_ac
      ? s.covers_ac
      : '(none)'
  const claimedBy = s.claimed_by || '(none)'
  const createdBy = s.created_by || '(none)'
  const ticket = s.ticket || '(none)'
  const decisions = Array.isArray(s.decisions) && s.decisions.length
    ? s.decisions.join(', ')
    : typeof s.decisions === 'string' && s.decisions
      ? s.decisions
      : '(none)'
  process.stdout.write(
    [
      `id:         ${s.id}`,
      `kind:       ${kindDisplay}`,
      `wave:       ${s.wave ?? 0}`,
      `status:     ${s.status ?? 'pending'}`,
      `desc:       ${s.desc || '(none)'}`,
      `ticket:     ${ticket}`,
      `blocked_by: ${blocked}`,
      `covers_ac:  ${coversAc}`,
      `decisions:  ${decisions}`,
      `claimed_by: ${claimedBy}`,
      `created_by: ${createdBy}`,
      `acceptance:`,
      acceptance,
    ].join('\n') + '\n',
  )
}

// ---------------------------------------------------------------------------
// CLAIM — concurrent-session slice ownership
// ---------------------------------------------------------------------------

function cmdClaim(args) {
  // Extract boolean flags before parseFlags (which treats every --flag as having a value)
  const jsonMode = args.includes('--json')
  const strictMode = args.includes('--strict')
  const filteredArgs = args.filter((a) => a !== '--json' && a !== '--strict')

  const { flags, positionals: ids } = parseFlags(filteredArgs)
  if (!ids.length) die('usage: ledger claim <id> [<id> ...] [--json] [--strict]', 2)
  const currentSession = resolveSessionId(flags)
  if (!currentSession) die('claim requires a session id — set CLAUDE_CODE_SESSION_ID or pass --session <id>', 1)

  const refused = /** @type {{id: string, claimed_by: string}[]} */ ([])
  const claimed = []

  mutateLedgerChecked(ledgerPath(), (l) => {
    if (!l) throw new Error('no ledger to update')
    const slices = Array.isArray(l.slices) ? l.slices : []
    const byId = new Map(slices.map((s) => [s?.id, s]))
    const missing = ids.filter((id) => !byId.has(id))
    if (missing.length) {
      const e = new Error(`unknown slice id(s): ${missing.join(', ')}`)
      e.exitCode = 2
      throw e
    }
    // Pacing enforcement (D-28): block claim when budget is exhausted.
    // --build-hash enables milestone artifact-freshness check at claim time (pure).
    const claimBuildHash = flags['build-hash'] ?? null
    // Check each slice; first blocked result aborts the whole operation.
    for (const id of ids) {
      const pace = checkPace(l, id, claimBuildHash)
      if (!pace.allowed) {
        const e = new Error(`${pace.reason}\n${pace.remedy}`)
        e.exitCode = 1
        throw e
      }
    }
    const now = new Date().toISOString()
    for (const id of ids) {
      const s = byId.get(id)
      const existingOwner = s.claimed_by
      if (!existingOwner || existingOwner === currentSession) {
        // Unclaimed, or same session reclaiming (idempotent) — set/refresh
        s.claimed_by = currentSession
        s.claimed_at = now
        claimed.push(id)
      } else {
        // Different session holds the claim.
        // Allow reclaim only if the ledger is inactive (stale run).
        if (l.active === false) {
          s.claimed_by = currentSession
          s.claimed_at = now
          claimed.push(id)
        } else {
          refused.push({ id, claimed_by: existingOwner })
        }
      }
    }
  })

  if (claimed.length) _tryRefreshMap(process.env.CLAUDE_PROJECT_DIR || process.cwd())
  if (jsonMode) {
    const ok = refused.length === 0
    process.stdout.write(JSON.stringify({ claimed, refused, ok }) + '\n')
    if (strictMode && !ok) process.exit(1)
  } else {
    // Default text output — byte-identical to previous behaviour
    for (const r of refused) {
      process.stderr.write(`ledger: ${r.id} already claimed by ${r.claimed_by} — skipping\n`)
    }
    if (claimed.length) process.stdout.write(`claimed: ${claimed.join(', ')} [session: ${currentSession}]\n`)
    if (strictMode && refused.length > 0) process.exit(1)
  }
}

// ---------------------------------------------------------------------------
// VIEW — human-readable markdown kanban
// ---------------------------------------------------------------------------

function cmdView() {
  const l = readLedger(ledgerPath())
  if (!l) die('no ledger at ' + ledgerPath(), 1)
  warnValidate(l)
  const slices = Array.isArray(l.slices) ? l.slices : []
  const lines = []

  lines.push(`# Groundwork Run`)
  lines.push(``)
  lines.push(`**Brief:** ${l.brief ?? '(no brief)'}`)
  lines.push(`**Active:** ${l.active === false ? 'no (abandoned)' : 'yes'}`)
  lines.push(`**Session:** ${l.session_id ?? '(none)'}`)
  // NOTE: write_token is intentionally omitted here
  lines.push(``)

  // Group slices by wave
  const byWave = new Map()
  for (const s of slices) {
    const w = s?.wave ?? 0
    if (!byWave.has(w)) byWave.set(w, [])
    byWave.get(w).push(s)
  }
  const waves = [...byWave.keys()].sort((a, b) => a - b)

  for (const w of waves) {
    lines.push(`## Wave ${w}`)
    lines.push(``)
    lines.push(`| ID | Kind | Status | Blocked By | Claimed By | Decisions | Description |`)
    lines.push(`|---|---|---|---|---|---|---|`)
    for (const s of byWave.get(w)) {
      const id = s?.id ?? '?'
      const status = s?.status ?? 'pending'
      const sym = SYMBOL[status] ?? status
      const blocked = Array.isArray(s?.blocked_by) && s.blocked_by.length ? s.blocked_by.join(', ') : '—'
      const desc = (s?.desc || '').replace(/\|/g, '\\|')
      const kindRaw = s?.kind ?? null
      const kindCol = kindRaw != null ? (KIND_LABEL[kindRaw] ?? kindRaw) : '⚙ impl'
      const claimedBy = s?.claimed_by ?? '—'
      const decisionsArr = Array.isArray(s?.decisions) ? s.decisions : (typeof s?.decisions === 'string' && s.decisions ? [s.decisions] : [])
      const decisionsCol = decisionsArr.length ? decisionsArr.join(', ') : '—'
      lines.push(`| \`${id}\` | ${kindCol} | ${sym} ${status} | ${blocked} | ${claimedBy} | ${decisionsCol} | ${desc} |`)
    }
    lines.push(``)
  }

  // Gate section
  const gate = l.gate ?? {}
  lines.push(`## Gate`)
  lines.push(``)
  const advisorVal = gate.advisor
  let advisorStr
  if (typeof advisorVal === 'string') advisorStr = advisorVal
  else if (advisorVal && typeof advisorVal === 'object') {
    advisorStr = advisorVal.verdict ?? 'pending'
    if (advisorVal.rubric) advisorStr += ` — ${advisorVal.rubric}`
  } else {
    advisorStr = 'pending'
  }
  lines.push(`| Gate | Verdict |`)
  lines.push(`|---|---|`)
  lines.push(`| advisor | ${advisorStr} |`)
  if (gate.verifier != null) lines.push(`| verifier | ${gate.verifier} |`)
  if (gate.qa != null) lines.push(`| qa | ${gate.qa} |`)
  lines.push(``)

  const done = slices.filter((s) => s?.status === 'complete').length
  lines.push(`**Progress:** ${done}/${slices.length} slices complete`)
  lines.push(``)

  process.stdout.write(lines.join('\n') + '\n')
}

// ---------------------------------------------------------------------------
// FRONTIER — slices a session can start right now
// ---------------------------------------------------------------------------

function cmdFog(args) {
  const { flags, positionals } = parseFlags(args)
  const id = positionals[0]
  if (!id) die('usage: ledger fog <id> --desc "…" --question "…"', 2)
  if (!flags.desc) die('ledger fog: --desc is required', 2)
  if (!flags.question) die('ledger fog: --question is required', 2)

  mutateLedgerChecked(ledgerPath(), (l) => {
    if (!l) throw new Error('no ledger to update')
    const slices = Array.isArray(l.slices) ? l.slices : []
    if (slices.some((s) => s?.id === id)) throw Object.assign(new Error(`slice "${id}" already exists`), { exitCode: 2 })
    const item = {
      id,
      status: 'pending',
      wave: flags.wave != null ? Number(flags.wave) : 0,
      kind: 'fog',
      desc: flags.desc,
      question: flags.question,
      // acceptance intentionally omitted: fog slices have no acceptance criteria
    }
    slices.push(item)
    l.slices = slices
    return l
  })
  process.stdout.write(`${id} added (fog)\n`)
}

function cmdFrontier(args) {
  const { flags } = parseFlags(args)
  const currentSession = resolveSessionId(flags)

  const l = readLedger(ledgerPath())
  if (!l) die('no ledger at ' + ledgerPath(), 1)
  warnValidate(l)

  const slices = Array.isArray(l.slices) ? l.slices : []

  // Delegate pure predicate to dagFrontier; add session-specific claimed_by filter here.
  const frontier = dagFrontier(slices).filter((s) => {
    // Unclaimed, or claimed by the current session
    return !s.claimed_by || s.claimed_by === currentSession
  })

  if (!frontier.length) {
    process.stdout.write('no frontier slices — all pending slices are blocked, in progress, or claimed by another session\n')
    return
  }

  for (const s of frontier) {
    const wave = s.wave != null ? `w${s.wave}` : 'w0'
    const desc = s.desc ? `  ${s.desc.slice(0, 60)}${s.desc.length > 60 ? '…' : ''}` : ''
    const claim = s.claimed_by ? ` [claimed:${s.claimed_by}]` : ''
    process.stdout.write(`${s.id}  ${wave}${claim}${desc}\n`)
  }
}

// ---------------------------------------------------------------------------
// AUTOPILOT — extend pacing budget by N units (D-28)
// ---------------------------------------------------------------------------

function cmdAutopilot(args) {
  const { flags } = parseFlags(args)
  if (flags.range == null) die('usage: ledger autopilot --range N --token <t> [--reason "..."]', 2)
  const range = Number(flags.range)
  if (!Number.isInteger(range) || range < 1) die('--range must be a positive integer (≥1)', 2)
  const reason = flags.reason ?? ''
  if (!reason.trim()) die('--reason is required and must be non-empty (e.g. --reason "operator authorized: multi-wave emergency")', 1)

  let capturedLedger = null
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  mutateLedgerChecked(ledgerPath(), (l) => {
    if (!l) throw new Error('no ledger to update')
    assertWriteToken(l, flags.token)
    capturedLedger = l
    if (!l.pacing) {
      const e = new Error('ledger has no pacing field — autopilot only applies to paced runs')
      e.exitCode = 1
      throw e
    }
    l.pacing.grant = {
      range: (l.pacing.grant?.range ?? 0) + range,
      granted_at: new Date().toISOString(),
      granted_by: resolveSessionId(flags) ?? process.env.CLAUDE_CODE_SESSION_ID ?? 'orchestrator',
      reason,
    }
    reSeal(l, projectDir)  // S2-AC5: re-seal after autopilot grant (no-op for legacy runs)
  })
  if (capturedLedger) {
    emitHookEvent({
      projectDir,
      sessionId: capturedLedger.session_id,
      type: 'MILESTONE',
      source: 'hook:ledger',
      data: { event: 'autopilot', range, reason },
      ledger: capturedLedger,
    })
  }
  process.stdout.write(`autopilot granted: +${range} unit${range === 1 ? '' : 's'}${reason ? ` (${reason})` : ''}\n`)
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2)
  const [cmd, ...rest] = argv

  // no-args and explicit help flags → global help, exit 0
  if (!cmd || cmd === '-h' || cmd === '--help') { cmdHelp([]); return }
  if (cmd === 'help') { cmdHelp(rest); return }

  // per-command --help
  const { flags } = parseFlags(rest)
  if ('help' in flags) { cmdHelp([cmd]); return }

  // Resolve the ledger path once (honors --session flag and CLAUDE_CODE_SESSION_ID env)
  const base = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  const sessionId = resolveSessionId(flags)
  _ledgerPath = resolveLedgerPath({ projectDir: base, sessionId })

  try {
    switch (cmd) {
      case 'status':   return cmdStatus()
      case 'complete': return cmdComplete(rest)
      case 'gate':     return cmdGate(rest)
      case 'abandon':  return cmdAbandon(rest)
      case 'init':     return cmdInit(rest)
      case 'add':      return cmdAdd(rest)
      case 'rm':       return cmdRm(rest)
      case 'set':      return cmdSet(rest)
      case 'claim':    return cmdClaim(rest)
      case 'show':     return cmdShow(rest[0])
      case 'view':     return cmdView()
      case 'fog':      return cmdFog(rest)
      case 'frontier': return cmdFrontier(rest)
      case 'autopilot': return cmdAutopilot(rest)
      case 'scope-token': return cmdScopeToken(rest)
      case 'await-human': return cmdAwaitHuman(rest)
      case 'milestone-signoff': return cmdMilestoneSignoff(rest)
      default:
        die(`unknown command "${cmd}". Run ledger help for a list.`, 2)
    }
  } catch (e) {
    die(e?.message ?? String(e), e?.exitCode ?? 1)
  }
}

main()
