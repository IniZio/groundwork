#!/usr/bin/env node
/**
 * Groundwork doc CLI — progressive-disclosure retrieval for narrative docs.
 *
 * Subcommands:
 *   toc <path>                      — list section anchors (no body emitted)
 *   show <path> --section <anchor>  — show one named section + whole-file token cost
 *   show <path> --brief             — show summary header block (≤ 8 lines)
 *   search <q> [--limit N]          — full-text search across doc-class files (default --limit 8)
 *   lint                            — check all doc-class files against class budgets
 *
 * Exit codes: 0 success  1 operational failure  2 usage error
 *
 * READ-ONLY guarantee (AC 8): this CLI never opens any file for writing,
 * appending, or truncating. All file access is read-only.
 *
 * Doc-class table (DERIVED — see hooks/lib/doc-io.mjs for full rationale):
 *   root-doc   {CLAUDE,AGENTS,README}.md at repo root   12 000 tokens
 *   skill      skills/** /SKILL.md                        6 000 tokens
 *   plan       .groundwork/plans/** /*.md                  3 000 tokens
 *   narrative  doc/*.md (top-level only)                   2 000 tokens
 */

import { existsSync, openSync, readSync, closeSync } from 'node:fs'
import { resolve, relative, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  estimateTokens,
  parseSections,
  extractSummaryHeader,
  checkStructure,
  findDocFiles,
  searchDocs,
  classifyDoc,
  DOC_CLASSES,
} from './lib/doc-io.mjs'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function die(msg, code = 1) {
  process.stderr.write(`doc: ${msg}\n`)
  process.exit(code)
}

/** Parse --flag value and boolean flags from argv slice. */
function parseFlags(args) {
  const flags = {}
  const positionals = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        flags[key] = true
      } else {
        flags[key] = args[i + 1]
        i++
      }
    } else {
      positionals.push(a)
    }
  }
  return { flags, positionals }
}

/** Read a file read-only. Returns utf8 string or calls die(). */
function readFileRO(absPath) {
  // Use low-level open with O_RDONLY to make the read-only guarantee explicit.
  // O_RDONLY = 0 on all POSIX systems.
  const fd = openSync(absPath, 'r')
  try {
    const chunks = []
    const buf = Buffer.allocUnsafe(65536)
    let bytesRead
    do {
      bytesRead = readSync(fd, buf, 0, buf.length, null)
      if (bytesRead > 0) chunks.push(buf.slice(0, bytesRead))
    } while (bytesRead === buf.length)
    return Buffer.concat(chunks).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

function resolveProjectRoot() {
  // Walk up from cwd looking for package.json
  let dir = process.cwd()
  for (let i = 0; i < 20; i++) {
    if (existsSync(resolve(dir, 'package.json'))) return dir
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return process.cwd()
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

const HELP = {
  toc: {
    summary: 'list section anchors of a doc (no body emitted)',
    usage: 'doc toc <path>',
    flags: [],
  },
  show: {
    summary: 'show a section or brief summary of a doc',
    usage: 'doc show <path> [--section <anchor> | --brief]',
    flags: [
      '--section <anchor>  show the named section and print whole-file token cost',
      '--brief             show summary header block (≤ 8 lines)',
    ],
  },
  search: {
    summary: 'full-text search across doc-class files',
    usage: 'doc search <query> [--limit N]',
    flags: ['--limit N    max rows to return (default 8)'],
  },
  lint: {
    summary: 'check all doc-class files against class token budgets',
    usage: 'doc lint',
    flags: [],
  },
}

function helpMain() {
  process.stdout.write(`doc — progressive-disclosure retrieval for narrative groundwork docs

Usage: doc <subcommand> [args]

Subcommands:
  toc <path>                     ${HELP.toc.summary}
  show <path> [--section|--brief] ${HELP.show.summary}
  search <q> [--limit N]         ${HELP.search.summary}
  lint                           ${HELP.lint.summary}

Exit codes: 0 success  1 operational failure  2 usage error

Doc classes (DERIVED — not quoted from spec):
${DOC_CLASSES.map((c) => `  ${c.name.padEnd(12)} budget ${c.budget} tokens`).join('\n')}

Run "doc <subcommand> --help" for subcommand details.
`)
}

function helpCmd(cmd) {
  const h = HELP[cmd]
  if (!h) { helpMain(); return }
  process.stdout.write(`${h.usage}\n\n${h.summary}\n`)
  if (h.flags.length) {
    process.stdout.write('\nFlags:\n')
    for (const f of h.flags) process.stdout.write(`  ${f}\n`)
  }
}

// ---------------------------------------------------------------------------
// toc — AC 1
// ---------------------------------------------------------------------------

function cmdToc(args) {
  const { flags, positionals } = parseFlags(args)
  if (flags.help) { helpCmd('toc'); return }

  const [pathArg] = positionals
  if (!pathArg) die('usage: doc toc <path>', 2)

  const absPath = resolve(process.cwd(), pathArg)
  if (!existsSync(absPath)) die(`file not found: ${pathArg}`, 1)

  const content = readFileRO(absPath)
  const sections = parseSections(content)

  if (sections.length === 0) {
    process.stdout.write('(no sections found)\n')
    return
  }

  for (const s of sections) {
    const indent = '  '.repeat(Math.max(0, s.level - 1))
    process.stdout.write(`${indent}#${s.anchor}  (${s.heading})\n`)
  }
}

// ---------------------------------------------------------------------------
// show — AC 2 (--section) and AC 3 (--brief)
// ---------------------------------------------------------------------------

function cmdShow(args) {
  const { flags, positionals } = parseFlags(args)
  if (flags.help) { helpCmd('show'); return }

  const [pathArg] = positionals
  if (!pathArg) die('usage: doc show <path> [--section <anchor> | --brief]', 2)
  if (flags.section && flags.brief) die('--section and --brief are mutually exclusive', 2)

  const absPath = resolve(process.cwd(), pathArg)
  if (!existsSync(absPath)) die(`file not found: ${pathArg}`, 1)

  const content = readFileRO(absPath)
  const tokenCost = estimateTokens(content)

  if (flags.section) {
    // AC 2: show exactly the named section + token cost of whole file
    const anchor = String(flags.section)
    const sections = parseSections(content)
    const found = sections.find((s) => s.anchor === anchor)
    if (!found) {
      const available = sections.map((s) => s.anchor).join(', ')
      die(`section "#${anchor}" not found. Available: ${available || '(none)'}`, 1)
    }

    process.stdout.write(`## ${found.heading}\n`)
    if (found.body) process.stdout.write(found.body + '\n')
    process.stdout.write(`\n─── whole-file token cost: ~${tokenCost} tokens\n`)
    return
  }

  if (flags.brief) {
    // AC 3: summary header block, ≤ 8 lines
    const block = extractSummaryHeader(content)
    const lines = block.split('\n')
    const display = lines.slice(0, 8)
    process.stdout.write(display.join('\n') + '\n')
    if (lines.length > 8) {
      process.stdout.write(`─── (${lines.length - 8} more lines truncated)\n`)
    }
    return
  }

  // No flag — show toc as default
  die('specify --section <anchor> or --brief', 2)
}

// ---------------------------------------------------------------------------
// search — AC 4
// ---------------------------------------------------------------------------

function cmdSearch(args) {
  const { flags, positionals } = parseFlags(args)
  if (flags.help) { helpCmd('search'); return }

  const query = positionals.join(' ').trim()
  if (!query) die('usage: doc search <query> [--limit N]', 2)

  const limit = flags.limit ? parseInt(String(flags.limit), 10) : 8
  if (isNaN(limit) || limit < 1) die('--limit must be a positive integer', 2)

  const rootDir = resolveProjectRoot()
  const matches = searchDocs(rootDir, query)
  const total = matches.length
  const rows = matches.slice(0, limit)

  for (const m of rows) {
    process.stdout.write(`${m.relPath}:${m.lineNum}  [${m.cls}]  ${m.excerpt}\n`)
  }

  if (total === 0) {
    process.stdout.write('(no matches)\n')
    return
  }

  if (total > limit) {
    process.stdout.write(`\n(${rows.length} of ${total} matches shown — use --limit to see more)\n`)
  }
}

// ---------------------------------------------------------------------------
// lint — AC 5, 6, 7, 8, 9
// ---------------------------------------------------------------------------

function cmdLint(args) {
  const { flags } = parseFlags(args)
  if (flags.help) { helpCmd('lint'); return }

  const rootDir = resolveProjectRoot()
  const { classified, unclassified } = findDocFiles(rootDir)

  // Group by class
  const byClass = {}
  for (const cls of DOC_CLASSES) byClass[cls.name] = []
  for (const item of classified) {
    byClass[item.cls.name].push(item)
  }

  const violations = []   // { item, tokenCost, missing } — exit non-zero
  const warnings = []     // { item, tokenCost } — over budget but structurally sound
  const oks = []          // { item, tokenCost } — within budget and structurally sound (AC 8)

  // Track per-class over-budget counts (computed once, reused for summary table)
  const classOverBudget = {}
  for (const cls of DOC_CLASSES) classOverBudget[cls.name] = 0

  for (const item of classified) {
    let content
    try {
      content = readFileRO(item.absPath)
    } catch (err) {
      violations.push({
        item,
        tokenCost: 0,
        missing: [`could not read: ${err.message}`],
      })
      continue
    }

    const tokenCost = estimateTokens(content)
    const { hasSummaryHeader, hasSectionAnchor } = checkStructure(content)

    const missing = []
    // _intro.md stubs are index/navigation placeholders; they cannot carry a
    // meaningful summary header (5–14 tokens each), so exempt them from the rule.
    // The exemption is keyed on the exact filename — not directory depth, not
    // file size — so it cannot silently widen to cover substantive section files.
    const isIntroStub = basename(item.absPath) === '_intro.md'
    if (!hasSummaryHeader && !isIntroStub) missing.push('summary-header')
    if (!hasSectionAnchor) missing.push('section-anchor')

    if (tokenCost > item.cls.budget) {
      classOverBudget[item.cls.name]++
      // AC 7: if over budget but has both structural elements → warning only
      if (hasSummaryHeader && hasSectionAnchor) {
        warnings.push({ item, tokenCost })
      } else {
        violations.push({ item, tokenCost, missing })
      }
    } else if (missing.length > 0) {
      // Within budget but missing structure — also a violation
      violations.push({ item, tokenCost, missing })
    } else {
      // Within budget and structurally sound — track for per-file detail (AC 8)
      oks.push({ item, tokenCost })
    }
  }

  // Print summary table (AC 5: one row per class)
  process.stdout.write('doc lint — summary\n')
  process.stdout.write('─'.repeat(72) + '\n')

  for (const cls of DOC_CLASSES) {
    const items = byClass[cls.name]
    const over = classOverBudget[cls.name]
    const status = over === 0 ? 'OK' : `${over} over budget`
    process.stdout.write(
      `  ${cls.name.padEnd(12)} ${String(items.length).padStart(3)} file(s)   budget ${cls.budget}   ${status}\n`,
    )
  }

  if (unclassified.length > 0) {
    process.stdout.write(`  ${'unclassified'.padEnd(12)} ${String(unclassified.length).padStart(3)} file(s)   (excluded from linting)\n`)
    for (const p of unclassified) {
      process.stdout.write(`    unclassified: ${relativeOrAbs(rootDir, p)}\n`)
    }
  }

  process.stdout.write('─'.repeat(72) + '\n')

  // Print warnings (AC 7)
  for (const w of warnings) {
    process.stdout.write(
      `WARN  ${w.item.relPath}  [${w.item.cls.name}]  ` +
      `~${w.tokenCost} tokens (budget ${w.item.cls.budget}) — over budget but structurally sound\n`,
    )
  }

  // Print violations (AC 6: path, class, token estimate, budget, missing element)
  for (const v of violations) {
    const missingStr = Array.isArray(v.missing) && v.missing.length ? v.missing.join(', ') : 'unreadable'
    process.stdout.write(
      `FAIL  ${v.item.relPath}  [${v.item.cls.name}]  ` +
      `~${v.tokenCost} tokens (budget ${v.item.cls.budget}) — missing: ${missingStr}\n`,
    )
  }

  // AC 8: per-file token counts for all in-budget, structurally-sound files.
  // Emitted after WARN/FAIL so the signal lines remain prominent.
  for (const ok of oks) {
    process.stdout.write(
      `OK    ${ok.item.relPath}  [${ok.item.cls.name}]  ~${ok.tokenCost} tokens (budget ${ok.item.cls.budget})\n`,
    )
  }

  if (violations.length === 0 && warnings.length === 0) {
    process.stdout.write('All files within budget and structurally sound.\n')
  }

  // AC 5: exit 0 only if every file is within its class budget
  // AC 7: warnings (over budget but structurally sound) do NOT cause non-zero exit
  if (violations.length > 0) {
    process.exit(1)
  }
}

function relativeOrAbs(rootDir, absPath) {
  try {
    return relative(rootDir, absPath)
  } catch {
    return absPath
  }
}

// ---------------------------------------------------------------------------
// Main
// NOTE: Do NOT run parseFlags on the full argv here — flags like --section and
// --limit belong to subcommands and must be parsed by the subcommand handler.
// Extract only the first non-flag token as the subcommand; pass everything else.
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)

// Handle bare --help / no args before subcommand extraction
if (args.length === 0 || args[0] === '--help' || args[0] === 'help') {
  helpMain()
  process.exit(0)
}

const [cmd, ...rest] = args

switch (cmd) {
  case 'toc':    cmdToc(rest); break
  case 'show':   cmdShow(rest); break
  case 'search': cmdSearch(rest); break
  case 'lint':   cmdLint(rest); break
  default:
    die(`unknown subcommand "${cmd}". Run "doc --help" for usage.`, 2)
}
