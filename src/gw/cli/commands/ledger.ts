/**
 * ledger.ts — `gw ledger <subcommand>` — legacy JSON run store.
 *
 * Retargeted (T16) from the obsidian-native .groundwork/next/ store to the
 * legacy .groundwork/runs/<session_id>.json store — the same file and format
 * that hooks/ledger.mjs and bin/ledger read and write.  The two CLIs now
 * operate on the same run for the same session id.
 *
 * Path resolution mirrors resolveLedgerPath() in hooks/lib/ledger-io.mjs.
 * Auth mirrors enforceWriteTokenAuth() in hooks/ledger.mjs (direct
 * write_token comparison, not HMAC key-file).
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { type GwEnvelope, okEnvelope, errEnvelope } from '../envelope.js'

// ---------------------------------------------------------------------------
// Subcommand registry
// ---------------------------------------------------------------------------

export const LEDGER_SUBCOMMANDS = [
  'status',
  'add',
  'set',
  'complete',
  'rm',
  'show',
  'view',
  'gate',
  'abandon',
  'fog',
  'frontier',
  'claim',
  'await-human',
  'autopilot',
  'scope-token',
  'milestone-signoff',
] as const

type LedgerSubcmd = (typeof LEDGER_SUBCOMMANDS)[number]

function isLedgerSubcmd(s: string): s is LedgerSubcmd {
  return (LEDGER_SUBCOMMANDS as readonly string[]).includes(s)
}

// ---------------------------------------------------------------------------
// JSON ledger types
// ---------------------------------------------------------------------------

interface SliceJson {
  id: string
  wave?: number | null
  status: string
  kind?: string
  desc?: string
  blocked_by?: string[]
  acceptance?: string[]
  covers_ac?: string[]
  decisions?: string[]
  ticket?: string
  created_by?: string
  claimed_by?: string
  claimed_at?: string
  completed_at?: string
  session_id?: string
  question?: string
}

interface GateJson {
  advisor?: string | { verdict: string; rubric?: string; citation?: string }
  awaiting_human?: { reason: string; set_at: string } | null
  autopilot?: Array<{ units: number; reason: string; ts: string }>
  verifier?: string
  [key: string]: unknown
}

interface LedgerJson {
  active?: boolean
  session_id?: string
  motive?: string
  write_token?: string
  schema_version?: number
  slices?: SliceJson[]
  gate?: GateJson
  pacing?: Record<string, unknown>
  scoped_tokens?: Array<{ token: string; scope: string }>
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/

// ---------------------------------------------------------------------------
// Path resolution — mirrors resolveLedgerPath in hooks/lib/ledger-io.mjs
// ---------------------------------------------------------------------------

function resolveRunPath(projectDir: string, sessionId: string): string {
  const legacyPath = path.join(projectDir, '.groundwork', 'run.json')

  if (!SAFE_ID.test(sessionId)) return legacyPath

  const perSessionPath = path.join(projectDir, '.groundwork', 'runs', `${sessionId}.json`)

  if (existsSync(perSessionPath)) return perSessionPath

  if (existsSync(legacyPath)) {
    let legacy: LedgerJson | null = null
    try {
      legacy = JSON.parse(readFileSync(legacyPath, 'utf8')) as LedgerJson
    } catch {
      /* ignore */
    }
    const legacyOwner = legacy?.session_id
    if (!legacyOwner || legacyOwner === sessionId) return legacyPath
  }

  return perSessionPath
}

// ---------------------------------------------------------------------------
// Read / atomic write
// ---------------------------------------------------------------------------

function readLedger(runPath: string): LedgerJson | null {
  try {
    return JSON.parse(readFileSync(runPath, 'utf8')) as LedgerJson
  } catch {
    return null
  }
}

function atomicWrite(runPath: string, data: LedgerJson): void {
  const dir = path.dirname(runPath)
  mkdirSync(dir, { recursive: true })
  const tmp = `${runPath}.tmp.${randomBytes(4).toString('hex')}`
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8')
  renameSync(tmp, runPath)
}

/** Strip the legacy gate seal when rebuilding a gate object (seal is stale after mutation). */
function gateWithoutSeal(gate: GateJson): GateJson {
  return Object.fromEntries(Object.entries(gate).filter(([k]) => k !== 'seal')) as GateJson
}

// ---------------------------------------------------------------------------
// Flag parsing
// ---------------------------------------------------------------------------

function parseFlags(args: string[]): {
  flags: Record<string, string | true>
  positionals: string[]
} {
  const flags: Record<string, string | true> = {}
  const positionals: string[] = []
  let i = 0
  while (i < args.length) {
    const a = args[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        flags[key] = args[i + 1]
        i += 2
      } else {
        flags[key] = true
        i++
      }
    } else {
      positionals.push(a)
      i++
    }
  }
  return { flags, positionals }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function currentSession(): string | null {
  const id = process.env['CLAUDE_CODE_SESSION_ID']
  return id && id.length > 0 ? id : null
}

function symForStatus(status: string): string {
  switch (status) {
    case 'complete': return '✓'
    case 'in_progress': return '⋯'
    case 'pending': return '·'
    case 'skipped': return 's'
    default: return '?'
  }
}

function kindIcon(kind?: string): string {
  switch (kind) {
    case 'plan': return '📋'
    case 'diagnose': return '🔍'
    case 'design': return '🎨'
    case 'fog': return '🌫'
    default: return '⚙'
  }
}

function extractGateVerdict(gate: GateJson | undefined): string {
  if (!gate || !gate.advisor) return 'pending'
  if (typeof gate.advisor === 'string') return gate.advisor
  if (typeof gate.advisor === 'object' && 'verdict' in gate.advisor) {
    return gate.advisor.verdict
  }
  return 'pending'
}

// ---------------------------------------------------------------------------
// Auth — mirrors enforceWriteTokenAuth in hooks/ledger.mjs
// ---------------------------------------------------------------------------

function assertWriteToken(ledger: LedgerJson | null, passedToken: string | true | undefined): void {
  if (!passedToken || passedToken === true) {
    throw Object.assign(
      new Error(
        'gate/complete/abandon are orchestrator-only — pass --token <write_token> printed at init',
      ),
      { exitCode: 1 },
    )
  }
  const stored = ledger?.write_token
  if (!stored) {
    throw Object.assign(
      new Error(
        'gate/complete/abandon require write_token authority — this ledger has none.\n' +
        '  Re-initialize via `ledger init <file>` (embeds a token).',
      ),
      { exitCode: 1 },
    )
  }
  if (stored !== (passedToken as string)) {
    throw Object.assign(
      new Error(
        'gate/complete/abandon are orchestrator-only — pass --token <write_token> printed at init\n' +
        '  (run `ledger status` to check run state; the token itself is never displayed)',
      ),
      { exitCode: 1 },
    )
  }
}

/** Returns true if passedToken is a valid scoped token that owns all sliceIds. */
function checkScopedToken(
  ledger: LedgerJson | null,
  passedToken: string | true | undefined,
  sliceIds: string[],
  allSlices: SliceJson[],
): boolean {
  if (!passedToken || passedToken === true) return false
  const t = passedToken as string
  // Master token is not a scoped token
  if (ledger?.write_token && ledger.write_token === t) return false
  const scopedTokens = Array.isArray(ledger?.scoped_tokens) ? (ledger!.scoped_tokens ?? []) : []
  const match = scopedTokens.find(st => st?.token === t)
  if (!match) return false
  const scope = match.scope
  const sliceMap = new Map(allSlices.map(s => [s.id, s]))
  return sliceIds.every(id => sliceMap.get(id)?.created_by === scope)
}

function authErr(cmd: string, e: unknown): GwEnvelope {
  const err = e as { message?: string; exitCode?: number }
  return errEnvelope(cmd, 'AUTH_ERROR', err.message ?? 'auth error', (err.exitCode ?? 1) as 1 | 2)
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

export async function run(args: string[], cwd: string): Promise<GwEnvelope> {
  const subcmd = args[0]
  if (!subcmd) {
    return errEnvelope(
      'ledger',
      'USAGE_ERROR',
      `Usage: gw ledger <subcommand>\nSubcommands: ${LEDGER_SUBCOMMANDS.join(', ')}`,
      2,
    )
  }
  if (!isLedgerSubcmd(subcmd)) {
    return errEnvelope(
      `ledger ${subcmd}`,
      'UNKNOWN_SUBCOMMAND',
      `Unknown ledger subcommand: "${subcmd}". Valid: ${LEDGER_SUBCOMMANDS.join(', ')}`,
      2,
    )
  }

  const rest = args.slice(1)
  const { flags, positionals } = parseFlags(rest)

  const motiveFlag = flags['motive']
  if (!motiveFlag || motiveFlag === true) {
    return errEnvelope(
      `ledger ${subcmd}`,
      'USAGE_ERROR',
      `--motive <slug> is required for gw ledger ${subcmd}`,
      2,
    )
  }
  const motive = motiveFlag as string

  const repoRoot = process.env['CLAUDE_PROJECT_DIR'] ?? cwd
  const explicitSession = flags['session'] as string | undefined
  const sessionId = explicitSession ?? currentSession()
  if (!sessionId) {
    return errEnvelope(
      `ledger ${subcmd}`,
      'NO_SESSION',
      'CLAUDE_CODE_SESSION_ID is not set — cannot resolve the active run store; run inside a Claude Code session or pass --session <id>',
      1,
    )
  }
  const runPath = resolveRunPath(repoRoot, sessionId)

  try {
    switch (subcmd) {
      // -----------------------------------------------------------------------
      case 'status': {
        const ledger = readLedger(runPath)
        if (!ledger) {
          return errEnvelope('ledger status', 'NOT_FOUND', `no ledger at ${runPath}`, 1)
        }
        if (ledger.motive && ledger.motive !== motive) {
          return errEnvelope(
            'ledger status',
            'MOTIVE_MISMATCH',
            `ledger motive is "${ledger.motive}", not "${motive}"`,
            1,
          )
        }
        const all = ledger.slices ?? []
        const verdict = extractGateVerdict(ledger.gate)
        const done = all.filter(s => s.status === 'complete').length
        const rows = all
          .map(s => {
            const sym = symForStatus(s.status)
            const wave = s.wave != null ? `w${s.wave}` : 'w?'
            const claimed = s.claimed_by ? ` [claimed:${s.claimed_by}]` : ''
            const blockers =
              (s.blocked_by ?? []).length > 0 ? ` [⟵${(s.blocked_by ?? []).join(',')}]` : ''
            return `  ${s.id}${sym}${wave}${claimed}${blockers}`
          })
          .join('\n')
        const out = `motive: ${motive}\n${rows}\ngate: advisor=${verdict}\n${done}/${all.length} slices complete\n`
        return okEnvelope('ledger status', { content: out })
      }

      // -----------------------------------------------------------------------
      case 'add': {
        const id = positionals[0]
        if (!id) return errEnvelope('ledger add', 'USAGE_ERROR', 'add requires <id>', 2)
        const ledger = readLedger(runPath)
        if (!ledger) {
          return errEnvelope('ledger add', 'NOT_FOUND', `no ledger at ${runPath}`, 1)
        }
        if (ledger.motive && ledger.motive !== motive) {
          return errEnvelope(
            'ledger add',
            'MOTIVE_MISMATCH',
            `ledger motive is "${ledger.motive}", not "${motive}"`,
            1,
          )
        }
        const slices = ledger.slices ?? []
        if (slices.some(s => s.id === id)) {
          return errEnvelope('ledger add', 'ALREADY_EXISTS', `slice ${id} already exists`, 1)
        }
        const wave = flags['wave'] ? parseInt(flags['wave'] as string, 10) : 0
        const kind = (flags['kind'] as string | undefined) ?? 'impl'
        const blockedBy = flags['blocked-by']
          ? (flags['blocked-by'] as string).split(',').map(s => s.trim())
          : undefined
        const acceptance = flags['acceptance']
          ? (flags['acceptance'] as string).split(';').map(s => s.trim())
          : undefined
        const coversAc = flags['covers-ac']
          ? (flags['covers-ac'] as string).split(',').map(s => s.trim())
          : undefined
        const decisions = flags['decisions']
          ? (flags['decisions'] as string).split(',').map(s => s.trim())
          : undefined
        const slice: SliceJson = {
          id,
          wave,
          status: (flags['status'] as string | undefined) ?? 'pending',
          kind,
          ...(flags['desc'] && flags['desc'] !== true ? { desc: flags['desc'] as string } : {}),
          ...(blockedBy ? { blocked_by: blockedBy } : {}),
          ...(acceptance ? { acceptance } : {}),
          ...(coversAc ? { covers_ac: coversAc } : {}),
          ...(decisions ? { decisions } : {}),
          ...(flags['ticket'] && flags['ticket'] !== true
            ? { ticket: flags['ticket'] as string }
            : {}),
          ...(flags['created-by'] && flags['created-by'] !== true
            ? { created_by: flags['created-by'] as string }
            : {}),
        }
        atomicWrite(runPath, { ...ledger, slices: [...slices, slice] })
        return okEnvelope('ledger add', { content: `${id} added\n` })
      }

      // -----------------------------------------------------------------------
      case 'set': {
        const id = positionals[0]
        if (!id) return errEnvelope('ledger set', 'USAGE_ERROR', 'set requires <id>', 2)
        const ledger = readLedger(runPath)
        if (!ledger) return errEnvelope('ledger set', 'NOT_FOUND', `no ledger at ${runPath}`, 1)
        const slices = ledger.slices ?? []
        const existing = slices.find(s => s.id === id)
        if (!existing) return errEnvelope('ledger set', 'NOT_FOUND', `slice ${id} not found`, 1)
        const newStatus = flags['status'] as string | undefined
        const terminal = newStatus === 'complete' || newStatus === 'skipped'
        if (terminal) {
          try {
            assertWriteToken(ledger, flags['token'])
          } catch (e) {
            return authErr('ledger set', e)
          }
        }
        const updated: SliceJson = {
          ...existing,
          ...(newStatus ? { status: newStatus } : {}),
          ...(flags['wave'] != null && flags['wave'] !== true
            ? { wave: parseInt(flags['wave'] as string, 10) }
            : {}),
          ...(flags['desc'] && flags['desc'] !== true ? { desc: flags['desc'] as string } : {}),
          ...(flags['blocked-by'] && flags['blocked-by'] !== true
            ? { blocked_by: (flags['blocked-by'] as string).split(',').map(s => s.trim()) }
            : {}),
          ...(flags['acceptance'] && flags['acceptance'] !== true
            ? { acceptance: (flags['acceptance'] as string).split(';').map(s => s.trim()) }
            : {}),
          ...(flags['covers-ac'] && flags['covers-ac'] !== true
            ? { covers_ac: (flags['covers-ac'] as string).split(',').map(s => s.trim()) }
            : {}),
          ...(flags['decisions'] && flags['decisions'] !== true
            ? { decisions: (flags['decisions'] as string).split(',').map(s => s.trim()) }
            : {}),
          ...(flags['ticket'] && flags['ticket'] !== true
            ? { ticket: flags['ticket'] as string }
            : {}),
          ...(flags['claimed-by'] && flags['claimed-by'] !== true
            ? { claimed_by: flags['claimed-by'] as string }
            : {}),
        }
        const newSlices = slices.map(s => (s.id === id ? updated : s))
        atomicWrite(runPath, { ...ledger, slices: newSlices })
        const changed = Object.entries(flags)
          .filter(([k]) =>
            [
              'status', 'wave', 'desc', 'blocked-by', 'acceptance',
              'covers-ac', 'decisions', 'ticket', 'claimed-by',
            ].includes(k),
          )
          .map(([k, v]) => `${k}=${v}`)
          .join(' ')
        return okEnvelope('ledger set', { content: `${id} updated: ${changed}\n` })
      }

      // -----------------------------------------------------------------------
      case 'complete': {
        const ids = positionals
        if (!ids.length) {
          return errEnvelope('ledger complete', 'USAGE_ERROR', 'complete requires <id> [<id>...]', 2)
        }
        const ledger = readLedger(runPath)
        if (!ledger) return errEnvelope('ledger complete', 'NOT_FOUND', `no ledger at ${runPath}`, 1)
        const slices = ledger.slices ?? []
        const masterOk = (() => {
          try {
            assertWriteToken(ledger, flags['token'])
            return true
          } catch {
            return false
          }
        })()
        const scopedOk = checkScopedToken(ledger, flags['token'], ids, slices)
        if (!masterOk && !scopedOk) {
          return errEnvelope(
            'ledger complete',
            'AUTH_ERROR',
            'write operations require --token <write_token>',
            1,
          )
        }
        const terminalSet = new Set(
          slices.filter(s => s.status === 'complete' || s.status === 'skipped').map(s => s.id),
        )
        for (const id of ids) {
          const sl = slices.find(s => s.id === id)
          if (!sl) return errEnvelope('ledger complete', 'NOT_FOUND', `slice ${id} not found`, 2)
          const unmet = (sl.blocked_by ?? []).filter(b => !terminalSet.has(b))
          if (unmet.length > 0) {
            const blockerStatus = slices.find(s => s.id === unmet[0])?.status ?? 'unknown'
            return errEnvelope(
              'ledger complete',
              'BLOCKED',
              `slice ${id} blocked by ${unmet[0]} (status: ${blockerStatus})`,
              1,
            )
          }
        }
        const now = new Date().toISOString()
        let updatedSlices = [...slices]
        for (const id of ids) {
          updatedSlices = updatedSlices.map(s =>
            s.id === id
              ? { ...s, status: 'complete', completed_at: now, session_id: sessionId }
              : s,
          )
          terminalSet.add(id)
        }
        atomicWrite(runPath, { ...ledger, slices: updatedSlices })
        const done = updatedSlices.filter(s => s.status === 'complete').length
        return okEnvelope('ledger complete', {
          content: `${done}/${updatedSlices.length} slices complete\n`,
        })
      }

      // -----------------------------------------------------------------------
      case 'rm': {
        const ids = positionals
        if (!ids.length)
          return errEnvelope('ledger rm', 'USAGE_ERROR', 'rm requires <id> [<id>...]', 2)
        const ledger = readLedger(runPath)
        if (!ledger) return errEnvelope('ledger rm', 'NOT_FOUND', `no ledger at ${runPath}`, 1)
        const slices = ledger.slices ?? []
        const removed: string[] = []
        for (const id of ids) {
          if (!slices.some(s => s.id === id)) {
            return errEnvelope('ledger rm', 'NOT_FOUND', `slice not found: ${id}`, 1)
          }
          removed.push(id)
        }
        const rmSet = new Set(removed)
        atomicWrite(runPath, { ...ledger, slices: slices.filter(s => !rmSet.has(s.id)) })
        return okEnvelope('ledger rm', { content: `removed: ${removed.join(', ')}\n` })
      }

      // -----------------------------------------------------------------------
      case 'show': {
        const id = positionals[0]
        if (!id) return errEnvelope('ledger show', 'USAGE_ERROR', 'show requires <id>', 2)
        const ledger = readLedger(runPath)
        if (!ledger) return errEnvelope('ledger show', 'NOT_FOUND', `no ledger at ${runPath}`, 1)
        const slices = ledger.slices ?? []
        const sl = slices.find(s => s.id === id)
        if (!sl) return errEnvelope('ledger show', 'NOT_FOUND', `slice ${id} not found`, 1)
        const lines = [
          `id:         ${sl.id}`,
          `kind:       ${sl.kind ?? 'impl'}`,
          `wave:       ${sl.wave ?? '(none)'}`,
          `status:     ${sl.status}`,
          `desc:       ${sl.desc ?? '(none)'}`,
          `ticket:     ${sl.ticket ?? '(none)'}`,
          `blocked_by: ${(sl.blocked_by ?? []).join(', ') || '(none)'}`,
          `covers_ac:  ${(sl.covers_ac ?? []).join(', ') || '(none)'}`,
          `decisions:  ${(sl.decisions ?? []).join(', ') || '(none)'}`,
          `claimed_by: ${sl.claimed_by ?? '(none)'}`,
          `created_by: ${sl.created_by ?? '(none)'}`,
          `sealed:     null`,
        ]
        if ((sl.acceptance ?? []).length > 0) {
          lines.push('acceptance:')
          for (const [i, ac] of (sl.acceptance ?? []).entries()) {
            lines.push(`    [${i + 1}] ${ac}`)
          }
        }
        return okEnvelope('ledger show', { content: lines.join('\n') + '\n' })
      }

      // -----------------------------------------------------------------------
      case 'view': {
        const ledger = readLedger(runPath)
        if (!ledger) return errEnvelope('ledger view', 'NOT_FOUND', `no ledger at ${runPath}`, 1)
        if (ledger.motive && ledger.motive !== motive) {
          return errEnvelope(
            'ledger view',
            'MOTIVE_MISMATCH',
            `ledger motive is "${ledger.motive}", not "${motive}"`,
            1,
          )
        }
        const all = ledger.slices ?? []
        const verdict = extractGateVerdict(ledger.gate)
        const done = all.filter(s => s.status === 'complete').length
        const waveMap = new Map<number, SliceJson[]>()
        for (const sl of all) {
          const w = sl.wave ?? 0
          if (!waveMap.has(w)) waveMap.set(w, [])
          waveMap.get(w)!.push(sl)
        }
        const waves = [...waveMap.keys()].sort((a, b) => a - b)
        const lines: string[] = [
          '# Groundwork Run',
          `**Motive:** ${motive}`,
          `**Session:** ${sessionId}`,
          '',
        ]
        const tableHeader = [
          '| ID | Kind | Status | Blocked By | Claimed By | Decisions | Description |',
          '|---|---|---|---|---|---|---|',
        ]
        for (const w of waves) {
          lines.push(`## Wave ${w}`, ...tableHeader)
          for (const sl of waveMap.get(w)!) {
            const icon = kindIcon(sl.kind)
            const sym = symForStatus(sl.status)
            const blockers = (sl.blocked_by ?? []).join(', ') || '—'
            const claimed = sl.claimed_by ?? '—'
            const decs = (sl.decisions ?? []).join(', ') || '—'
            const rawDesc = sl.desc ?? ''
            const desc = rawDesc.length > 40 ? rawDesc.slice(0, 37) + '...' : rawDesc || '—'
            lines.push(
              `| \`${sl.id}\` | ${icon} ${sl.kind ?? 'impl'} | ${sym} ${sl.status} | ${blockers} | ${claimed} | ${decs} | ${desc} |`,
            )
          }
          lines.push('')
        }
        lines.push(
          '## Gate',
          '| Gate | Verdict |',
          '|---|---|',
          `| advisor | ${verdict} |`,
          '',
          `**Progress:** ${done}/${all.length} slices complete`,
        )
        return okEnvelope('ledger view', { content: lines.join('\n') + '\n' })
      }

      // -----------------------------------------------------------------------
      case 'gate': {
        const gateKind = positionals[0]
        const verdict = positionals[1]
        if (gateKind !== 'advisor' || !verdict) {
          return errEnvelope(
            'ledger gate',
            'USAGE_ERROR',
            'Usage: gw ledger gate --motive <slug> advisor <VERDICT> --token <t>',
            2,
          )
        }
        const validVerdicts = ['APPROVE', 'CORRECTION', 'STOP', 'GAPS', 'REPLAN']
        if (!validVerdicts.includes(verdict)) {
          return errEnvelope(
            'ledger gate',
            'USAGE_ERROR',
            `Invalid verdict. Valid: ${validVerdicts.join(', ')}`,
            2,
          )
        }
        const ledger = readLedger(runPath)
        if (!ledger) return errEnvelope('ledger gate', 'NOT_FOUND', `no ledger at ${runPath}`, 1)
        try {
          assertWriteToken(ledger, flags['token'])
        } catch (e) {
          return authErr('ledger gate', e)
        }
        const citation = flags['citation'] as string | undefined
        const rubric = flags['rubric'] as string | undefined
        const advisorField =
          citation || rubric
            ? { verdict, ...(rubric ? { rubric } : {}), ...(citation ? { citation } : {}) }
            : verdict
        const newGate: GateJson = {
          ...gateWithoutSeal(ledger.gate ?? {}),
          advisor: advisorField,
        }
        atomicWrite(runPath, { ...ledger, gate: newGate })
        return okEnvelope('ledger gate', { content: `advisor: ${verdict}\n` })
      }

      // -----------------------------------------------------------------------
      case 'abandon': {
        const ledger = readLedger(runPath)
        if (!ledger) return errEnvelope('ledger abandon', 'NOT_FOUND', `no ledger at ${runPath}`, 1)
        try {
          assertWriteToken(ledger, flags['token'])
        } catch (e) {
          return authErr('ledger abandon', e)
        }
        const newGate: GateJson = {
          ...gateWithoutSeal(ledger.gate ?? {}),
          advisor: 'STOP',
        }
        atomicWrite(runPath, { ...ledger, active: false, gate: newGate })
        return okEnvelope('ledger abandon', { content: `motive "${motive}" abandoned\n` })
      }

      // -----------------------------------------------------------------------
      case 'fog': {
        const id = positionals[0]
        if (!id) return errEnvelope('ledger fog', 'USAGE_ERROR', 'fog requires <id>', 2)
        if (
          !flags['desc'] ||
          flags['desc'] === true ||
          !flags['question'] ||
          flags['question'] === true
        ) {
          return errEnvelope('ledger fog', 'USAGE_ERROR', 'fog requires --desc and --question', 2)
        }
        const ledger = readLedger(runPath)
        if (!ledger) return errEnvelope('ledger fog', 'NOT_FOUND', `no ledger at ${runPath}`, 1)
        const slices = ledger.slices ?? []
        if (slices.some(s => s.id === id)) {
          return errEnvelope('ledger fog', 'ALREADY_EXISTS', `slice ${id} already exists`, 1)
        }
        const wave = flags['wave'] ? parseInt(flags['wave'] as string, 10) : 0
        const slice: SliceJson = {
          id,
          wave,
          status: 'pending',
          kind: 'fog',
          desc: flags['desc'] as string,
          question: flags['question'] as string,
        }
        atomicWrite(runPath, { ...ledger, slices: [...slices, slice] })
        return okEnvelope('ledger fog', { content: `${id} added (fog)\n` })
      }

      // -----------------------------------------------------------------------
      case 'frontier': {
        const ledger = readLedger(runPath)
        if (!ledger) {
          return okEnvelope('ledger frontier', {
            content:
              'no frontier slices — all pending slices are blocked, in progress, or claimed by another session\n',
          })
        }
        const slices = ledger.slices ?? []
        const terminalSet = new Set(
          slices.filter(s => s.status === 'complete' || s.status === 'skipped').map(s => s.id),
        )
        const frontier = slices.filter(
          s =>
            s.status === 'pending' &&
            (s.blocked_by ?? []).every(id => terminalSet.has(id)) &&
            (s.claimed_by === undefined || s.claimed_by === sessionId),
        )
        if (!frontier.length) {
          return okEnvelope('ledger frontier', {
            content:
              'no frontier slices — all pending slices are blocked, in progress, or claimed by another session\n',
          })
        }
        const rows = frontier.map(sl => {
          const wave = sl.wave != null ? `w${sl.wave}` : 'w?'
          const claimed = sl.claimed_by ? ` [claimed:${sl.claimed_by}]` : ''
          const desc = (sl.desc ?? '').slice(0, 60)
          return `${sl.id}  ${wave}${claimed}  ${desc}`
        })
        return okEnvelope('ledger frontier', { content: rows.join('\n') + '\n' })
      }

      // -----------------------------------------------------------------------
      case 'claim': {
        const ids = positionals
        if (!ids.length) {
          return errEnvelope('ledger claim', 'USAGE_ERROR', 'claim requires <id> [<id>...]', 2)
        }
        const ledger = readLedger(runPath)
        if (!ledger) return errEnvelope('ledger claim', 'NOT_FOUND', `no ledger at ${runPath}`, 1)
        let slices = ledger.slices ?? []
        const claimed: string[] = []
        const lines: string[] = []
        const now = new Date().toISOString()
        for (const id of ids) {
          const sl = slices.find(s => s.id === id)
          if (!sl) {
            lines.push(`${id} not found`)
            continue
          }
          if (!sl.claimed_by) {
            slices = slices.map(s =>
              s.id === id ? { ...s, claimed_by: sessionId, claimed_at: now } : s,
            )
            claimed.push(id)
          } else if (sl.claimed_by === sessionId) {
            // already claimed by same session — silent skip
          } else {
            lines.push(`${id} already claimed by ${sl.claimed_by}`)
          }
        }
        if (claimed.length) {
          atomicWrite(runPath, { ...ledger, slices })
          lines.unshift(`claimed: ${claimed.join(', ')}`)
        }
        return okEnvelope('ledger claim', { content: lines.join('\n') + '\n' })
      }

      // -----------------------------------------------------------------------
      case 'await-human': {
        const ledger = readLedger(runPath)
        if (!ledger)
          return errEnvelope('ledger await-human', 'NOT_FOUND', `no ledger at ${runPath}`, 1)
        try {
          assertWriteToken(ledger, flags['token'])
        } catch (e) {
          return authErr('ledger await-human', e)
        }
        const clearing = positionals[0] === 'clear'
        const base = gateWithoutSeal(ledger.gate ?? {})
        if (clearing) {
          atomicWrite(runPath, { ...ledger, gate: { ...base, awaiting_human: null } })
          return okEnvelope('ledger await-human', { content: 'awaiting-human hold cleared\n' })
        } else {
          atomicWrite(runPath, {
            ...ledger,
            gate: {
              ...base,
              awaiting_human: {
                reason: 'set via gw ledger await-human',
                set_at: new Date().toISOString(),
              },
            },
          })
          return okEnvelope('ledger await-human', { content: 'awaiting-human hold set\n' })
        }
      }

      // -----------------------------------------------------------------------
      case 'autopilot': {
        const ledger = readLedger(runPath)
        if (!ledger)
          return errEnvelope('ledger autopilot', 'NOT_FOUND', `no ledger at ${runPath}`, 1)
        try {
          assertWriteToken(ledger, flags['token'])
        } catch (e) {
          return authErr('ledger autopilot', e)
        }
        if (
          !flags['range'] ||
          flags['range'] === true ||
          !flags['reason'] ||
          flags['reason'] === true
        ) {
          return errEnvelope(
            'ledger autopilot',
            'USAGE_ERROR',
            'autopilot requires --range N and --reason "..."',
            2,
          )
        }
        const range = parseInt(flags['range'] as string, 10)
        const reason = flags['reason'] as string
        const base = gateWithoutSeal(ledger.gate ?? {})
        const rawGrants: unknown[] = Array.isArray(base['autopilot']) ? base['autopilot'] : []
        const existingGrants = rawGrants.filter(
          (g): g is { units: number; reason: string; ts: string } =>
            typeof g === 'object' && g !== null &&
            typeof (g as Record<string, unknown>)['units'] === 'number' &&
            typeof (g as Record<string, unknown>)['reason'] === 'string' &&
            typeof (g as Record<string, unknown>)['ts'] === 'string',
        )
        atomicWrite(runPath, {
          ...ledger,
          gate: {
            ...base,
            autopilot: [...existingGrants, { units: range, reason, ts: new Date().toISOString() }],
          },
        })
        return okEnvelope('ledger autopilot', {
          content: `autopilot extended by ${range} waves (reason: ${reason})\n`,
        })
      }

      // -----------------------------------------------------------------------
      case 'scope-token': {
        const scope = positionals[0]
        if (!scope) {
          return errEnvelope('ledger scope-token', 'USAGE_ERROR', 'scope-token requires <scope>', 2)
        }
        const ledger = readLedger(runPath)
        if (!ledger)
          return errEnvelope('ledger scope-token', 'NOT_FOUND', `no ledger at ${runPath}`, 1)
        try {
          assertWriteToken(ledger, flags['token'])
        } catch (e) {
          return authErr('ledger scope-token', e)
        }
        // Generate a random scoped token, persist in ledger.scoped_tokens
        const token = randomBytes(16).toString('hex')
        const existing = Array.isArray(ledger.scoped_tokens) ? ledger.scoped_tokens : []
        const updated = [...existing.filter(st => st.scope !== scope), { token, scope }]
        atomicWrite(runPath, { ...ledger, scoped_tokens: updated })
        return okEnvelope('ledger scope-token', {
          content:
            `scope_token: ${token}\n` +
            `  (pass as --token to complete for slices created_by ${scope})\n`,
        })
      }

      // -----------------------------------------------------------------------
      case 'milestone-signoff': {
        const verdict = flags['verdict'] as string | undefined
        const verifiedBy = flags['verified-by'] as string | undefined
        if (!verdict || !verifiedBy) {
          return errEnvelope(
            'ledger milestone-signoff',
            'USAGE_ERROR',
            '--verdict and --verified-by are required',
            2,
          )
        }
        if (verdict !== 'APPROVE' && verdict !== 'REJECT') {
          return errEnvelope(
            'ledger milestone-signoff',
            'USAGE_ERROR',
            '--verdict must be APPROVE or REJECT',
            2,
          )
        }
        const ledger = readLedger(runPath)
        if (!ledger)
          return errEnvelope('ledger milestone-signoff', 'NOT_FOUND', `no ledger at ${runPath}`, 1)
        try {
          assertWriteToken(ledger, flags['token'])
        } catch (e) {
          return authErr('ledger milestone-signoff', e)
        }
        const newGate: GateJson = {
          ...gateWithoutSeal(ledger.gate ?? {}),
          verifier: verdict,
        }
        atomicWrite(runPath, { ...ledger, gate: newGate })
        return okEnvelope('ledger milestone-signoff', {
          content: `milestone signed off: ${verdict} by ${verifiedBy}\n`,
        })
      }
    }
  } catch (e: unknown) {
    const err = e as { message?: string }
    return errEnvelope(`ledger ${subcmd}`, 'INTERNAL_ERROR', err.message ?? String(e), 1)
  }
}
