#!/usr/bin/env node
/**
 * motive-ticket — scaffold, list, and lint ticket documents.
 *
 * Usage:
 *   motive-ticket create --type <T> --slug <S> --motive <id> [<ordinal>]
 *   motive-ticket list [--motive <id>]
 *   motive-ticket lint [--motive <id>] [<file>]
 *   motive-ticket help [<cmd>]
 *
 * Ticket types (controlled vocabulary): research, choose, model, build, grill, spec, fix, chore
 * Naming convention: NN-type-slug.md (2-digit ordinal)
 *
 * Exit codes: 0 success  1 operational failure  2 usage error
 *
 * Project dir resolution:
 *   1. CLAUDE_PROJECT_DIR env var
 *   2. process.cwd()
 */

import path from 'node:path'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import {
  parseTicket,
  writeTicket,
  resolveTicketPath,
} from './lib/motive-ticket-doc.mjs'

const TICKET_TYPES = ['research', 'choose', 'model', 'build', 'grill', 'spec', 'fix', 'chore']

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function die(msg, code = 1) {
  process.stderr.write(`motive-ticket: ${msg}\n`)
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

/** Resolve project dir from environment (injectable for tests). */
function resolveContext() {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  return { projectDir }
}

function resolveMotiveDir(projectDir, slug) {
  return path.join(projectDir, '.groundwork', 'motives', slug)
}

function resolveTicketsDir(mDir) {
  return path.join(mDir, 'tickets')
}

/** List all .md files in a tickets directory (sorted). Returns [] if dir absent. */
function listTicketFiles(tDir) {
  if (!existsSync(tDir)) return []
  return readdirSync(tDir)
    .filter((f) => f.endsWith('.md'))
    .sort()
}

/** Detect next available 2-digit ordinal from existing ticket filenames. */
function nextOrdinal(tDir) {
  const files = listTicketFiles(tDir)
  let max = 0
  for (const f of files) {
    const m = /^(\d+)-/.exec(f)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return max + 1
}

/** Quick parse: extract title (h1), type, and status from a ticket file. */
function quickParse(filePath) {
  try {
    const content = readFileSync(filePath, 'utf8')
    const titleMatch = /^#\s+(.+)$/m.exec(content)
    const typeMatch = /^Type:\s*(.+)$/m.exec(content)
    const statusMatch = /^Status:\s*(.+)$/m.exec(content)
    return {
      title: titleMatch ? titleMatch[1].trim() : '(unknown)',
      type: typeMatch ? typeMatch[1].trim() : '(unknown)',
      status: statusMatch ? statusMatch[1].trim() : '(unknown)',
    }
  } catch {
    return { title: '(unreadable)', type: '(unreadable)', status: '(unreadable)' }
  }
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

const HELP = {
  create: {
    usage: 'motive-ticket create --type <T> --slug <S> --motive <id> [<ordinal>]',
    summary: 'Scaffold a new ticket stub (refuses to overwrite an existing ticket)',
    flags: [
      '--type <T>      ticket type (' + TICKET_TYPES.join('|') + ')',
      '--slug <S>      short identifier for the ticket (kebab-case recommended)',
      '--motive <id>   motive slug (required)',
      '<ordinal>       2-digit ordinal override (auto-detected from existing tickets if omitted)',
    ],
  },
  list: {
    usage: 'motive-ticket list [--motive <id>]',
    summary: 'List existing tickets with path, type, status, and title',
    flags: [
      '--motive <id>   motive slug (lists all motives if omitted)',
    ],
  },
  lint: {
    usage: 'motive-ticket lint [--motive <id>] [<file>]',
    summary: 'Validate ticket(s) — checks required sections are present and non-empty',
    flags: [
      '--motive <id>   motive slug (lint all tickets in that motive)',
      '<file>          path to a specific ticket file (takes precedence over --motive)',
    ],
  },
}

function cmdHelp(args) {
  if (args.length) {
    const cmd = args[0]
    const h = HELP[cmd]
    if (!h) die(`unknown command "${cmd}". Run motive-ticket help for a list.`, 2)
    const lines = [`Usage: ${h.usage}`, `  ${h.summary}`]
    if (h.flags.length) {
      lines.push('', 'Flags:')
      h.flags.forEach((f) => lines.push(`  ${f}`))
    }
    process.stdout.write(lines.join('\n') + '\n')
    return
  }
  const cmds = Object.entries(HELP)
    .map(([name, h]) => `  ${name.padEnd(8)} ${h.summary}`)
    .join('\n')
  process.stdout.write(
    [
      'Usage: motive-ticket <command> [args] [flags]',
      '',
      'Commands:',
      cmds,
      '',
      'Run `motive-ticket help <command>` for per-command details.',
      'Exit codes: 0 success  1 operational failure  2 usage error',
    ].join('\n') + '\n',
  )
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

async function cmdCreate(args) {
  const { flags, positionals } = parseFlags(args)

  const type = flags.type
  const slug = flags.slug
  const motiveSlug = flags.motive

  if (!type || type === true) die('create requires --type <T>', 2)
  if (!slug || slug === true) die('create requires --slug <S>', 2)
  if (!motiveSlug || motiveSlug === true) die('create requires --motive <id>', 2)

  // ordinal: optional positional — auto-detect from existing files if absent
  let ordinal
  if (positionals[0] !== undefined) {
    const n = parseInt(positionals[0], 10)
    if (isNaN(n) || n < 1) die(`invalid ordinal "${positionals[0]}" — must be a positive integer`, 2)
    ordinal = n
  }

  const { projectDir } = resolveContext()
  const mDir = resolveMotiveDir(projectDir, motiveSlug)
  if (!existsSync(mDir)) die(`motive "${motiveSlug}" not found at ${mDir}`, 1)

  const tDir = resolveTicketsDir(mDir)
  if (ordinal === undefined) {
    // Check if a ticket with this type+slug already exists (any ordinal).
    // If so, re-use that ordinal so writeTicket's refuse-overwrite fires and
    // the operation is idempotent (D-77: second create is byte-identical/refused).
    const suffix = `-${type}-${slug}.md`
    const existing = listTicketFiles(tDir).find((f) => f.endsWith(suffix))
    if (existing) {
      const m = /^(\d+)-/.exec(existing)
      ordinal = m ? parseInt(m[1], 10) : nextOrdinal(tDir)
    } else {
      ordinal = nextOrdinal(tDir)
    }
  }

  const ordinalStr = String(ordinal).padStart(2, '0')
  const ticketId = `${ordinalStr}-${type}-${slug}`

  // Resolve path via library (charter=null → default tickets/ dir)
  const ticketPath = resolveTicketPath(null, mDir, ticketId)

  // Humanise slug for the title
  const title = slug.replace(/-/g, ' ')

  const { written } = await writeTicket(ticketPath, { title, type })

  if (written) {
    process.stdout.write(`motive-ticket: created ${path.relative(projectDir, ticketPath)}\n`)
  } else {
    process.stdout.write(
      `motive-ticket: already exists, not overwritten: ${path.relative(projectDir, ticketPath)}\n`,
    )
  }
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

function cmdList(args) {
  const { flags } = parseFlags(args)
  const { projectDir } = resolveContext()

  let motives
  if (flags.motive && flags.motive !== true) {
    motives = [flags.motive]
  } else {
    const motivesRoot = path.join(projectDir, '.groundwork', 'motives')
    if (!existsSync(motivesRoot)) {
      process.stdout.write('motive-ticket: no motives directory found\n')
      return
    }
    motives = readdirSync(motivesRoot).filter((d) =>
      existsSync(path.join(motivesRoot, d, 'tickets')),
    )
    if (motives.length === 0) {
      process.stdout.write('motive-ticket: no motives with tickets found\n')
      return
    }
  }

  let found = false
  for (const m of motives) {
    const mDir = resolveMotiveDir(projectDir, m)
    const tDir = resolveTicketsDir(mDir)
    const files = listTicketFiles(tDir)
    for (const f of files) {
      const absPath = path.join(tDir, f)
      const { title, type, status } = quickParse(absPath)
      process.stdout.write(
        `${path.relative(projectDir, absPath)}\t${type}\t${status}\t${title}\n`,
      )
      found = true
    }
  }

  if (!found) {
    process.stdout.write('motive-ticket: no tickets found\n')
  }
}

// ---------------------------------------------------------------------------
// lint
// ---------------------------------------------------------------------------

function lintFile(filePath) {
  let content
  try {
    content = readFileSync(filePath, 'utf8')
  } catch (e) {
    process.stderr.write(`motive-ticket: cannot read ${filePath}: ${e.message}\n`)
    return false
  }
  const { emptySections } = parseTicket(content)
  if (emptySections.length === 0) {
    process.stdout.write(`OK   ${filePath}\n`)
    return true
  }
  process.stdout.write(`FAIL ${filePath}\n`)
  for (const s of emptySections) {
    process.stdout.write(`       empty section: ${s}\n`)
  }
  return false
}

function cmdLint(args) {
  const { flags, positionals } = parseFlags(args)
  const { projectDir } = resolveContext()

  // If a specific file is given, lint only that file
  if (positionals[0]) {
    const filePath = path.resolve(positionals[0])
    const ok = lintFile(filePath)
    if (!ok) process.exit(1)
    return
  }

  // Otherwise collect motives to lint
  let motives
  if (flags.motive && flags.motive !== true) {
    motives = [flags.motive]
  } else {
    const motivesRoot = path.join(projectDir, '.groundwork', 'motives')
    if (!existsSync(motivesRoot)) {
      process.stdout.write('motive-ticket: no motives directory found\n')
      return
    }
    motives = readdirSync(motivesRoot).filter((d) =>
      existsSync(path.join(motivesRoot, d, 'tickets')),
    )
  }

  if (motives.length === 0) {
    process.stdout.write('motive-ticket: no tickets to lint\n')
    return
  }

  let allOk = true
  for (const m of motives) {
    const mDir = resolveMotiveDir(projectDir, m)
    const tDir = resolveTicketsDir(mDir)
    const files = listTicketFiles(tDir)
    for (const f of files) {
      const absPath = path.join(tDir, f)
      if (!lintFile(absPath)) allOk = false
    }
  }

  if (!allOk) process.exit(1)
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const [, , cmd, ...rest] = process.argv

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  cmdHelp(rest)
} else if (cmd === 'create') {
  cmdCreate(rest).catch((e) => die(e.message))
} else if (cmd === 'list') {
  cmdList(rest)
} else if (cmd === 'lint') {
  cmdLint(rest)
} else {
  die(`unknown command "${cmd}". Run motive-ticket help for a list.`, 2)
}
