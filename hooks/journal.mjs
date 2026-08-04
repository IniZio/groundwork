#!/usr/bin/env node
/**
 * journal — append-only event log CLI.
 *
 * Usage:
 *   journal append --motive <id> --type <T> --msg <M> [--data <json>]
 *   journal show [--motive <id>] [--type T[,T]] [--since <date|Nd>] [--last N] [--brief]
 *   journal digest --motive <id> [--rebuild]
 *   journal compile <motive> [--at <ord>] [--json] [--stdout] [--force] [--no-ground-truth]
 *   journal help [<cmd>]
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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import {
  VALID_TYPES,
  NEVER_COMPRESS,
  eventMotive,
  resolveShardPath,
  appendEvent,
  readAllEvents,
  filterEvents,
} from './lib/journal-io.mjs'
import { readOrderedEvents } from './lib/journal-order.mjs'
import { compile, COMPILER_VERSION } from './lib/motive-compile.mjs'
import { collectGroundTruth } from './lib/motive-ground-truth.mjs'
import { buildHumanLayer, renderView } from './lib/motive-render.mjs'
import { readCharter, charterPath, renderCharterTemplate } from './lib/motive-charter.mjs'
import { resolveBaseline } from './lib/motive-baseline.mjs'
import { renderHtml } from './lib/motive-html.mjs'
import { regenerateMotiveMap } from './lib/motive-map.mjs'

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
      '--motive <id>  motive identifier (required)',
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
      '--motive <id>      filter by motive id',
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
      '--motive <id>  motive identifier (required)',
      '--rebuild      force rebuild of digest from source',
    ],
  },
  compile: {
    summary: 'compile a motive\'s journal events into a versioned spec view',
    usage: 'journal compile <motive> [--at <ord|name>] [--html] [--tbd] [--json] [--stdout] [--force] [--no-ground-truth] [--ledger <path>]',
    flags: [
      '<motive>           motive identifier (required positional)',
      '--at <ord|name>    fold only events 1..N; accepts a positive integer or a baseline name',
      '--html             write an HTML dashboard alongside the .json/.md files',
      '--tbd              print count of open TBD/TBR items from the charter (warn-only)',
      '--json             print only the JSON payload to stdout',
      '--stdout           print without writing .groundwork/compiled/ files',
      '--force            overwrite even if compiler_version mismatches',
      '--no-ground-truth  skip ground-truth collection (divergence_checked: false)',
      '--ledger <path>    use this ledger file for ground-truth instead of scanning $CLAUDE_PROJECT_DIR',
      '',
      `Compiler version: ${COMPILER_VERSION}`,
    ],
  },
  motive: {
    summary: 'manage motives (charters and lifecycle events)',
    usage: 'journal motive new <slug> [--objective "…"] [--force]',
    flags: [
      'new <slug>         create a motive charter at .groundwork/motives/<slug>/motive.md',
      '--objective "…"   initial objective text written into the charter',
      '--force            overwrite an existing charter',
    ],
  },
  baseline: {
    summary: 'record a named baseline pin for a motive',
    usage: 'journal baseline <name> --motive <slug>',
    flags: [
      '<name>         baseline name (required positional)',
      '--motive <id>  motive identifier (required)',
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
// compile helpers
// ---------------------------------------------------------------------------

/**
 * Injective path-safe slug for a motive id (D5).
 *
 * Algorithm:
 *   1. Escape literal `~` → `~007e` (must be first, to prevent double-escaping).
 *   2. Replace every remaining disallowed character with `~` + exactly 4
 *      lowercase hex digits (codePointAt). Allowed: A-Z a-z 0-9 . _ - (and `~`
 *      after step 1 is already encoded).
 *   3. Code points > 0xFFFF (astral plane) are rejected — exit 2.
 *
 * Fixed-width (4 hex) makes the encoding injective: `!92` and `→` (U+2192)
 * cannot collide because `!` → `~0021` and `→` → `~2192` (each exactly 4 hex
 * digits), and `92` are ordinary literal chars — `~0021 9 2` ≠ `~2192`.
 */
function motiveSlug(motive) {
  // Detect astral-plane code points (> 0xFFFF) before encoding
  for (const ch of motive) {
    const cp = ch.codePointAt(0)
    if (cp != null && cp > 0xffff) {
      die(`motive id contains an unsupported character (U+${cp.toString(16).toUpperCase().padStart(4, '0')})`, 2)
    }
  }
  return motive
    .replace(/~/g, '~007e')
    .replace(/[^A-Za-z0-9._~-]/gu, (c) => {
      const cp = c.codePointAt(0)
      return '~' + (cp != null ? cp : 0).toString(16).padStart(4, '0')
    })
}

async function cmdCompile(args) {
  const { flags, positionals } = parseFlags(args)
  const motive = positionals[0]
  if (!motive) die('compile requires a motive id', 2)

  const { projectDir } = resolveContext()
  const journalDir = path.join(projectDir, '.groundwork', 'journal')

  // Parse --at — numeric ordinal or baseline name (resolved after reading events)
  let atOrd = undefined
  let atName = undefined
  if (flags.at === true) {
    die('--at requires a value: a positive integer ordinal or a baseline name', 2)
  } else if (flags.at !== undefined) {
    const atStr = String(flags.at)
    if (/^\d+$/.test(atStr)) {
      const atNum = Number(atStr)
      if (!Number.isInteger(atNum) || atNum <= 0) {
        die('--at ordinal must be a positive integer', 2)
      }
      atOrd = atNum
    } else {
      atName = atStr  // resolve after reading events
    }
  }

  // Read events for this motive
  const { events, malformed_lines } = readOrderedEvents(journalDir, { motive })

  if (events.length === 0) {
    die(`no events found for motive "${motive}"`)
  }

  // Resolve named baseline
  if (atName !== undefined) {
    const pin = resolveBaseline(events, atName)
    if (pin === null) {
      const knownNames = events
        .filter(e => e.type === 'BASELINE' && e.data?.name)
        .map(e => String(e.data.name))
      const list = knownNames.length ? knownNames.join(', ') : '(none)'
      die(`baseline "${atName}" not found. Known baselines: ${list}`, 2)
    }
    atOrd = pin.ord
  }

  // Validate --at range (per-motive)
  if (atOrd !== undefined && atOrd > events.length) {
    die(`--at ${atOrd} is out of range; motive "${motive}" has ${events.length} events (valid: 1-${events.length}).`, 2)
  }

  // Read charter for join (S1-AC7); null when no charter exists or stub not yet implemented
  const charter = readCharter({ projectDir, motive })

  // Collect ground truth (unless --no-ground-truth)
  const noGroundTruth = 'no-ground-truth' in flags
  const ledgerOverride = typeof flags.ledger === 'string' ? flags.ledger : null
  let groundTruth = undefined
  if (!noGroundTruth) {
    groundTruth = await collectGroundTruth({ projectDir, events, motive, ledgerPath: ledgerOverride })
  }

  // Compile
  const rawView = compile(events, {
    at: atOrd,
    groundTruth,
    malformedLines: malformed_lines,
    charter,
  })
  // Inject motive into provenance so buildHumanLayer/renderView can reference it
  const viewWithMotive = Object.assign({}, rawView, {
    provenance: Object.assign({}, rawView.provenance, { motive }),
  })
  const view = Object.assign({}, viewWithMotive, { human: buildHumanLayer(viewWithMotive) })

  const slug = motiveSlug(motive)
  const compiledDir = path.join(projectDir, '.groundwork', 'compiled')
  const jsonPath = path.join(compiledDir, `${slug}.json`)
  const mdPath = path.join(compiledDir, `${slug}.md`)

  const jsonOut = JSON.stringify(
    Object.assign({ _generated: `regenerate with 'journal compile ${motive}'` }, view),
    null,
    2,
  ) + '\n'
  const mdOut = renderView(view)

  const toStdout = 'stdout' in flags
  const asJson = 'json' in flags
  const force = 'force' in flags
  const asHtml = 'html' in flags
  const showTbd = 'tbd' in flags

  // Version-mismatch check (D2) — on default path only (not --stdout, and applies regardless of --json)
  if (!toStdout) {
    let existing = null
    try {
      existing = JSON.parse(readFileSync(jsonPath, 'utf8'))
    } catch {
      // no existing file — fine
    }
    if (!force && existing && existing.compiler_version != null && existing.provenance?.compiler_version != null &&
        existing.compiler_version !== existing.provenance.compiler_version) {
      process.stderr.write(
        `journal compile: compiled view for "${motive}" has inconsistent compiler_version values: ` +
        `top-level is ${existing.compiler_version} but provenance.compiler_version is ${existing.provenance.compiler_version}. ` +
        `The file is corrupt — delete it and recompile.\n` +
        `  to recompile from the event stream:  journal compile ${motive} --force\n`,
      )
      process.exit(1)
    }
    if (existing && existing.compiler_version && existing.compiler_version !== COMPILER_VERSION && !force) {
      process.stderr.write(
        `journal compile: compiled view for "${motive}" was produced by ${existing.compiler_version} but this\n` +
        `binary is ${COMPILER_VERSION}. A view compiled by a different compiler is not comparable.\n` +
        `  to recompile from the event stream:  journal compile ${motive} --force\n` +
        `  to inspect the stale view as-is:     cat ${path.relative(projectDir, jsonPath)}\n`,
      )
      process.exit(1)
    }
  }

  if (asJson) {
    process.stdout.write(jsonOut)
  } else {
    process.stdout.write(mdOut + '\n')
  }

  if (!toStdout) {
    mkdirSync(compiledDir, { recursive: true })
    writeFileSync(jsonPath, jsonOut)
    writeFileSync(mdPath, mdOut + '\n')
    // --html: write dashboard alongside .json/.md
    if (asHtml) {
      const htmlOut = renderHtml(view)
      const htmlPath = path.join(compiledDir, `${slug}.html`)
      writeFileSync(htmlPath, htmlOut)
    }
    regenerateMotiveMap(projectDir, motive)
  }

  // --tbd: warn-only open-items count (never affects exit code)
  if (showTbd) {
    const openItems = charter?.open_items ?? []
    process.stderr.write(`journal: open TBD/TBR items: ${openItems.length}\n`)
  }
}

// ---------------------------------------------------------------------------
// motive new
// ---------------------------------------------------------------------------

function cmdMotiveNew(args) {
  const { flags, positionals } = parseFlags(args)
  const slug = positionals[0]
  if (!slug) die('motive new requires a <slug>', 2)

  const objective = typeof flags.objective === 'string' ? flags.objective : ''
  const { projectDir, sessionId } = resolveContext()

  const filePath = charterPath(projectDir, slug)

  if (existsSync(filePath) && !flags.force) {
    die(`charter already exists for "${slug}". Use --force to overwrite.`, 1)
  }

  const alreadyExisted = existsSync(filePath)
  mkdirSync(path.dirname(filePath), { recursive: true })
  const content = renderCharterTemplate({ motive: slug, objective })
  writeFileSync(filePath, content)

  // Emit MOTIVE_CREATED only for new motives, not for --force overwrites
  if (!alreadyExisted) {
    const ts = new Date().toISOString()
    const shardPath = resolveShardPath(projectDir, sessionId)
    const event = {
      ts,
      session: sessionId,
      motive: slug,
      type: 'MOTIVE_CREATED',
      msg: `motive created: ${slug}`,
      source: 'cli:journal',
      data: { objective },
    }
    appendEvent(shardPath, event)
  }

  process.stdout.write(
    `journal: created motive "${slug}" at ${path.relative(projectDir, filePath)}\n`,
  )
}

function cmdMotive(args) {
  const subcmd = args[0]
  if (!subcmd) die('motive requires a subcommand (e.g. new)', 2)
  if (subcmd === 'new') return cmdMotiveNew(args.slice(1))
  die(`unknown motive subcommand "${subcmd}". Run journal help motive for usage.`, 2)
}

// ---------------------------------------------------------------------------
// baseline
// ---------------------------------------------------------------------------

function cmdBaseline(args) {
  const { flags, positionals } = parseFlags(args)
  const name = positionals[0]
  if (!name) die('baseline requires a <name>', 2)

  const motive = flags.motive
  if (!motive || motive === true) die('baseline requires --motive <slug>', 2)

  const { projectDir, sessionId } = resolveContext()
  const journalDir = path.join(projectDir, '.groundwork', 'journal')

  // Warn on duplicate (latest wins per S4-AC2)
  const { events } = readOrderedEvents(journalDir, { motive })
  const duplicates = events.filter(e => e.type === 'BASELINE' && e.data?.name === name)
  if (duplicates.length > 0) {
    process.stderr.write(
      `journal: baseline "${name}" already exists for motive "${motive}"; writing again (latest wins)\n`,
    )
  }

  const shardPath = resolveShardPath(projectDir, sessionId)
  const shard = path.basename(shardPath)
  const ts = new Date().toISOString()
  const event = {
    ts,
    session: sessionId,
    motive,
    type: 'BASELINE',
    msg: `baseline: ${name}`,
    source: 'cli:journal',
    data: { name, shard },
  }
  appendEvent(shardPath, event)

  process.stdout.write(
    `journal: baseline "${name}" recorded for motive "${motive}" in ${shard}\n`,
  )
}

// ---------------------------------------------------------------------------
// append
// ---------------------------------------------------------------------------

function cmdAppend(args) {
  const { flags } = parseFlags(args)
  const { type, msg } = flags

  const motive = flags.motive
  if (!motive || !type || !msg) {
    die('append requires --motive, --type, and --msg', 2)
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
  const event = { ts, session: sessionId, motive, type, msg, source: 'cli:journal' }
  if (data !== undefined) event.data = data

  const shardPath = resolveShardPath(projectDir, sessionId)
  appendEvent(shardPath, event)
  regenerateMotiveMap(projectDir, motive)
  process.stdout.write(
    `journal: appended ${type} to ${path.relative(projectDir, shardPath)}\n`,
  )
}

// ---------------------------------------------------------------------------
// show
// ---------------------------------------------------------------------------

function formatEventFull(event) {
  const motive = eventMotive(event) ?? '—'
  const lines = [
    `[${event.ts ?? '?'}] ${event.type ?? '?'} | motive:${motive} | session:${event.session ?? '—'}`,
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

  const motiveFilter = flags.motive

  // Default windowing (AC 6):
  //   without --motive and without --since → imply --since 7d
  //   --last always defaults to 30
  const hasSince = flags.since != null
  const hasMotive = motiveFilter != null
  const since = hasSince ? flags.since : (!hasMotive ? '7d' : undefined)
  const last = flags.last != null ? parseInt(String(flags.last), 10) : 30

  const { shown, withheld } = filterEvents(allEvents, {
    motive: motiveFilter,
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
      `\n… ${withheld} older events not shown (--last ${last}${sincePart}). Narrow with --motive/--type.\n`,
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
  const rfc = flags.motive
  if (!rfc || rfc === true) die('digest requires --motive', 2)

  const { projectDir } = resolveContext()
  const journalDir = path.join(projectDir, '.groundwork', 'journal')

  const allEvents = readAllEvents(journalDir)
  const rfcEvents = allEvents.filter(e => eventMotive(e) === rfc)

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
      `  journal show --motive ${rfc} --since 9999d --last 9999\n\n`,
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
      `Recovery command: journal show --motive ${rfc} --since 9999d --last 9999\n`,
    )
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2)
  const [cmd, ...rest] = argv

  if (!cmd || cmd === '-h' || cmd === '--help') { cmdHelp([]); return }
  if (cmd === 'help') { cmdHelp(rest); return }

  const { flags } = parseFlags(rest)
  if ('help' in flags) { cmdHelp([cmd]); return }

  try {
    switch (cmd) {
      case 'append':   return cmdAppend(rest)
      case 'show':     return cmdShow(rest)
      case 'digest':   return cmdDigest(rest)
      case 'compile':  return await cmdCompile(rest)
      case 'motive':   return cmdMotive(rest)
      case 'baseline': return cmdBaseline(rest)
      default:
        die(`unknown command "${cmd}". Run journal help for a list.`, 2)
    }
  } catch (e) {
    die(e?.message ?? String(e), e?.exitCode ?? 1)
  }
}

main()
