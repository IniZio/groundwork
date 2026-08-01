#!/usr/bin/env node
/**
 * journal — append-only event log CLI.
 *
 * Usage:
 *   journal append --motive <id> --type <T> --msg <M> [--data <json>]
 *   journal show [--motive <id>] [--type T[,T]] [--since <date|Nd>] [--last N] [--brief]
 *   journal digest --motive <id> [--rebuild]
 *   journal help [<cmd>]
 *
 * Deprecated aliases (emit a deprecation notice):
 *   --rfc <uid>  →  use --motive <id> instead
 *
 * Exit codes: 0 success  1 operational failure  2 usage error
 *
 * Session ID resolution (explicit and testable):
 *   1. JOURNAL_SESSION_ID env var (test injection)
 *   2. CLAUDE_CODE_SESSION_ID env var (production)
 *   3. fallback: "default"
 *
 * Project dir resolution:
 *   1. CLAUDE_PROJECT_DIR env var
 *   2. process.cwd()
 */

import path from 'node:path'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import {
  VALID_TYPES,
  NEVER_COMPRESS,
  resolveShardPath,
  appendEvent,
  readAllEvents,
  filterEvents,
} from './lib/journal-io.mjs'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function die(msg, code = 1) {
  process.stderr.write(`journal: ${msg}\n`)
  process.exit(code)
}

/** Pull --flag value pairs from argv; boolean flags get value `true`. */
function parseFlags(args) {
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

/** Resolve project dir and session id from environment (injectable for tests). */
function resolveContext() {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  const sessionId =
    process.env.JOURNAL_SESSION_ID ||
    process.env.CLAUDE_CODE_SESSION_ID ||
    'default'
  return { projectDir, sessionId }
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

const HELP = {
  append: {
    summary: 'append one event to the journal shard for this session',
    usage: 'journal append --motive <id> --type <T> --msg <M> [--data <json>]',
    flags: [
      '--motive <id>  motive identifier (required; --rfc is a deprecated alias)',
      '--type <T>     event type (required)',
      '--msg <M>      human-readable message (required)',
      '--data <json>  optional extra data as a JSON object',
      '',
      `Valid types: ${VALID_TYPES.join(', ')}`,
    ],
  },
  show: {
    summary: 'query journal events with defaults: --since 7d --last 30',
    usage: 'journal show [--motive <id>] [--type T[,T]] [--since <date|Nd>] [--last N] [--brief]',
    flags: [
      '--motive <id>      filter by motive id (--rfc is a deprecated alias)',
      '--type T[,T]       filter by event type (comma-separated)',
      '--since <date|Nd>  filter events at or after date (e.g. 7d, 2026-07-01)',
      '--last N           emit only the N most recent matching events (default 30)',
      '--brief            emit at most 2 lines per event (~32 tok/event)',
    ],
  },
  digest: {
    summary: 'emit digest summary of prefix + verbatim tail for a motive',
    usage: 'journal digest --motive <id> [--rebuild]',
    flags: [
      '--motive <id>  motive identifier (required; --rfc is a deprecated alias)',
      '--rebuild      force rebuild of digest from source',
    ],
  },
}

function cmdHelp(args) {
  if (args.length) {
    const cmd = args[0]
    const h = HELP[cmd]
    if (!h) die(`unknown command "${cmd}". Run journal help for a list.`, 2)
    const lines = [`Usage: ${h.usage}`, `  ${h.summary}`]
    if (h.flags.length) {
      lines.push('', 'Flags:')
      h.flags.forEach(f => lines.push(`  ${f}`))
    }
    process.stdout.write(lines.join('\n') + '\n')
    return
  }
  const cmds = Object.entries(HELP)
    .map(([name, h]) => `  ${name.padEnd(10)} ${h.summary}`)
    .join('\n')
  process.stdout.write([
    'Usage: journal <command> [args] [flags]',
    '',
    'Commands:',
    cmds,
    '',
    'Run `journal help <command>` for per-command details.',
    'Exit codes: 0 success  1 operational failure  2 usage error',
  ].join('\n') + '\n')
}

// ---------------------------------------------------------------------------
// append
// ---------------------------------------------------------------------------

function cmdAppend(args) {
  const { flags } = parseFlags(args)
  const { type, msg } = flags

  // --motive is primary; --rfc is a deprecated alias
  let rfc = flags.motive
  if (!rfc && flags.rfc) {
    process.stderr.write(
      'journal: --rfc is deprecated; use --motive instead\n',
    )
    rfc = flags.rfc
  }

  if (!rfc || !type || !msg) {
    die('append requires --motive (or deprecated --rfc), --type, and --msg', 2)
  }

  if (!VALID_TYPES.includes(type)) {
    process.stderr.write(`journal: invalid --type "${type}". Valid types:\n`)
    for (const t of VALID_TYPES) process.stderr.write(`  ${t}\n`)
    process.exit(2)
  }

  let data
  if (flags.data && flags.data !== true) {
    try {
      data = JSON.parse(flags.data)
    } catch (e) {
      die(`--data is not valid JSON: ${e.message}`, 2)
    }
  }

  const { projectDir, sessionId } = resolveContext()
  const ts = new Date().toISOString()
  const event = { ts, session: sessionId, rfc, type, msg }
  if (data !== undefined) event.data = data

  const shardPath = resolveShardPath(projectDir, sessionId)
  appendEvent(shardPath, event)
  process.stdout.write(
    `journal: appended ${type} to ${path.relative(projectDir, shardPath)}\n`,
  )
}

// ---------------------------------------------------------------------------
// show
// ---------------------------------------------------------------------------

function formatEventFull(event) {
  const lines = [
    `[${event.ts ?? '?'}] ${event.type ?? '?'} | rfc:${event.rfc ?? '—'} | session:${event.session ?? '—'}`,
    `  ${event.msg ?? ''}`,
  ]
  if (event.data !== undefined) {
    lines.push(`  data: ${JSON.stringify(event.data)}`)
  }
  return lines.join('\n')
}

function formatEventBrief(event) {
  // at most 2 lines (AC 7)
  const ts = (event.ts ?? '').slice(0, 16).replace('T', ' ')
  const msg = String(event.msg ?? '').slice(0, 120)
  return `[${ts}] ${event.type ?? '?'}: ${msg}`
}

function cmdShow(args) {
  const { flags } = parseFlags(args)
  const { projectDir } = resolveContext()
  const journalDir = path.join(projectDir, '.groundwork', 'journal')

  const allEvents = readAllEvents(journalDir)

  // Resolve --motive / --rfc (deprecated alias)
  let motiveFilter = flags.motive
  if (!motiveFilter && flags.rfc) {
    process.stderr.write('journal: --rfc is deprecated; use --motive instead\n')
    motiveFilter = flags.rfc
  }

  // Default windowing (AC 6):
  //   without --motive/--rfc and without --since → imply --since 7d
  //   --last always defaults to 30
  const hasSince = flags.since != null
  const hasRfc = motiveFilter != null
  const since = hasSince ? flags.since : (!hasRfc ? '7d' : undefined)
  const last = flags.last != null ? parseInt(String(flags.last), 10) : 30

  const { shown, withheld } = filterEvents(allEvents, {
    rfc: motiveFilter,
    type: flags.type,
    since,
    last,
  })

  const brief = 'brief' in flags

  for (const event of shown) {
    process.stdout.write(
      (brief ? formatEventBrief(event) : formatEventFull(event)) + '\n',
    )
  }

  // Footer for withheld events (AC 6)
  if (withheld > 0) {
    const sincePart = since ? `, --since ${since}` : ''
    process.stdout.write(
      `\n… ${withheld} older events not shown (--last ${last}${sincePart}). Narrow with --rfc/--type.\n`,
    )
  }
}

// ---------------------------------------------------------------------------
// digest
// ---------------------------------------------------------------------------

/**
 * Build a digest object from a prefix slice.
 * DECISION and SPEC_CHANGE events are never folded into the summary text (AC 9);
 * they are listed verbatim in the preserved section instead.
 */
function buildDigest(prefixEvents, watermark, rfc) {
  const compressible = prefixEvents.filter(e => !NEVER_COMPRESS.has(e.type))
  const preserved = prefixEvents.filter(e => NEVER_COMPRESS.has(e.type))

  const typeCounts = {}
  for (const e of compressible) {
    typeCounts[e.type] = (typeCounts[e.type] || 0) + 1
  }

  const summaryLines = [
    `RFC: ${rfc} | Summarized events: ${compressible.length}`,
    ...Object.entries(typeCounts).map(([t, n]) => `  ${t}: ${n} event(s)`),
  ]

  if (preserved.length > 0) {
    summaryLines.push('', 'Preserved verbatim (DECISION / SPEC_CHANGE — never compressed):')
    for (const e of preserved) {
      summaryLines.push(`  [${e.ts}] ${e.type}: ${e.msg}`)
      if (e.data !== undefined) {
        summaryLines.push(`    data: ${JSON.stringify(e.data)}`)
      }
    }
  }

  return {
    rfc,
    watermark,
    built_at: new Date().toISOString(),
    summary: summaryLines.join('\n'),
  }
}

function cmdDigest(args) {
  const { flags } = parseFlags(args)
  let rfc = flags.motive
  if (!rfc && flags.rfc) {
    process.stderr.write('journal: --rfc is deprecated; use --motive instead\n')
    rfc = flags.rfc
  }
  if (!rfc || rfc === true) die('digest requires --motive (or deprecated --rfc)', 2)

  const { projectDir } = resolveContext()
  const journalDir = path.join(projectDir, '.groundwork', 'journal')

  const allEvents = readAllEvents(journalDir)
  const rfcEvents = allEvents.filter(e => e.rfc === rfc)

  if (rfcEvents.length === 0) {
    process.stdout.write(`No journal events found for RFC ${rfc}\n`)
    return
  }

  // Digest store: .groundwork/rfcs/<rfc>/notes/.digest.json
  const digestPath = path.join(
    projectDir, '.groundwork', 'rfcs', rfc, 'notes', '.digest.json',
  )

  const rebuild = 'rebuild' in flags

  // Load stored digest (unless --rebuild)
  let digest = null
  if (!rebuild) {
    try {
      digest = JSON.parse(readFileSync(digestPath, 'utf8'))
    } catch {
      digest = null
    }
  }

  // Decide split: events in prefix (≤ watermark) and events in tail (> watermark)
  const TAIL_TRIGGER = 60
  const TAIL_KEEP = 30

  let watermark = digest?.watermark ?? null
  let prefixEvents = watermark
    ? rfcEvents.filter(e => e.ts <= watermark)
    : []
  let tailEvents = watermark
    ? rfcEvents.filter(e => e.ts > watermark)
    : rfcEvents

  // Fold tail into prefix when it exceeds trigger, or on --rebuild
  if (tailEvents.length > TAIL_TRIGGER || rebuild) {
    const toFold = Math.max(0, tailEvents.length - TAIL_KEEP)
    const newPrefix = [...prefixEvents, ...tailEvents.slice(0, toFold)]
    tailEvents = tailEvents.slice(toFold)
    watermark = newPrefix.length > 0
      ? newPrefix[newPrefix.length - 1].ts
      : null
    prefixEvents = newPrefix
    digest = buildDigest(prefixEvents, watermark, rfc)
    try {
      mkdirSync(path.dirname(digestPath), { recursive: true })
      writeFileSync(digestPath, JSON.stringify(digest, null, 2) + '\n')
    } catch {
      // non-fatal — digest is always regenerable from source
    }
  }

  // Emit summary section (AC 8)
  if (digest?.summary) {
    process.stdout.write(
      `--- DIGEST SUMMARY (through ${digest.watermark}) ---\n`,
    )
    process.stdout.write(digest.summary + '\n')
    // Recovery command for summarized range (AC 10)
    process.stdout.write('\nTo retrieve ground truth for the summarized range:\n')
    process.stdout.write(
      `  journal show --rfc ${rfc} --since 9999d --last 9999\n\n`,
    )
  }

  // Emit verbatim tail (AC 8)
  if (tailEvents.length > 0) {
    process.stdout.write(
      `--- VERBATIM TAIL (${tailEvents.length} event(s)) ---\n`,
    )
    for (const event of tailEvents) {
      process.stdout.write(formatEventFull(event) + '\n')
    }
  } else if (!digest?.summary) {
    // No digest threshold reached — emit everything verbatim
    for (const event of rfcEvents) {
      process.stdout.write(formatEventFull(event) + '\n')
    }
  }

  // Watermark + recovery command always printed when a digest exists (AC 10)
  if (watermark) {
    process.stdout.write(`\nWatermark: ${watermark}\n`)
    process.stdout.write(
      `Recovery command: journal show --rfc ${rfc} --since 9999d --last 9999\n`,
    )
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2)
  const [cmd, ...rest] = argv

  if (!cmd || cmd === '-h' || cmd === '--help') { cmdHelp([]); return }
  if (cmd === 'help') { cmdHelp(rest); return }

  const { flags } = parseFlags(rest)
  if ('help' in flags) { cmdHelp([cmd]); return }

  try {
    switch (cmd) {
      case 'append': return cmdAppend(rest)
      case 'show':   return cmdShow(rest)
      case 'digest': return cmdDigest(rest)
      default:
        die(`unknown command "${cmd}". Run journal help for a list.`, 2)
    }
  } catch (e) {
    die(e?.message ?? String(e), e?.exitCode ?? 1)
  }
}

main()
