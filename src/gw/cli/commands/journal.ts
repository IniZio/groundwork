/**
 * journal.ts — `gw journal <subcommand>` implementation.
 * Subcommands: append, show, compile
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import matter from 'gray-matter'
import type { JournalEvent } from '../../schema/journal.js'
import { JournalEventType } from '../../schema/journal.js'
import { type GwEnvelope, errEnvelope, okEnvelope } from '../envelope.js'
import { writeDecision } from '../../store/motive/decision.js'
import { DEFAULT_TRACKER_PATH } from '../../schema/layout.js'

export const JOURNAL_SUBCOMMANDS = ['append', 'show', 'compile'] as const

type JournalSubcmd = (typeof JOURNAL_SUBCOMMANDS)[number]

function isJournalSubcmd(s: string): s is JournalSubcmd {
  return (JOURNAL_SUBCOMMANDS as readonly string[]).includes(s)
}

function parseFlags(args: string[]): { flags: Record<string, string | true>; positionals: string[] } {
  const flags: Record<string, string | true> = {}
  const positionals: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith('--')) {
      const next = args[i + 1]
      if (next && !next.startsWith('--')) { flags[a.slice(2)] = next; i++ }
      else flags[a.slice(2)] = true
    } else { positionals.push(a) }
  }
  return { flags, positionals }
}

function sanitizeTs(ts: string): string {
  return ts.replace(/:/g, '-').replace(/\./g, '-')
}

function readMotiveJournalEvents(repoRoot: string, tracker: string, motive: string): JournalEvent[] {
  const journalDir = join(repoRoot, tracker, 'motives', motive, 'journal')
  if (!existsSync(journalDir)) return []
  const events: JournalEvent[] = []
  let files: string[]
  try { files = readdirSync(journalDir).filter(f => f.endsWith('.md')) } catch { return [] }
  for (const file of files) {
    try {
      const raw = readFileSync(join(journalDir, file), 'utf8')
      const { data, content } = matter(raw)
      events.push({
        ts: data['ts'] as string,
        session: data['session'] as string,
        type: data['type'] as string,
        source: data['source'] as string,
        motive,
        data: data['data'] as Record<string, unknown> | undefined,
        msg: content.trim(),
      } as unknown as JournalEvent)
    } catch { /* skip malformed */ }
  }
  return events
}

function readMotiveDecisionEvents(repoRoot: string, tracker: string, motive: string): JournalEvent[] {
  const decisionsDir = join(repoRoot, tracker, 'motives', motive, 'decisions')
  if (!existsSync(decisionsDir)) return []
  const events: JournalEvent[] = []
  let files: string[]
  try { files = readdirSync(decisionsDir).filter(f => f.endsWith('.md')) } catch { return [] }
  for (const file of files) {
    try {
      const raw = readFileSync(join(decisionsDir, file), 'utf8')
      const { data, content } = matter(raw)
      events.push({
        ts: (data['date'] as string) ?? '',
        session: '',
        type: 'DECISION',
        source: 'cli:journal',
        motive,
        data: { id: data['id'] as string, decision: content.trim() },
        msg: '',
      } as unknown as JournalEvent)
    } catch { /* skip malformed */ }
  }
  return events
}

function readAllEvents(repoRoot: string, tracker: string, motiveFilter?: string): JournalEvent[] {
  const motivesRoot = join(repoRoot, tracker, 'motives')
  let motives: string[]
  if (motiveFilter) {
    motives = [motiveFilter]
  } else {
    if (!existsSync(motivesRoot)) return []
    try { motives = readdirSync(motivesRoot) } catch { return [] }
  }
  const all: JournalEvent[] = []
  for (const motive of motives) {
    all.push(...readMotiveJournalEvents(repoRoot, tracker, motive))
    all.push(...readMotiveDecisionEvents(repoRoot, tracker, motive))
  }
  return all.sort((a, b) => ((a.ts ?? '') > (b.ts ?? '') ? 1 : -1))
}

function parseSince(since: string | true | undefined): Date | null {
  if (!since || since === true) return null
  if (typeof since === 'string' && /^\d+d$/.test(since)) {
    const days = parseInt(since)
    const d = new Date(); d.setDate(d.getDate() - days); return d
  }
  if (typeof since === 'string') return new Date(since)
  return null
}

const VALID_TYPES: ReadonlySet<string> = new Set(JournalEventType.options)

export async function run(args: string[], cwd: string): Promise<GwEnvelope> {
  const subcmd = args[0]
  if (!subcmd) {
    return errEnvelope(
      'journal',
      'USAGE_ERROR',
      `Usage: gw journal <subcommand>\nSubcommands: ${JOURNAL_SUBCOMMANDS.join(', ')}`,
      2,
    )
  }
  if (!isJournalSubcmd(subcmd)) {
    return errEnvelope(
      `journal ${subcmd}`,
      'UNKNOWN_SUBCOMMAND',
      `Unknown journal subcommand: "${subcmd}". Valid: ${JOURNAL_SUBCOMMANDS.join(', ')}`,
      2,
    )
  }

  const rest = args.slice(1)
  const { flags, positionals } = parseFlags(rest)
  const repoRoot = process.env['CLAUDE_PROJECT_DIR'] || cwd
  const tracker = DEFAULT_TRACKER_PATH

  if (subcmd === 'append') {
    const sessionId = process.env['CLAUDE_CODE_SESSION_ID']
    if (!sessionId) {
      return errEnvelope(
        'journal append',
        'NO_SESSION',
        'CLAUDE_CODE_SESSION_ID is not set — cannot resolve session; run inside a Claude Code session or pass --session <id>',
        1,
      )
    }
    const motive = flags['motive']
    const type = flags['type']
    const msg = flags['msg']
    const dataRaw = flags['data']

    if (!motive || motive === true) {
      return errEnvelope('journal append', 'USAGE_ERROR', '--motive is required', 2)
    }
    if (!type || type === true) {
      return errEnvelope('journal append', 'USAGE_ERROR', '--type is required', 2)
    }
    if (!msg || msg === true) {
      return errEnvelope('journal append', 'USAGE_ERROR', '--msg is required', 2)
    }
    if (!VALID_TYPES.has(type)) {
      return errEnvelope(
        'journal append',
        'INVALID_TYPE',
        `Invalid event type "${type}". Valid: ${[...VALID_TYPES].join(', ')}`,
        2,
      )
    }

    let data: Record<string, unknown> | undefined
    if (dataRaw && dataRaw !== true) {
      try { data = JSON.parse(dataRaw) as Record<string, unknown> } catch {
        return errEnvelope('journal append', 'INVALID_DATA', '--data must be valid JSON', 2)
      }
    }

    if (type === 'DECISION') {
      if (!data?.['id'] || !data?.['decision'] || !data?.['rationale']) {
        return errEnvelope(
          'journal append',
          'MISSING_DECISION_FIELDS',
          'DECISION events require data.id, data.decision, and data.rationale',
          2,
        )
      }
      await writeDecision({
        repoRoot,
        tracker,
        motive: motive as string,
        data: {
          id: data['id'] as string,
          decision: data['decision'] as string,
          rationale: data['rationale'] as string,
          alternatives: Array.isArray(data['alternatives']) ? (data['alternatives'] as string[]) : [],
          status: 'accepted',
          date: new Date().toISOString().slice(0, 10),
          motive: motive as string,
        },
      })
      return okEnvelope('journal append', { content: `journal: wrote DECISION ${data['id']} to decisions/${data['id']}.md\n` })
    }

    const ts = new Date().toISOString()
    const sanitizedTs = sanitizeTs(ts)
    const noteFilename = `${sanitizedTs}-${type}.md`
    const journalDir = join(repoRoot, tracker, 'motives', motive as string, 'journal')
    mkdirSync(journalDir, { recursive: true })
    const notePath = join(journalDir, noteFilename)
    const fm: Record<string, unknown> = {
      ts,
      session: sessionId,
      type,
      source: 'cli:journal',
      data: data ?? {},
    }
    writeFileSync(notePath, matter.stringify(msg as string, fm), 'utf8')

    return okEnvelope('journal append', { content: `journal: appended ${type} to journal/${noteFilename}\n` })
  }

  if (subcmd === 'show') {
    const motiveFilter = flags['motive']
    const motiveStr = motiveFilter && motiveFilter !== true ? (motiveFilter as string) : undefined
    let events = readAllEvents(repoRoot, tracker, motiveStr)

    const typeFilter = flags['type']
    if (typeFilter && typeFilter !== true) {
      const types = new Set((typeFilter as string).split(',').map(s => s.trim()))
      events = events.filter(e => types.has(e.type))
    }

    const sinceStr = flags['since']
    const hasExplicitWindow = motiveFilter || sinceStr
    const effectiveSince = sinceStr ?? (hasExplicitWindow ? undefined : '7d')
    const sinceDate = parseSince(effectiveSince)
    if (sinceDate) {
      const sinceTs = sinceDate.toISOString()
      events = events.filter(e => (e.ts ?? '') >= sinceTs)
    }

    const lastStr = flags['last']
    const lastN = lastStr && lastStr !== true ? parseInt(lastStr as string) : 30
    if (events.length > lastN) events = events.slice(events.length - lastN)

    if (events.length === 0) {
      // Guard: refuse silent empty-success when the legacy JSONL store has data
      // but the new Obsidian-native store (under <tracker>/motives/) has none.
      // This signals the divergence loudly rather than lying "no events found".
      const legacyJournalDir = join(repoRoot, '.groundwork', 'journal')
      let legacyShards: string[] = []
      try { legacyShards = readdirSync(legacyJournalDir).filter(f => f.endsWith('.jsonl')) } catch { /* no legacy dir */ }
      if (legacyShards.length > 0) {
        return errEnvelope(
          'journal show',
          'STORE_DIVERGENCE',
          `journal: 0 events in new store at ${join(repoRoot, tracker, 'motives')} ` +
          `but ${legacyShards.length} JSONL shards exist at ${legacyJournalDir} — ` +
          `use bin/journal to read the legacy store until migration is complete`,
          1,
        )
      }
      return okEnvelope('journal show', { content: 'no events found\n' })
    }

    const lines: string[] = []
    for (const e of events) {
      const motiveLabel = e.motive ? ` (motive: ${e.motive})` : ''
      lines.push(`[${e.ts ?? '?'}] ${e.type}${motiveLabel} ${e.msg ?? ''}`)
      if (e.data && Object.keys(e.data).length > 0) {
        lines.push(`  data: ${JSON.stringify(e.data)}`)
      }
    }
    return okEnvelope('journal show', { content: lines.join('\n') + '\n' })
  }

  // compile
  const motive = positionals[0]
  if (!motive) {
    return errEnvelope('journal compile', 'USAGE_ERROR', 'Usage: gw journal compile <motive> [--json]', 2)
  }

  const events = readAllEvents(repoRoot, tracker, motive)

  const decisions = events.filter(e => e.type === 'DECISION').map(e => e.data ?? {})
  const tasksComplete = events.filter(e => e.type === 'TASK_COMPLETE').map(e => e.data ?? {})
  const gates = events.filter(e => e.type === 'GATE').map(e => e.data ?? {})
  const failures = events.filter(e => e.type === 'FAILURE').map(e => e.data ?? {})

  const summary = {
    motive,
    compiled_at: new Date().toISOString(),
    event_count: events.length,
    decisions,
    tasks_complete: tasksComplete,
    gates,
    failures,
  }

  const useJson = flags['json'] === true || flags['json'] === 'true'
  let content: string
  if (useJson) {
    content = JSON.stringify(summary, null, 2) + '\n'
  } else {
    content = [
      `Motive: ${motive}`,
      `Events: ${events.length}`,
      `Decisions: ${decisions.length}`,
      `Tasks complete: ${tasksComplete.length}`,
      `Gates: ${gates.length}`,
      `Failures: ${failures.length}`,
    ].join('\n') + '\n'
  }
  return okEnvelope('journal compile', { content })
}
