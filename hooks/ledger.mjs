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
 *               // advisor verdicts: APPROVE | REVISE | REJECT | REPLAN (bare string or {verdict})
 *   ledger.mjs abandon                          set active:false (releases the gate)
 *   ledger.mjs init <file|->                    write the initial ledger atomically
 *   ledger.mjs add <id> [--wave N] [--desc "…"] [--blocked-by a,b] [--acceptance "a;b"] [--status pending] [--feature-slug <s>]
 *   ledger.mjs rm <id> [<id> …]                 remove slice(s)
 *   ledger.mjs set <id> [--status …] [--wave N] [--desc "…"] [--blocked-by a,b] [--acceptance "a;b"]
 *   ledger.mjs show <id>                        print all fields of one slice
 *
 * All writes are atomic and lock-serialized with the stop-gate hook (lib/ledger-io.mjs).
 * Exit 0 on success, 2 on usage error, 1 on operational failure.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { mutateLedger, readLedger, atomicWriteJsonSync, resolveLedgerPath, pruneStaleSessionLedgers } from './lib/ledger-io.mjs'

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
    summary: 'write the initial ledger atomically from a JSON file or stdin',
    usage: 'ledger init <file|->',
    flags: [],
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
  const slices = Array.isArray(l.slices) ? l.slices : []
  const done = slices.filter((s) => s?.status === 'complete').length
  const head = `run: ${l.brief ?? '(no brief)'}${l.active === false ? '  [ABANDONED]' : ''}`
  const rows = slices.map((s) => {
    const sym = SYMBOL[s?.status] ?? `?${s?.status ?? ''}`
    const dep = Array.isArray(s?.blocked_by) && s.blocked_by.length ? ` ⟵${s.blocked_by.join(',')}` : ''
    const wave = s?.wave != null ? `w${s.wave}` : ''
    return `${s?.id ?? '?'}${sym}${wave ? ' ' + wave : ''}${dep}`
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
  mutateLedger(ledgerPath(), (l) => {
    if (!l) throw new Error('no ledger to update')
    assertWriteToken(l, flags.token)
    const slices = Array.isArray(l.slices) ? l.slices : []
    const byId = new Map(slices.map((s) => [s?.id, s]))
    for (const id of ids) {
      const s = byId.get(id)
      if (!s) missing.push(id)
      else s.status = 'complete'
    }
    total = slices.length
    done = slices.filter((s) => s?.status === 'complete').length
  })
  if (missing.length) die(`unknown slice id(s): ${missing.join(', ')}`, 2)
  process.stdout.write(`${ids.join(', ')} ✓ (${done}/${total} complete)\n`)
}

function cmdGate(args) {
  const { flags, positionals } = parseFlags(args)
  const [which, verdictRaw] = positionals
  if (!which || !verdictRaw) die('usage: ledger gate <advisor|verifier|qa> <verdict> [--token <t>] [--citation .. --rubric ..]', 2)
  if (!['advisor', 'verifier', 'qa'].includes(which)) die(`unknown gate "${which}"`, 2)
  // Advisor verdicts accepted as bare string or object: APPROVE | REVISE | REJECT | REPLAN
  // (REPLAN is non-terminal — stop-gate routes back to interview/vertical-slice).
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
  mutateLedger(ledgerPath(), (l) => {
    if (!l) throw new Error('no ledger to update')
    assertWriteToken(l, flags.token)
    l.gate = l.gate ?? {}
    l.gate[which] = value
    runId = l.session_id ?? l.run_id ?? null
  })
  // Write gate artifact
  writeGateArtifact({ runId, which, verdictRaw, value, hasObj, flags })
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
  mutateLedger(ledgerPath(), (l) => {
    if (!l) throw new Error('no ledger to abandon')
    l.active = false
  })
  process.stdout.write('run cancelled (active:false) — gate released\n')
}

function cmdInit(src) {
  if (!src) die('usage: ledger init <file|->', 2)
  let raw
  try {
    raw = src === '-' ? readFileSync(0, 'utf8') : readFileSync(src, 'utf8')
  } catch (e) {
    die(`cannot read initial ledger from ${src}: ${e?.message ?? e}`, 1)
  }
  let obj
  try {
    obj = JSON.parse(raw)
  } catch (e) {
    die(`initial ledger is not valid JSON: ${e?.message ?? e}`, 2)
  }
  // Generate and embed the write-token for gate/complete authority
  const writeToken = randomBytes(8).toString('hex')
  obj.write_token = writeToken
  // Stamp session_id if not already present and a sessionId is known
  const sessionId = resolveSessionId(null)
  if (sessionId && !obj.session_id) obj.session_id = sessionId
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

  mutateLedger(ledgerPath(), (l) => {
    // Create a minimal ledger skeleton if none exists yet
    const ledger = l ?? { active: true, brief: '', slices: [], gate: {} }
    ledger.slices = Array.isArray(ledger.slices) ? ledger.slices : []
    if (ledger.slices.some((s) => s?.id === id)) {
      // signal dup — throw so we can die(exit 2) after; we catch specially below
      const e = new Error(`slice "${id}" already exists`)
      e.exitCode = 2
      throw e
    }
    const item = { id, wave, status, desc, blocked_by, acceptance }
    if (flags.kind != null) item.kind = flags.kind
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
  mutateLedger(ledgerPath(), (l) => {
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
  const hasFields = ['status', 'wave', 'desc', 'blocked-by', 'acceptance'].some((k) => flags[k] != null)
  if (!hasFields) die('ledger set: no fields provided. Specify at least one of --status --wave --desc --blocked-by --acceptance', 2)
  if (flags.status != null) assertStatus(flags.status)

  const updated = []
  mutateLedger(ledgerPath(), (l) => {
    if (!l) throw new Error('no ledger to update')
    const slices = Array.isArray(l.slices) ? l.slices : []
    const s = slices.find((s) => s?.id === id)
    if (!s) {
      const e = new Error(`unknown slice id "${id}"`)
      e.exitCode = 2
      throw e
    }
    if (flags.status != null) { s.status = flags.status; updated.push(`status=${flags.status}`) }
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
  })
  process.stdout.write(`${id} updated: ${updated.join(' ')}\n`)
}

function cmdShow(id) {
  if (!id) die('usage: ledger show <id>', 2)
  const l = readLedger(ledgerPath())
  if (!l) die('no ledger at ' + ledgerPath(), 1)
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
// VIEW — human-readable markdown kanban
// ---------------------------------------------------------------------------

function cmdView() {
  const l = readLedger(ledgerPath())
  if (!l) die('no ledger at ' + ledgerPath(), 1)
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
    lines.push(`| ID | Kind | Status | Blocked By | Description |`)
    lines.push(`|---|---|---|---|---|`)
    for (const s of byWave.get(w)) {
      const id = s?.id ?? '?'
      const status = s?.status ?? 'pending'
      const sym = SYMBOL[status] ?? status
      const blocked = Array.isArray(s?.blocked_by) && s.blocked_by.length ? s.blocked_by.join(', ') : '—'
      const desc = (s?.desc || '').replace(/\|/g, '\\|')
      const kindRaw = s?.kind ?? null
      const kindCol = kindRaw != null ? (KIND_LABEL[kindRaw] ?? kindRaw) : '⚙ impl'
      lines.push(`| \`${id}\` | ${kindCol} | ${sym} ${status} | ${blocked} | ${desc} |`)
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
      case 'init':     return cmdInit(rest[0])
      case 'add':      return cmdAdd(rest)
      case 'rm':       return cmdRm(rest)
      case 'set':      return cmdSet(rest)
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
