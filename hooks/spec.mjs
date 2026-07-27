#!/usr/bin/env node
/**
 * Groundwork spec CLI — manage requirement specifications under doc/specs/.
 *
 * Subcommands:
 *   init                    — create doc/specs/README.md with a root concept node
 *   build                   — build doc/specs/_generated/{index.md,index.json,coverage.json}
 *   req new <concept> <name>— create a new requirement file
 *   show <id> [--full]      — show a spec node (8 lines without --full)
 *   search <q> [--limit N]  — search nodes (default --limit 8)
 *   tree [--depth N]        — show concept tree (default depth 2)
 *   deps <id>               — show inbound/outbound references from index
 *   verify|lint|metrics|doc [args…] — delegate to sibling script
 *
 * Exit codes: 0 success  1 operational failure  2 usage error
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import {
  parseYamlFrontmatter,
  findProjectRoot,
  specDirPath,
  generatedDirPath,
  indexJsonPath,
  walkSpecFiles,
  isIndexStale,
  buildIndexData,
  loadIndex,
  findConceptDir,
  randomSuffix,
  firstSentence,
} from './lib/spec-io.mjs'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function die(msg, code = 1) {
  process.stderr.write(`spec: ${msg}\n`)
  process.exit(code)
}

/** Pull `--flag value` pairs out of argv; returns { flags, positionals }. */
function parseFlags(args) {
  const flags = {}
  const positionals = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      // Boolean flags (no next arg or next arg starts with --)
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

function projectRoot() {
  return process.env.CLAUDE_PROJECT_DIR || findProjectRoot(process.cwd())
}

function resolveSpecDir() {
  return specDirPath(projectRoot())
}

/** Ensure index exists and is not stale; rebuild if needed. */
function ensureFreshIndex(sd) {
  if (isIndexStale(sd)) {
    runBuild(sd, { silent: true })
  }
}

function runBuild(sd, { silent = false } = {}) {
  const { nodes, errors } = buildIndexData(sd)

  // Report errors and exit 1 on build-blocking errors
  const buildErrors = errors.filter(e =>
    e.type === 'duplicate_id' || e.type === 'parent_dir_mismatch' || e.type === 'path_in_verify',
  )

  if (buildErrors.length > 0) {
    for (const e of buildErrors) {
      if (e.type === 'duplicate_id') {
        process.stderr.write(`spec: duplicate id "${e.id}"\n  ${e.paths[0]}\n  ${e.paths[1]}\n`)
      } else if (e.type === 'parent_dir_mismatch') {
        process.stderr.write(
          `spec: parent/directory mismatch for node "${e.nodeId}"\n` +
          `  frontmatter concept: "${e.frontmatter}"\n` +
          `  directory implies:   "${e.directory}"\n` +
          `  in: ${e.path}\n`,
        )
      } else if (e.type === 'path_in_verify') {
        process.stderr.write(
          `spec: path-like token in verify field of "${e.nodeId}": "${e.token}"\n` +
          `  Use @verifies annotations in test code instead of file paths in verify.\n` +
          `  in: ${e.path}\n`,
        )
      }
    }
    process.exit(1)
  }

  // Prepare output
  const genDir = generatedDirPath(sd)
  mkdirSync(genDir, { recursive: true })

  // index.json (AC6: summary, refs, byteSize per node)
  const indexJson = {
    generated_at: new Date().toISOString(),
    nodes: {},
  }
  for (const [id, n] of Object.entries(nodes)) {
    indexJson.nodes[id] = {
      id: n.id,
      type: n.type,
      title: n.title,
      summary: n.summary,
      refs: n.refs,
      inbound: n.inbound,
      byteSize: n.byteSize,
      relPath: n.relPath,
      status: n.status,
      pattern: n.pattern,
      verification: n.verification,
      criticality: n.criticality,
      concept: n.concept,
      parent: n.parent,
      ears: n.ears,
    }
  }
  writeFileSync(join(genDir, 'index.json'), JSON.stringify(indexJson, null, 2) + '\n', 'utf8')

  // coverage.json
  const reqs = Object.values(nodes).filter(n => n.type === 'requirement')
  const coverage = {
    total: reqs.length,
    by_status: countBy(reqs, 'status'),
    by_verification: countBy(reqs, 'verification'),
    by_criticality: countBy(reqs, 'criticality'),
  }
  writeFileSync(join(genDir, 'coverage.json'), JSON.stringify(coverage, null, 2) + '\n', 'utf8')

  // index.md — human-readable table
  /** Truncate on a word boundary; append ellipsis if cut. */
  function truncWB(s, n) {
    if (!s || s.length <= n) return (s || '').replace(/\|/g, '\\|')
    const cut = s.slice(0, n)
    const lastSpace = cut.lastIndexOf(' ')
    const trimmed = lastSpace > n * 0.6 ? cut.slice(0, lastSpace) : cut
    return trimmed.replace(/\|/g, '\\|') + '…'
  }

  const rows = Object.values(nodes).sort((a, b) => a.id.localeCompare(b.id))
  const lines = [
    '# Spec Index',
    '',
    `_Generated: ${new Date().toISOString()}_`,
    '',
    '| id | type | status | summary |',
    '|---|---|---|---|',
    ...rows.map(n =>
      `| ${n.id} | ${n.type} | ${n.status || '-'} | ${truncWB(n.summary, 80)} |`,
    ),
    '',
  ]
  writeFileSync(join(genDir, 'index.md'), lines.join('\n'), 'utf8')

  if (!silent) {
    process.stdout.write(
      `spec: built index — ${Object.keys(nodes).length} nodes, ${reqs.length} requirements\n`,
    )
  }
}

function countBy(arr, field) {
  const out = {}
  for (const item of arr) {
    const v = item[field] || 'unknown'
    out[v] = (out[v] || 0) + 1
  }
  return out
}

// ---------------------------------------------------------------------------
// HELP
// ---------------------------------------------------------------------------

const HELP = {
  init: {
    summary: 'create doc/specs/README.md with a root concept node',
    usage: 'spec init',
    flags: [],
  },
  build: {
    summary: 'build doc/specs/_generated/{index.md,index.json,coverage.json}',
    usage: 'spec build',
    flags: [],
  },
  req: {
    summary: 'requirement subcommands',
    usage: 'spec req new <concept-id> <kebab-name>',
    flags: [],
  },
  show: {
    summary: 'show a spec node (8 lines without --full)',
    usage: 'spec show <id> [--full]',
    flags: ['--full    show complete file content'],
  },
  search: {
    summary: 'search nodes by keyword',
    usage: 'spec search <query> [--limit N]',
    flags: ['--limit N    max rows to return (default 8)'],
  },
  tree: {
    summary: 'show concept tree (default depth 2)',
    usage: 'spec tree [--depth N]',
    flags: ['--depth N    max depth (default 2)'],
  },
  deps: {
    summary: 'show inbound/outbound references for a node',
    usage: 'spec deps <id>',
    flags: [],
  },
  verify: { summary: 'run verification suite (delegates to spec-verify.mjs)', usage: 'spec verify [args…]', flags: [] },
  lint: { summary: 'lint spec files (delegates to spec-lint.mjs)', usage: 'spec lint [args…]', flags: [] },
  metrics: { summary: 'metrics report (delegates to spec-metrics.mjs)', usage: 'spec metrics [args…]', flags: [] },
  doc: { summary: 'generate documentation (delegates to spec-doc.mjs)', usage: 'spec doc [args…]', flags: [] },
}

function cmdHelp(args) {
  if (args.length) {
    const cmd = args[0]
    const h = HELP[cmd]
    if (!h) die(`unknown command "${cmd}". Run spec help for a list.`, 2)
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
  process.stdout.write(
    [
      'Usage: spec <command> [args] [flags]',
      '',
      'Commands:',
      cmds,
      '',
      'Run `spec help <command>` or `spec <command> --help` for per-command details.',
      'Exit codes: 0 success  1 operational failure  2 usage error',
    ].join('\n') + '\n',
  )
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdInit(args) {
  const sd = resolveSpecDir()

  if (existsSync(sd)) {
    const readme = join(sd, 'README.md')
    if (existsSync(readme)) {
      die(`doc/specs/README.md already exists. Remove it or run "spec build" to update the index.`, 1)
    }
  }

  // Derive project name from package.json or directory name
  const root = projectRoot()
  let projectName = basename(root)
  const pkgPath = join(root, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      if (pkg.name) projectName = pkg.name
    } catch { /* use dir name */ }
  }

  const conceptId = 'C-' + projectName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  mkdirSync(sd, { recursive: true })

  const readme = [
    '---',
    `id: ${conceptId}`,
    `type: concept`,
    `title: ${projectName}`,
    `parent: null`,
    '---',
    '',
    `# ${projectName}`,
    '',
    'Add a one-paragraph description of this system here.',
    '',
    '## Goals',
    '',
    '- TODO',
    '',
  ].join('\n')

  writeFileSync(join(sd, 'README.md'), readme, 'utf8')
  process.stdout.write(`spec: created doc/specs/README.md (concept ${conceptId})\n`)
}

function cmdBuild(args) {
  const sd = resolveSpecDir()
  if (!existsSync(sd)) die('doc/specs/ not found — run "spec init" first', 1)
  runBuild(sd)
}

function cmdReq(args) {
  const [subcmd, ...rest] = args
  if (!subcmd || subcmd === '--help' || subcmd === '-h') {
    cmdHelp(['req'])
    return
  }
  if (subcmd === 'new') {
    return cmdReqNew(rest)
  }
  die(`unknown req subcommand "${subcmd}". Valid: new`, 2)
}

function cmdReqNew(args) {
  const { flags, positionals } = parseFlags(args)
  const [conceptId, kebabName] = positionals
  if (!conceptId || !kebabName) die('usage: spec req new <concept-id> <kebab-name>', 2)

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(kebabName)) {
    die(`kebab-name "${kebabName}" must be lowercase letters, digits, and hyphens only`, 2)
  }

  const sd = resolveSpecDir()
  if (!existsSync(sd)) die('doc/specs/ not found — run "spec init" first', 1)

  // Find the concept directory
  const conceptDir = findConceptDir(conceptId, sd)
  if (!conceptDir) die(`concept "${conceptId}" not found in doc/specs/`, 1)

  // Collect existing id suffixes for uniqueness (AC5)
  const allFiles = walkSpecFiles(sd)
  const existingSuffixes = new Set()
  for (const { absPath } of allFiles) {
    const raw = readFileSync(absPath, 'utf8')
    const { data } = parseYamlFrontmatter(raw)
    if (data.id) {
      const m = String(data.id).match(/-R-([a-z0-9]{4})$/)
      if (m) existingSuffixes.add(m[1])
    }
  }

  const suffix = randomSuffix(existingSuffixes)
  // Concept id suffix: strip C- prefix
  const conceptSuffix = conceptId.replace(/^C-/, '')
  const reqId = `${conceptSuffix}-R-${suffix}`

  const reqDir = join(conceptDir, 'requirements')
  mkdirSync(reqDir, { recursive: true })

  const reqFile = join(reqDir, `${kebabName}.md`)
  if (existsSync(reqFile)) die(`requirement file already exists: ${reqFile}`, 1)

  const content = [
    '---',
    `id: ${reqId}`,
    `concept: ${conceptId}`,
    `ears: "TODO: write EARS requirement here."`,
    `summary: "TODO: write a ≤25-word retrieval gloss for this requirement."`,
    `pattern: ubiquitous`,
    `verify: "TODO: describe how to verify this requirement."`,
    `verification: automated`,
    `criticality: must`,
    `origin_rfc: TODO`,
    `superseded_by: null`,
    `status: active`,
    '---',
    '',
    '<!-- Commentary only — not normative. -->',
    '',
  ].join('\n')

  writeFileSync(reqFile, content, 'utf8')
  process.stdout.write(`spec: created ${reqFile} (id: ${reqId})\n`)
}

function cmdShow(args) {
  const { flags, positionals } = parseFlags(args)
  const [id] = positionals
  if (!id) die('usage: spec show <id> [--full]', 2)

  const sd = resolveSpecDir()
  if (!existsSync(sd)) die('doc/specs/ not found — run "spec init" first', 1)

  // AC10: rebuild if stale
  ensureFreshIndex(sd)

  const idx = loadIndex(sd)
  if (!idx) die('index not found — run "spec build" first', 1)

  const node = idx.nodes[id]
  if (!node) die(`node "${id}" not found in index`, 1)

  const nodeAbsPath = join(sd, node.relPath)

  if (flags.full) {
    // Show full file content
    if (!existsSync(nodeAbsPath)) die(`file not found: ${node.relPath}`, 1)
    process.stdout.write(readFileSync(nodeAbsPath, 'utf8'))
    return
  }

  // AC7: at most 8 lines; state token cost of --full form
  const tokenCost = Math.ceil(node.byteSize / 3.5)
  const lines = []
  lines.push(`${node.id}  [${node.type}]${node.status ? '  [' + node.status + ']' : ''}`)
  if (node.title && node.title !== node.id) lines.push(`Title: ${node.title}`)
  if (node.concept) lines.push(`Concept: ${node.concept}`)
  if (node.ears) lines.push(`EARS: ${node.ears.slice(0, 100)}`)
  else if (node.summary) lines.push(`Summary: ${node.summary.slice(0, 100)}`)
  if (node.pattern) lines.push(`Pattern: ${node.pattern}`)
  if (node.verification) lines.push(`Verification: ${node.verification}  Criticality: ${node.criticality || 'must'}`)
  if (node.refs && node.refs.length) lines.push(`Refs: ${node.refs.slice(0, 5).join(', ')}`)

  // Truncate to 8 lines
  const display = lines.slice(0, 8)
  process.stdout.write(display.join('\n') + '\n')
  process.stdout.write(
    `─── ${display.length} line(s) shown. Full form: ~${tokenCost} tokens  (spec show ${id} --full)\n`,
  )
}

function cmdSearch(args) {
  const { flags, positionals } = parseFlags(args)
  const query = positionals.join(' ').trim()
  if (!query) die('usage: spec search <query> [--limit N]', 2)

  const limit = flags.limit ? parseInt(String(flags.limit), 10) : 8
  if (isNaN(limit) || limit < 1) die('--limit must be a positive integer', 2)

  const sd = resolveSpecDir()
  if (!existsSync(sd)) die('doc/specs/ not found — run "spec init" first', 1)

  // AC10: rebuild if stale
  ensureFreshIndex(sd)

  const idx = loadIndex(sd)
  if (!idx) die('index not found — run "spec build" first', 1)

  const q = query.toLowerCase()
  const matches = []
  for (const node of Object.values(idx.nodes)) {
    const haystack = [node.id, node.title, node.summary, node.ears, node.relPath]
      .filter(Boolean).join(' ').toLowerCase()
    if (haystack.includes(q)) matches.push(node)
  }

  const total = matches.length
  const rows = matches.slice(0, limit)

  for (const n of rows) {
    const tag = n.type === 'requirement' ? `[${n.status || '?'}]` : '[concept]'
    process.stdout.write(`${n.id.padEnd(30)} ${tag.padEnd(12)} ${(n.summary || '').slice(0, 60)}\n`)
  }

  // AC8: print total match count when results are truncated
  if (total > limit) {
    process.stdout.write(`\n(${rows.length} of ${total} matches shown — use --limit to see more)\n`)
  } else if (total === 0) {
    process.stdout.write(`(no matches for "${query}")\n`)
  }
}

function cmdTree(args) {
  const { flags } = parseFlags(args)

  // AC9: default depth 2
  const depth = flags.depth ? parseInt(String(flags.depth), 10) : 2
  if (isNaN(depth) || depth < 1) die('--depth must be a positive integer', 2)

  const sd = resolveSpecDir()
  if (!existsSync(sd)) die('doc/specs/ not found — run "spec init" first', 1)

  // AC10: rebuild if stale
  ensureFreshIndex(sd)

  const idx = loadIndex(sd)
  if (!idx) die('index not found — run "spec build" first', 1)

  const nodes = idx.nodes
  const concepts = Object.values(nodes).filter(n => n.type === 'concept')
  const requirements = Object.values(nodes).filter(n => n.type === 'requirement')

  // Build parent→children map for concepts
  function renderTree(node, currentDepth) {
    const indent = '  '.repeat(currentDepth)
    const reqCount = requirements.filter(r => r.concept === node.id).length
    const reqLabel = reqCount > 0 ? ` [${reqCount} req${reqCount !== 1 ? 's' : ''}]` : ''
    process.stdout.write(`${indent}${node.id}  ${node.title || ''}${reqLabel}\n`)
    if (currentDepth < depth) {
      const children = concepts.filter(c => c.parent === node.id)
      for (const child of children) renderTree(child, currentDepth + 1)
      // Show requirements at this depth if we're at the max
      if (currentDepth === depth - 1) {
        const reqs = requirements.filter(r => r.concept === node.id)
        for (const r of reqs) {
          process.stdout.write(`${'  '.repeat(currentDepth + 1)}${r.id}  ${(r.summary || '').slice(0, 60)}\n`)
        }
      }
    }
  }

  // Find root concepts (parent is null or not in the concept set)
  const conceptIds = new Set(concepts.map(c => c.id))
  const roots = concepts.filter(c => !c.parent || !conceptIds.has(c.parent))
  for (const root of roots) renderTree(root, 0)
}

function cmdDeps(args) {
  const { positionals } = parseFlags(args)
  const [id] = positionals
  if (!id) die('usage: spec deps <id>', 2)

  const sd = resolveSpecDir()
  if (!existsSync(sd)) die('doc/specs/ not found — run "spec init" first', 1)

  // AC10: rebuild if stale
  ensureFreshIndex(sd)

  // AC11: read only from index, no opening markdown files
  const idx = loadIndex(sd)
  if (!idx) die('index not found — run "spec build" first', 1)

  const node = idx.nodes[id]
  if (!node) die(`node "${id}" not found in index`, 1)

  process.stdout.write(`deps for ${id}\n\n`)
  process.stdout.write(`outbound (${node.refs ? node.refs.length : 0}):\n`)
  if (node.refs && node.refs.length) {
    for (const ref of node.refs) {
      const target = idx.nodes[ref]
      process.stdout.write(`  ${ref}  ${target ? target.summary || '' : '(not in index)'}\n`)
    }
  } else {
    process.stdout.write('  (none)\n')
  }

  process.stdout.write(`\ninbound (${node.inbound ? node.inbound.length : 0}):\n`)
  if (node.inbound && node.inbound.length) {
    for (const ref of node.inbound) {
      const src = idx.nodes[ref]
      process.stdout.write(`  ${ref}  ${src ? src.summary || '' : '(not in index)'}\n`)
    }
  } else {
    process.stdout.write('  (none)\n')
  }
}

/**
 * AC13: Delegate to a sibling spec-<sub>.mjs script.
 * Exit 127 with a named message if the script is absent.
 */
function cmdDelegate(sub, args) {
  const hooksDir = dirname(fileURLToPath(import.meta.url))
  const scriptPath = join(hooksDir, `spec-${sub}.mjs`)

  if (!existsSync(scriptPath)) {
    process.stderr.write(
      `spec: the "${sub}" subcommand requires spec-${sub}.mjs which is not installed.\n` +
      `  Expected path: ${scriptPath}\n`,
    )
    process.exit(127)
  }

  const result = spawnSync('node', [scriptPath, ...args], { stdio: 'inherit' })
  process.exit(result.status ?? 1)
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
  if (flags.help) { cmdHelp([cmd]); return }

  const DELEGATED = new Set(['verify', 'lint', 'metrics', 'doc'])

  try {
    switch (cmd) {
      case 'init':   return cmdInit(rest)
      case 'build':  return cmdBuild(rest)
      case 'req':    return cmdReq(rest)
      case 'show':   return cmdShow(rest)
      case 'search': return cmdSearch(rest)
      case 'tree':   return cmdTree(rest)
      case 'deps':   return cmdDeps(rest)
      default:
        if (DELEGATED.has(cmd)) return cmdDelegate(cmd, rest)
        die(`unknown command "${cmd}". Run spec --help for a list.`, 2)
    }
  } catch (e) {
    die(e?.message ?? String(e), e?.exitCode ?? 1)
  }
}

// Only run main when executed as CLI (not when imported by tests)
const isMain =
  process.argv[1] &&
  import.meta.url &&
  process.argv[1].endsWith('spec.mjs')

if (isMain) {
  main()
}
