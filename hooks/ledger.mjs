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
 *   ledger.mjs status                       compact one-line-per-slice view
 *   ledger.mjs complete S3 [S4 ...]         mark slice(s) complete
 *   ledger.mjs gate critic passed           set gate.critic
 *   ledger.mjs gate advisor APPROVE [--citation "x" --rubric "y" \
 *               --axes-correctness 3 --axes-completeness 3 --axes-over_engineering 0]
 *   ledger.mjs abandon                      set active:false (releases the gate)
 *   ledger.mjs init <file|->                 write the initial ledger atomically
 *
 * All writes are atomic and lock-serialized with the stop-gate hook (lib/ledger-io.mjs).
 * Exit 0 on success, 2 on usage error, 1 on operational failure.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { mutateLedger, readLedger, atomicWriteJsonSync } from './lib/ledger-io.mjs'

function ledgerPath() {
  const base = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  return path.join(base, '.groundwork', 'run.json')
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

function advisorVerdict(gate) {
  const a = gate?.advisor
  if (typeof a === 'string') return a
  if (a && typeof a === 'object' && a.verdict != null) return String(a.verdict)
  return 'pending'
}

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
      `gate: critic=${gate.critic ?? 'pending'} advisor=${advisorVerdict(gate)}\n` +
      `${done}/${slices.length} slices complete\n`,
  )
}

function cmdComplete(ids) {
  if (!ids.length) die('usage: ledger complete <id> [<id> ...]', 2)
  let done = 0
  let total = 0
  const missing = []
  mutateLedger(ledgerPath(), (l) => {
    if (!l) throw new Error('no ledger to update')
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
  if (!which || !verdictRaw) die('usage: ledger gate <critic|advisor|verifier|qa> <verdict> [--citation .. --rubric ..]', 2)
  if (!['critic', 'advisor', 'verifier', 'qa'].includes(which)) die(`unknown gate "${which}"`, 2)
  const hasObj = which === 'advisor' && (flags.citation || flags.rubric || flags['axes-correctness'])
  let value
  if (hasObj) {
    value = { verdict: verdictRaw }
    if (flags.rubric) value.rubric = flags.rubric
    if (flags.citation) value.citation = flags.citation
    const axes = {}
    for (const k of ['correctness', 'completeness', 'over_engineering']) {
      if (flags[`axes-${k}`] != null) axes[k] = Number(flags[`axes-${k}`])
    }
    if (Object.keys(axes).length) value.axes = axes
  } else {
    value = verdictRaw
  }
  mutateLedger(ledgerPath(), (l) => {
    if (!l) throw new Error('no ledger to update')
    l.gate = l.gate ?? {}
    l.gate[which] = value
  })
  process.stdout.write(`${which}: ${hasObj ? value.verdict : value}\n`)
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
  atomicWriteJsonSync(ledgerPath(), obj)
  const n = Array.isArray(obj?.slices) ? obj.slices.length : 0
  process.stdout.write(`ledger initialized: ${n} slices → ${ledgerPath()}\n`)
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  try {
    switch (cmd) {
      case 'status':
        return cmdStatus()
      case 'complete':
        return cmdComplete(rest)
      case 'gate':
        return cmdGate(rest)
      case 'abandon':
        return cmdAbandon()
      case 'init':
        return cmdInit(rest[0])
      default:
        die(`unknown command "${cmd ?? ''}". Commands: status | complete | gate | abandon | init`, 2)
    }
  } catch (e) {
    die(e?.message ?? String(e), 1)
  }
}

main()
