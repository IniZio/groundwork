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
 *   ledger.mjs add <id> [--wave N] [--desc "…"] [--blocked-by a,b] [--acceptance "a;b"] [--status pending] [--feature-slug <s>]
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
import { emitHookEvent } from './lib/journal-io.mjs'
import { parseFrontmatter as parseRfcFrontmatter, readRfcFrontmatter, readTasksSidecar } from './lib/rfc-io.mjs'
import { loadSchema, ajvErrorsToLines } from './lib/schema-io.mjs'

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

function die(msg, code = 1) {
  process.stderr.write(`ledger: ${msg}\n`)
  process.exit(code)
}

/** Pull `--flag value` pairs out of argv; returns { flags, positionals }. */
function parseFlags(args) {
  const flags = {}
  const positionals = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith('--')) {
      flags[a.slice(2)] = args[i + 1]
      i++
    } else {
      positionals.push(a)
    }
  }
  return { flags, positionals }
}

const SYMBOL = { complete: '✓', in_progress: '⋯', pending: '·' }
const VALID_STATUSES = new Set(['pending', 'in_progress', 'complete', 'skipped'])
const VALID_KINDS = new Set(['plan', 'diagnose', 'design', 'impl'])
const KIND_LABEL = { plan: '📋 plan', diagnose: '🔍 diagnose', design: '🎨 design', impl: '⚙ impl' }

/** Validate a kind string, die(exit 2) if invalid. */
function assertKind(val) {
  if (!VALID_KINDS.has(val)) die(`invalid kind "${val}". Must be: plan | diagnose | design | impl`, 2)
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
])

/**
 * Known keys in tasks.yaml task entries. Near-miss typos in these keys are
 * caught at parse time (hard error, exit 1) so they never reach the slice
 * reconstructor where they would be silently dropped.
 *
 * Includes both the canonical ledger-side names AND the tasks.yaml sidecar
 * format aliases used by vertical-slice: title (alias for desc), ac (alias
 * for acceptance), files (informational, not mapped to a slice field).
 */
const KNOWN_TASK_KEYS = new Set([
  'id', 'wave', 'kind',
  'blocked_by', 'depends_on', // depends_on = legacy alias
  'desc', 'behavior',          // desc preferred; behavior = legacy
  'title',                     // tasks.yaml sidecar alias for desc
  'acceptance',
  'ac',                        // tasks.yaml sidecar alias for acceptance
  'files',                     // informational; not mapped to a slice field
  'name',
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
 * Enforce write-token authority for gate/complete.
 * FAIL-OPEN: if the ledger has no write_token field, proceeds without requiring a token.
 * FAIL-CLOSED: if the ledger has a write_token AND --token is missing or wrong → throws
 * (caller is always inside mutateLedger which has a finally-cleanup for the lockfile;
 * we must throw rather than call die/process.exit to avoid bypassing that cleanup).
 */
function assertWriteToken(ledger, passedToken) {
  const stored = ledger?.write_token
  if (!stored) return // no token in ledger → legacy/back-compat, proceed
  if (!passedToken || passedToken !== stored) {
    const e = new Error(
      'gate/complete are orchestrator-only — pass --token <write_token> printed at init\n' +
      '  (run `ledger status` to check run state; the token itself is never displayed)',
    )
    e.exitCode = 1
    throw e
  }
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
      '--token <t>          write-token printed at init (required if ledger has write_token)',
    ],
  },
  gate: {
    summary: 'set a gate verdict (advisor | verifier | qa)',
    usage: 'ledger gate <advisor|verifier|qa> <verdict> [flags]',
    flags: [
      '--token <t>          write-token printed at init (required if ledger has write_token)',
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
    usage: 'ledger abandon',
    flags: [],
  },
  init: {
    summary: 'write the initial ledger atomically from a JSON file or stdin; or seed from an RFC',
    usage: 'ledger init [<file|->] [--rfc <dir>]',
    flags: [
      '--rfc <dir>   path to an RFC directory; seeds slices from frontmatter tasks[] and sets rfc_ref',
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
      '--feature-slug <s>  (optional) link run to .groundwork/features/<slug>/',
      '--claimed-by <sid>  (optional) set claimed_by on the new slice',
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
  mutateLedgerChecked(ledgerPath(), (l) => {
    if (!l) throw new Error('no ledger to update')
    assertWriteToken(l, flags.token)
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
  })
  // Emit one TASK_COMPLETE per found-and-marked id; must precede die() so partial
  // successes (e.g. "ledger complete S1 BOGUS") are still recorded (AC8).
  if (capturedLedger) {
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()
    for (const id of ids.filter((id) => !missing.includes(id))) {
      emitHookEvent({
        projectDir,
        sessionId: capturedLedger.session_id,
        type: 'TASK_COMPLETE',
        source: 'hook:ledger',
        data: { slice: id },
        ledger: capturedLedger,
      })
    }
  }
  if (missing.length) die(`unknown slice id(s): ${missing.join(', ')}`, 2)
  process.stdout.write(`${ids.join(', ')} ✓ (${done}/${total} complete)\n`)
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
  mutateLedgerChecked(ledgerPath(), (l) => {
    if (!l) throw new Error('no ledger to update')
    assertWriteToken(l, flags.token)
    capturedLedger = l
    l.gate = l.gate ?? {}
    l.gate[which] = value
    runId = l.session_id ?? l.run_id ?? null
  })
  // Write gate artifact
  writeGateArtifact({ runId, which, verdictRaw, value, hasObj, flags })
  if (capturedLedger) {
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()
    emitHookEvent({
      projectDir,
      sessionId: capturedLedger.session_id,
      type: 'GATE',
      source: 'hook:ledger',
      data: { which, verdict: verdictRaw, ...(flags.citation ? { citation: flags.citation } : {}), ...(flags.rubric ? { rubric: flags.rubric } : {}) },
      ledger: capturedLedger,
    })
  }
  process.stdout.write(`${which}: ${hasObj ? value.verdict : value}\n`)
}

/** Write .groundwork/gates/<run-id>.md with a machine-parseable header + human body. */
function writeGateArtifact({ runId, which, verdictRaw, value, hasObj, flags }) {
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

function cmdAbandon() {
  let capturedLedger = null
  mutateLedgerChecked(ledgerPath(), (l) => {
    if (!l) throw new Error('no ledger to abandon')
    capturedLedger = l
    l.active = false
  })
  if (capturedLedger) {
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()
    emitHookEvent({
      projectDir,
      sessionId: capturedLedger.session_id,
      type: 'SESSION_END',
      source: 'hook:ledger',
      data: { outcome: 'abandoned' },
      ledger: capturedLedger,
    })
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
  const rfcDir = flags.rfc

  if (!src && !rfcDir) die('usage: ledger init <file|-> [--rfc <dir>]', 2)

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

  // AC1: --rfc <dir> seeds slices from RFC frontmatter tasks[] and sets rfc_ref.
  if (rfcDir) {
    let rfcFrontmatter
    try {
      const parsed = readRfcFrontmatter(rfcDir)
      rfcFrontmatter = parsed.frontmatter
    } catch (e) {
      die(`cannot read RFC from ${rfcDir}: ${e?.message ?? e}`, 1)
    }
    const uid = rfcFrontmatter.uid
    if (!uid) die(`RFC at ${rfcDir} has no uid in frontmatter`, 1)
    obj.rfc_ref = uid
    // Prefer tasks.yaml sidecar; fall back to frontmatter.tasks for legacy schema:1 RFCs.
    // Seeding a run with zero slices defeats the Stop-gate (zero slices are trivially
    // all-complete), so we treat neither-source-present as a hard error.
    const hasSidecar = existsSync(path.join(rfcDir, 'tasks.yaml'))
    const tasks = hasSidecar
      ? readTasksSidecar(rfcDir)
      : (Array.isArray(rfcFrontmatter.tasks) ? rfcFrontmatter.tasks : [])
    if (tasks.length === 0) die(`RFC at ${rfcDir} has no tasks — cannot seed a ledger with zero slices (check tasks.yaml or frontmatter tasks[])`, 1)
    // Validate tasks.yaml keys at parse time, before reconstruction, so that
    // a typo'd key (e.g. blocked_bY) is caught rather than silently dropped.
    // A near-miss (edit distance ≤ 2) is a hard error (the intent is clear but
    // the key would be silently lost, which corrupts dependency ordering).
    // A completely-unrecognised key emits a warning (might be supplementary metadata).
    for (const t of tasks) {
      if (!t || typeof t !== 'object') continue
      const tid = t.id ?? '?'
      for (const key of Object.keys(t)) {
        if (KNOWN_TASK_KEYS.has(key)) continue
        let best = null, bestDist = 3
        for (const known of KNOWN_TASK_KEYS) {
          const d = levenshtein(key, known)
          if (d < bestDist) { best = known; bestDist = d }
        }
        if (best !== null) {
          die(`tasks.yaml task "${tid}": unrecognised key "${key}" looks like a typo of "${best}" — fix the key or it will be silently dropped`, 1)
        } else {
          process.stderr.write(`ledger warn: tasks.yaml task "${tid}": unknown key "${key}" (not a known task field; will be ignored)\n`)
        }
      }
    }
    obj.slices = tasks.map((t) => ({
      id: String(t.id ?? ''),
      wave: Number.isFinite(Number(t.wave)) ? Number(t.wave) : 0,
      blocked_by: Array.isArray(t.blocked_by ?? t.depends_on) ? (t.blocked_by ?? t.depends_on).map(String) : [],
      ...(Array.isArray(t.acceptance ?? t.ac) && (t.acceptance ?? t.ac).length > 0 ? { acceptance: (t.acceptance ?? t.ac).map(String) } : {}),
      status: 'pending',
      desc: String(t.desc ?? t.behavior ?? t.title ?? ''),
      kind: String(t.kind ?? 'impl'),
    }))
  }

  // Generate and embed the write-token for gate/complete authority
  const writeToken = randomBytes(8).toString('hex')
  obj.write_token = writeToken
  // Ensure required field `active` is present (schema requires it; cmdInit always starts active).
  if (!('active' in obj)) obj.active = true
  // Stamp session_id: prefer env, then input, then generate a stable opaque id so the
  // required schema field is always satisfied even in test/offline contexts.
  const sessionId = resolveSessionId(null)
  if (!obj.session_id) obj.session_id = sessionId ?? randomBytes(16).toString('hex')
  // Validate before writing — strict: schema violations are hard errors at init
  // time because there is no excuse for persisting corruption in a fresh ledger.
  checkLedgerStrict(obj)
  // Best-effort prune stale per-session ledgers before writing
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  try { pruneStaleSessionLedgers(projectDir) } catch { /* best-effort */ }
  atomicWriteJsonSync(ledgerPath(), obj)
  const n = Array.isArray(obj?.slices) ? obj.slices.length : 0
  process.stdout.write(`ledger initialized: ${n} slices → ${ledgerPath()}\n`)
  process.stdout.write(`write_token: ${writeToken}  (orchestrator: pass --token on gate/complete)\n`)
}

// ---------------------------------------------------------------------------
// SLICE CRUD
// ---------------------------------------------------------------------------

function cmdAdd(args) {
  const { flags, positionals } = parseFlags(args)
  const id = positionals[0]
  if (!id) die('usage: ledger add <id> [--wave N] [--desc "…"] [--kind <k>] [--blocked-by a,b] [--acceptance "a;b"] [--status pending] [--feature-slug <s>]', 2)
  const status = flags.status ?? 'pending'
  assertStatus(status)
  if (flags.kind != null) assertKind(flags.kind)
  const wave = flags.wave != null ? Number(flags.wave) : 0
  const desc = flags.desc ?? ''
  const blocked_by = flags['blocked-by'] ? flags['blocked-by'].split(',').map((s) => s.trim()).filter(Boolean) : []
  const acceptance = flags.acceptance ? flags.acceptance.split(';').map((s) => s.trim()).filter(Boolean) : []

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
    if (flags['claimed-by'] != null) {
      item.claimed_by = flags['claimed-by']
      item.claimed_at = new Date().toISOString()
    }
    ledger.slices.push(item)
    // Optional top-level link to a durable feature ledger (Contract B.1 / R4).
    // Mirrors plan_ref/brief: set on the run object, not on the slice.
    if (flags['feature-slug'] != null) ledger.feature_slug = flags['feature-slug']
    return l === null ? ledger : undefined // return new object only if we created it
  })
  const kindNote = flags.kind != null ? `, kind=${flags.kind}` : ''
  const slugNote = flags['feature-slug'] != null ? `, feature_slug=${flags['feature-slug']}` : ''
  process.stdout.write(`${id} added (wave ${wave}, ${status}${kindNote}${slugNote})\n`)
}

function cmdRm(ids) {
  if (!ids.length) die('usage: ledger rm <id> [<id> ...]', 2)
  let remaining = 0
  const missing = []
  mutateLedgerChecked(ledgerPath(), (l) => {
    if (!l) throw new Error('no ledger to update')
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
  })
  process.stdout.write(`removed: ${ids.join(', ')} (${remaining} slice${remaining === 1 ? '' : 's'} remain)\n`)
}

function cmdSet(args) {
  const { flags, positionals } = parseFlags(args)
  const id = positionals[0]
  if (!id) die('usage: ledger set <id> [--status …] [--wave N] [--desc "…"] [--blocked-by a,b] [--acceptance "a;b"]', 2)
  const hasFields = ['status', 'wave', 'desc', 'blocked-by', 'acceptance', 'claimed-by'].some((k) => flags[k] != null)
  if (!hasFields) die('ledger set: no fields provided. Specify at least one of --status --wave --desc --blocked-by --acceptance --claimed-by', 2)
  if (flags.status != null) assertStatus(flags.status)

  const updated = []
  mutateLedgerChecked(ledgerPath(), (l) => {
    if (!l) throw new Error('no ledger to update')
    const slices = Array.isArray(l.slices) ? l.slices : []
    const s = slices.find((s) => s?.id === id)
    if (!s) {
      const e = new Error(`unknown slice id "${id}"`)
      e.exitCode = 2
      throw e
    }
    if (flags.status != null) {
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
  })
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
  process.stdout.write(
    [
      `id:         ${s.id}`,
      `kind:       ${kindDisplay}`,
      `wave:       ${s.wave ?? 0}`,
      `status:     ${s.status ?? 'pending'}`,
      `desc:       ${s.desc || '(none)'}`,
      `blocked_by: ${blocked}`,
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
    lines.push(`| ID | Kind | Status | Blocked By | Claimed By | Description |`)
    lines.push(`|---|---|---|---|---|---|`)
    for (const s of byWave.get(w)) {
      const id = s?.id ?? '?'
      const status = s?.status ?? 'pending'
      const sym = SYMBOL[status] ?? status
      const blocked = Array.isArray(s?.blocked_by) && s.blocked_by.length ? s.blocked_by.join(', ') : '—'
      const desc = (s?.desc || '').replace(/\|/g, '\\|')
      const kindRaw = s?.kind ?? null
      const kindCol = kindRaw != null ? (KIND_LABEL[kindRaw] ?? kindRaw) : '⚙ impl'
      const claimedBy = s?.claimed_by ?? '—'
      lines.push(`| \`${id}\` | ${kindCol} | ${sym} ${status} | ${blocked} | ${claimedBy} | ${desc} |`)
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
      case 'abandon':  return cmdAbandon()
      case 'init':     return cmdInit(rest)
      case 'add':      return cmdAdd(rest)
      case 'rm':       return cmdRm(rest)
      case 'set':      return cmdSet(rest)
      case 'claim':    return cmdClaim(rest)
      case 'show':     return cmdShow(rest[0])
      case 'view':     return cmdView()
      default:
        die(`unknown command "${cmd}". Run ledger help for a list.`, 2)
    }
  } catch (e) {
    die(e?.message ?? String(e), e?.exitCode ?? 1)
  }
}

main()
