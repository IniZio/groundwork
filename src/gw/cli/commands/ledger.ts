/**
 * ledger.ts — `gw ledger <subcommand>` — store-backed implementations.
 */
import { existsSync, unlinkSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import { type GwEnvelope, okEnvelope, errEnvelope } from '../envelope.js'
import {
  writeSlice,
  readSlice,
  listSlices,
  frontier as storeFrontier,
} from '../../store/slice/index.js'
import { writeGate, readGate } from '../../store/gate/index.js'
import { readKey } from '../../store/seal/index.js'
import { motiveDir, sliceNotePath } from '../../schema/index.js'
import { findGitRoot } from '../git-root.js'
import type { Slice, Gate } from '../../schema/index.js'

const TRACKER = '.groundwork/next'

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

function currentSession(): string {
  return process.env['CLAUDE_CODE_SESSION_ID'] ?? 'default'
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

function extractGateVerdict(gate: (Gate & { sealed?: true | false | null }) | null): string {
  if (!gate || !gate.advisor) return 'pending'
  if (typeof gate.advisor === 'string') return gate.advisor
  if (typeof gate.advisor === 'object' && 'verdict' in gate.advisor) {
    return (gate.advisor as { verdict: string }).verdict
  }
  return 'pending'
}

function assertWriteToken(mDir: string, passedToken: string | true | undefined): void {
  if (!passedToken || passedToken === true) {
    throw Object.assign(new Error('write operations require --token <write_token>'), { exitCode: 1 })
  }
  let key: Buffer
  try {
    key = readKey(mDir)
  } catch {
    throw Object.assign(new Error('no seal key found — motive not initialized'), { exitCode: 1 })
  }
  if (key.toString('hex') !== passedToken) {
    throw Object.assign(new Error('invalid token — write operations are orchestrator-only'), {
      exitCode: 1,
    })
  }
}

function checkScopedToken(
  mDir: string,
  passedToken: string | true | undefined,
  sliceIds: string[],
  allSlices: Slice[],
): boolean {
  if (!passedToken || passedToken === true) return false
  const t = passedToken as string
  const colonIdx = t.indexOf(':')
  if (colonIdx < 0) return false
  const scope = t.slice(0, colonIdx)
  const givenHmac = t.slice(colonIdx + 1)
  let key: Buffer
  try {
    key = readKey(mDir)
  } catch {
    return false
  }
  const expectedHmac = createHmac('sha256', key).update(scope).digest('hex')
  if (expectedHmac !== givenHmac) return false
  const sliceMap = new Map(allSlices.map(s => [s.id, s]))
  return sliceIds.every(id => sliceMap.get(id)?.created_by === scope)
}

function authErr(
  cmd: string,
  e: unknown,
): GwEnvelope {
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

  const repoRoot = findGitRoot(cwd) ?? cwd
  const mDir = motiveDir(repoRoot, TRACKER, motive)
  const sessionId = (flags['session'] as string | undefined) ?? currentSession()

  try {
    switch (subcmd) {
      // -----------------------------------------------------------------------
      case 'status': {
        const all = listSlices(repoRoot, TRACKER, motive)
        const gate = readGate(repoRoot, TRACKER, motive, sessionId)
        const verdict = extractGateVerdict(gate)
        const done = all.filter(s => s.status === 'complete').length
        const rows = all
          .map(s => {
            const sym = symForStatus(s.status)
            const wave = s.wave != null ? `w${s.wave}` : 'w?'
            const claimed = s.claimed_by ? ` [claimed:${s.claimed_by}]` : ''
            const blockers =
              (s.blocked_by ?? []).length > 0 ? ` [⟵${s.blocked_by!.join(',')}]` : ''
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
        const existing = listSlices(repoRoot, TRACKER, motive)
        if (existing.some(s => s.id === id)) {
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
        const slice: Slice = {
          id,
          wave,
          status: (flags['status'] as Slice['status']) ?? 'pending',
          kind: kind as Slice['kind'],
          desc: flags['desc'] as string | undefined,
          blocked_by: blockedBy,
          acceptance,
          covers_ac: coversAc,
          decisions,
          ticket: flags['ticket'] as string | undefined,
          created_by: flags['created-by'] as string | undefined,
        }
        writeSlice({ repoRoot, tracker: TRACKER, motive, slice })
        return okEnvelope('ledger add', { content: `${id} added\n` })
      }

      // -----------------------------------------------------------------------
      case 'set': {
        const id = positionals[0]
        if (!id) return errEnvelope('ledger set', 'USAGE_ERROR', 'set requires <id>', 2)
        const all = listSlices(repoRoot, TRACKER, motive)
        const existing = all.find(s => s.id === id)
        if (!existing) return errEnvelope('ledger set', 'NOT_FOUND', `slice ${id} not found`, 1)
        const newStatus = flags['status'] as string | undefined
        const terminal = newStatus === 'complete' || newStatus === 'skipped'
        if (terminal) {
          try {
            assertWriteToken(mDir, flags['token'])
          } catch (e) {
            return authErr('ledger set', e)
          }
        }
        const updated: Slice = {
          ...existing,
          ...(newStatus ? { status: newStatus as Slice['status'] } : {}),
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
        writeSlice({ repoRoot, tracker: TRACKER, motive, slice: updated })
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
        const all = listSlices(repoRoot, TRACKER, motive)
        // Auth: master token or scoped token
        const masterOk = (() => {
          try {
            assertWriteToken(mDir, flags['token'])
            return true
          } catch {
            return false
          }
        })()
        const scopedOk = checkScopedToken(mDir, flags['token'], ids, all)
        if (!masterOk && !scopedOk) {
          return errEnvelope('ledger complete', 'AUTH_ERROR', 'write operations require --token <write_token>', 1)
        }
        const terminalSet = new Set(
          all.filter(s => s.status === 'complete' || s.status === 'skipped').map(s => s.id),
        )
        for (const id of ids) {
          const sl = all.find(s => s.id === id)
          if (!sl) return errEnvelope('ledger complete', 'NOT_FOUND', `slice ${id} not found`, 2)
          const unmet = (sl.blocked_by ?? []).filter(b => !terminalSet.has(b))
          if (unmet.length > 0) {
            const blockerStatus = all.find(s => s.id === unmet[0])?.status ?? 'unknown'
            return errEnvelope(
              'ledger complete',
              'BLOCKED',
              `slice ${id} blocked by ${unmet[0]} (status: ${blockerStatus})`,
              1,
            )
          }
        }
        const now = new Date().toISOString()
        for (const id of ids) {
          const sl = all.find(s => s.id === id)!
          const updated: Slice = {
            ...sl,
            status: 'complete',
            completed_at: now,
            session: sessionId,
          }
          writeSlice({ repoRoot, tracker: TRACKER, motive, slice: updated })
          terminalSet.add(id)
        }
        const finalAll = listSlices(repoRoot, TRACKER, motive)
        const done = finalAll.filter(s => s.status === 'complete').length
        return okEnvelope('ledger complete', { content: `${done}/${finalAll.length} slices complete\n` })
      }

      // -----------------------------------------------------------------------
      case 'rm': {
        const ids = positionals
        if (!ids.length) return errEnvelope('ledger rm', 'USAGE_ERROR', 'rm requires <id> [<id>...]', 2)
        const removed: string[] = []
        for (const id of ids) {
          const notePath = sliceNotePath(repoRoot, TRACKER, motive, id)
          if (!existsSync(notePath)) {
            return errEnvelope('ledger rm', 'NOT_FOUND', `slice note not found: ${id}`, 1)
          }
          unlinkSync(notePath)
          const sealPath = `${notePath}.seal`
          if (existsSync(sealPath)) unlinkSync(sealPath)
          removed.push(id)
        }
        return okEnvelope('ledger rm', { content: `removed: ${removed.join(', ')}\n` })
      }

      // -----------------------------------------------------------------------
      case 'show': {
        const id = positionals[0]
        if (!id) return errEnvelope('ledger show', 'USAGE_ERROR', 'show requires <id>', 2)
        const all = listSlices(repoRoot, TRACKER, motive)
        const sl = all.find(s => s.id === id)
        if (!sl) return errEnvelope('ledger show', 'NOT_FOUND', `slice ${id} not found`, 1)
        let sealed: true | false | null = null
        try {
          const s = readSlice(sliceNotePath(repoRoot, TRACKER, motive, id))
          sealed = s.sealed
        } catch {
          /* file may have slug — sealed stays null */
        }
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
          `sealed:     ${sealed}`,
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
        const all = listSlices(repoRoot, TRACKER, motive)
        const gate = readGate(repoRoot, TRACKER, motive, sessionId)
        const verdict = extractGateVerdict(gate)
        const done = all.filter(s => s.status === 'complete').length
        const waveMap = new Map<number, Slice[]>()
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
        try {
          assertWriteToken(mDir, flags['token'])
        } catch (e) {
          return authErr('ledger gate', e)
        }
        const citation = flags['citation'] as string | undefined
        const rubric = flags['rubric'] as string | undefined
        const advisorField =
          citation || rubric
            ? {
                verdict,
                ...(rubric ? { rubric } : {}),
                ...(citation ? { citation } : {}),
              }
            : verdict
        const gate: Gate = {
          session: sessionId,
          motive,
          created_at: new Date().toISOString(),
          advisor: advisorField as Gate['advisor'],
        }
        writeGate({ repoRoot, tracker: TRACKER, motive, gate })
        return okEnvelope('ledger gate', { content: `advisor: ${verdict}\n` })
      }

      // -----------------------------------------------------------------------
      case 'abandon': {
        try {
          assertWriteToken(mDir, flags['token'])
        } catch (e) {
          return authErr('ledger abandon', e)
        }
        const gate: Gate = {
          session: sessionId,
          motive,
          created_at: new Date().toISOString(),
          advisor: 'STOP',
        }
        writeGate({ repoRoot, tracker: TRACKER, motive, gate })
        return okEnvelope('ledger abandon', { content: `motive "${motive}" abandoned\n` })
      }

      // -----------------------------------------------------------------------
      case 'fog': {
        const id = positionals[0]
        if (!id) return errEnvelope('ledger fog', 'USAGE_ERROR', 'fog requires <id>', 2)
        if (!flags['desc'] || flags['desc'] === true || !flags['question'] || flags['question'] === true) {
          return errEnvelope('ledger fog', 'USAGE_ERROR', 'fog requires --desc and --question', 2)
        }
        const wave = flags['wave'] ? parseInt(flags['wave'] as string, 10) : 0
        const slice: Slice = {
          id,
          wave,
          status: 'pending',
          kind: 'fog',
          desc: flags['desc'] as string,
          question: flags['question'] as string,
        }
        writeSlice({ repoRoot, tracker: TRACKER, motive, slice })
        return okEnvelope('ledger fog', { content: `${id} added (fog)\n` })
      }

      // -----------------------------------------------------------------------
      case 'frontier': {
        const slices = storeFrontier(repoRoot, TRACKER, motive, sessionId)
        if (!slices.length) {
          return okEnvelope('ledger frontier', {
            content:
              'no frontier slices — all pending slices are blocked, in progress, or claimed by another session\n',
          })
        }
        const rows = slices.map(sl => {
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
        const all = listSlices(repoRoot, TRACKER, motive)
        const claimed: string[] = []
        const lines: string[] = []
        const now = new Date().toISOString()
        for (const id of ids) {
          const sl = all.find(s => s.id === id)
          if (!sl) {
            lines.push(`${id} not found`)
            continue
          }
          if (!sl.claimed_by) {
            const updated: Slice = { ...sl, claimed_by: sessionId, claimed_at: now }
            writeSlice({ repoRoot, tracker: TRACKER, motive, slice: updated })
            claimed.push(id)
          } else if (sl.claimed_by === sessionId) {
            // already claimed by same session — silent skip
          } else {
            lines.push(`${id} already claimed by ${sl.claimed_by}`)
          }
        }
        if (claimed.length) lines.unshift(`claimed: ${claimed.join(', ')}`)
        return okEnvelope('ledger claim', { content: lines.join('\n') + '\n' })
      }

      // -----------------------------------------------------------------------
      case 'await-human': {
        try {
          assertWriteToken(mDir, flags['token'])
        } catch (e) {
          return authErr('ledger await-human', e)
        }
        const clearing = positionals[0] === 'clear'
        const existing = readGate(repoRoot, TRACKER, motive, sessionId)
        const { sealed: _sealed, ...existingData } = existing ?? {}
        const gateBase: Gate = existing
          ? (existingData as Gate)
          : { session: sessionId, motive, created_at: new Date().toISOString() }
        if (clearing) {
          const updated = { ...gateBase, awaiting_human: null }
          writeGate({ repoRoot, tracker: TRACKER, motive, gate: updated as Gate })
          return okEnvelope('ledger await-human', { content: 'awaiting-human hold cleared\n' })
        } else {
          const updated = {
            ...gateBase,
            awaiting_human: { reason: 'set via gw ledger await-human', set_at: new Date().toISOString() },
          }
          writeGate({ repoRoot, tracker: TRACKER, motive, gate: updated as Gate })
          return okEnvelope('ledger await-human', { content: 'awaiting-human hold set\n' })
        }
      }

      // -----------------------------------------------------------------------
      case 'autopilot': {
        try {
          assertWriteToken(mDir, flags['token'])
        } catch (e) {
          return authErr('ledger autopilot', e)
        }
        if (!flags['range'] || flags['range'] === true || !flags['reason'] || flags['reason'] === true) {
          return errEnvelope(
            'ledger autopilot',
            'USAGE_ERROR',
            'autopilot requires --range N and --reason "..."',
            2,
          )
        }
        const range = parseInt(flags['range'] as string, 10)
        const reason = flags['reason'] as string
        const existingAp = readGate(repoRoot, TRACKER, motive, sessionId)
        const { sealed: _sealedAp, ...existingApData } = existingAp ?? {}
        const gateBaseAp: Gate = existingAp
          ? (existingApData as Gate)
          : { session: sessionId, motive, created_at: new Date().toISOString() }
        const existingGrants = Array.isArray((gateBaseAp as Record<string, unknown>)['autopilot'])
          ? ((gateBaseAp as Record<string, unknown>)['autopilot'] as unknown[])
          : []
        const updatedAp = {
          ...gateBaseAp,
          autopilot: [...existingGrants, { units: range, reason, ts: new Date().toISOString() }],
        }
        writeGate({ repoRoot, tracker: TRACKER, motive, gate: updatedAp as Gate })
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
        try {
          assertWriteToken(mDir, flags['token'])
        } catch (e) {
          return authErr('ledger scope-token', e)
        }
        const key = readKey(mDir)
        const hmac = createHmac('sha256', key).update(scope).digest('hex')
        const token = `${scope}:${hmac}`
        return okEnvelope('ledger scope-token', {
          content: `scope_token: ${token}\n  (pass as --token to complete for slices created_by ${scope})\n`,
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
        try {
          assertWriteToken(mDir, flags['token'])
        } catch (e) {
          return authErr('ledger milestone-signoff', e)
        }
        const gate: Gate = {
          session: sessionId,
          motive,
          created_at: new Date().toISOString(),
          verifier: verdict,
        }
        writeGate({ repoRoot, tracker: TRACKER, motive, gate })
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
