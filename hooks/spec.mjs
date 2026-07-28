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

import { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs'
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
  loadSpecManifest,
} from './lib/spec-io.mjs'
import { scanVerifies } from './lib/verifies-scan.mjs'

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
async function ensureFreshIndex(sd) {
  if (isIndexStale(sd)) {
    await runBuild(sd, { silent: true })
  }
}

async function runBuild(sd, { silent = false } = {}) {
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

  // Report non-blocking parse errors as warnings
  for (const e of errors) {
    if (e.type === 'requirement_parse_error') {
      process.stderr.write(`spec: [warning] parse error in "${e.nodeId}": ${e.message}\n  in: ${e.path}\n`)
    }
    if (!silent && e.type === 'unknown_frontmatter_field') {
      const who = e.nodeId ? ` (${e.nodeId})` : ''
      process.stderr.write(`spec: [warning] unknown frontmatter field "${e.field}"${who}\n  in: ${e.path}\n`)
    }
  }

  // Prepare output
  const genDir = generatedDirPath(sd)
  mkdirSync(genDir, { recursive: true })

  // index.json (AC6: summary, refs, byteSize per node; RFC-0003: body-derived fields)
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
      // Body-derived fields (RFC-0003 body-first format)
      anchor: n.anchor ?? null,
      why: n.why ?? null,
      fitCriterion: n.fitCriterion ?? null,
      source: n.source ?? null,
    }
  }
  writeFileSync(join(genDir, 'index.json'), JSON.stringify(indexJson, null, 2) + '\n', 'utf8')

  // coverage.json
  // by_source replaces by_status: status is not present in the body-first format;
  // source RFC is extracted from the **Source** token in each requirement's attribute line.
  const reqs = Object.values(nodes).filter(n => n.type === 'requirement')

  // Scan test files for @verifies annotations to compute ACTUAL verification evidence.
  // sd is <projectRoot>/doc/specs, so the project root is two levels up.
  const projectRootDir = dirname(dirname(sd))
  const verifiesMap = scanVerifies(projectRootDir)

  // Build per-requirement map: declared intent + actual test coverage
  /** @type {Record<string, {declared: string|null, verified: boolean, tests: string[]}>} */
  const byRequirement = {}
  for (const req of reqs) {
    const tests = verifiesMap[req.id] ?? []
    byRequirement[req.id] = {
      declared: req.verification ?? null,
      verified: tests.length > 0,
      tests,
    }
  }

  // IDs that declare automated verification but have no verifying test yet
  const unverifiedAutomated = reqs
    .filter(r => r.verification === 'automated' && (verifiesMap[r.id] ?? []).length === 0)
    .map(r => r.id)
    .sort()

  const coverage = {
    total: reqs.length,
    by_source: countBy(reqs, 'source'),
    // declared verification intent (kept for backward compatibility)
    by_verification: countBy(reqs, 'verification'),
    by_criticality: countBy(reqs, 'criticality'),
    // actual verification evidence from @verifies annotations in test files
    verified: reqs.filter(r => (verifiesMap[r.id] ?? []).length > 0).length,
    unverified_automated: unverifiedAutomated,
    by_requirement: byRequirement,
  }
  writeFileSync(join(genDir, 'coverage.json'), JSON.stringify(coverage, null, 2) + '\n', 'utf8')

  // index.md — grouped by concept, full normative statement, working anchor links
  // A reader can skim the whole spec and click through to any requirement from this file.
  const allNodes = Object.values(nodes)
  const requirementNodes = allNodes.filter(n => n.type === 'requirement')
  const conceptNodes = allNodes
    .filter(n => n.type !== 'requirement')
    .sort((a, b) => a.id.localeCompare(b.id))

  const mdLines = [
    '# Spec Index',
    '',
    `_Generated: ${new Date().toISOString()}_`,
    '',
  ]

  // Concepts table — placed at top of index.md, before requirement sections
  {
    const conceptDirs = readdirSync(sd, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== '_generated')
      .sort((a, b) => a.name.localeCompare(b.name))

    // Map: first path component of relPath → concept node (skips root-level concepts)
    const conceptByDir = {}
    for (const cn of conceptNodes) {
      const parts = cn.relPath.split('/')
      if (parts.length >= 2) {
        conceptByDir[parts[0]] = cn
      }
    }

    const conceptRows = []
    for (const entry of conceptDirs) {
      const dirName = entry.name
      const conceptNode = conceptByDir[dirName]
      const { manifest, errors: manifestErrors } = await loadSpecManifest(join(sd, dirName))
      const hasManifest = manifest !== null && manifestErrors.length === 0

      const conceptId = conceptNode ? conceptNode.id : dirName
      let summary, status, views

      if (hasManifest) {
        summary = manifest.summary || (conceptNode ? conceptNode.summary : '—')
        status = manifest.status || '—'
        views = manifest.views && manifest.views.length > 0
          ? manifest.views.map(v => v.type).filter(Boolean).join(', ')
          : '—'
      } else {
        summary = (conceptNode ? conceptNode.summary : '') || '—'
        summary += ' *(no manifest)*'
        status = '—'
        views = '—'
      }

      conceptRows.push([conceptId, summary, status, views])
    }

    mdLines.push('## Concepts', '')
    if (conceptRows.length > 0) {
      mdLines.push('| Concept | Summary | Status | Views |')
      mdLines.push('| --- | --- | --- | --- |')
      for (const [cid, summ, stat, v] of conceptRows) {
        mdLines.push(`| ${cid} | ${summ} | ${stat} | ${v} |`)
      }
    } else {
      mdLines.push('_No concept directories found._')
    }
    mdLines.push('')
  }

  // Track which requirements have been placed (grouped under their concept)
  const outputReqIds = new Set()

  for (const concept of conceptNodes) {
    const conceptReqs = requirementNodes
      .filter(n => n.concept === concept.id)
      .sort((a, b) => a.id.localeCompare(b.id))

    // Report missing anchors; track as output so they don't appear in Uncategorized
    for (const req of conceptReqs) {
      outputReqIds.add(req.id)
      if (!req.anchor) {
        process.stderr.write(
          `spec: requirement "${req.id}" has no anchor — omitted from index.md to avoid a broken link\n`,
        )
      }
    }

    const anchoredReqs = conceptReqs.filter(n => n.anchor)
    if (anchoredReqs.length === 0) continue  // skip concept with no linkable requirements

    mdLines.push(`## ${concept.title || concept.id}`)
    mdLines.push('')

    for (const req of anchoredReqs) {
      // Link is relative from _generated/ to the spec root (prepend ../ to relPath)
      const link = `../${req.relPath}#${req.anchor}`
      mdLines.push(`### [${req.id} — ${req.title}](${link})`)
      mdLines.push('')
      if (req.ears) {
        mdLines.push(req.ears)
        mdLines.push('')
      }
    }
  }

  // Requirements not associated with any listed concept
  const uncategorized = requirementNodes
    .filter(n => !outputReqIds.has(n.id))
    .sort((a, b) => a.id.localeCompare(b.id))

  if (uncategorized.length > 0) {
    // Report missing anchors in uncategorized set
    for (const req of uncategorized) {
      if (!req.anchor) {
        process.stderr.write(
          `spec: requirement "${req.id}" has no anchor — omitted from index.md to avoid a broken link\n`,
        )
      }
    }

    const anchoredUncategorized = uncategorized.filter(n => n.anchor)
    if (anchoredUncategorized.length > 0) {
      mdLines.push('## Uncategorized Requirements')
      mdLines.push('')
      for (const req of anchoredUncategorized) {
        const link = `../${req.relPath}#${req.anchor}`
        mdLines.push(`### [${req.id} — ${req.title}](${link})`)
        mdLines.push('')
        if (req.ears) {
          mdLines.push(req.ears)
          mdLines.push('')
        }
      }
    }
  }

  writeFileSync(join(genDir, 'index.md'), mdLines.join('\n'), 'utf8')

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

async function cmdBuild(args) {
  const sd = resolveSpecDir()
  if (!existsSync(sd)) die('doc/specs/ not found — run "spec init" first', 1)
  await runBuild(sd)
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

async function cmdShow(args) {
  const { flags, positionals } = parseFlags(args)
  const [id] = positionals
  if (!id) die('usage: spec show <id> [--full]', 2)

  const sd = resolveSpecDir()
  if (!existsSync(sd)) die('doc/specs/ not found — run "spec init" first', 1)

  // AC10: rebuild if stale
  await ensureFreshIndex(sd)

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

async function cmdSearch(args) {
  const { flags, positionals } = parseFlags(args)
  const query = positionals.join(' ').trim()
  if (!query) die('usage: spec search <query> [--limit N]', 2)

  const limit = flags.limit ? parseInt(String(flags.limit), 10) : 8
  if (isNaN(limit) || limit < 1) die('--limit must be a positive integer', 2)

  const sd = resolveSpecDir()
  if (!existsSync(sd)) die('doc/specs/ not found — run "spec init" first', 1)

  // AC10: rebuild if stale
  await ensureFreshIndex(sd)

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

async function cmdTree(args) {
  const { flags } = parseFlags(args)

  // AC9: default depth 2
  const depth = flags.depth ? parseInt(String(flags.depth), 10) : 2
  if (isNaN(depth) || depth < 1) die('--depth must be a positive integer', 2)

  const sd = resolveSpecDir()
  if (!existsSync(sd)) die('doc/specs/ not found — run "spec init" first', 1)

  // AC10: rebuild if stale
  await ensureFreshIndex(sd)

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

async function cmdDeps(args) {
  const { positionals } = parseFlags(args)
  const [id] = positionals
  if (!id) die('usage: spec deps <id>', 2)

  const sd = resolveSpecDir()
  if (!existsSync(sd)) die('doc/specs/ not found — run "spec init" first', 1)

  // AC10: rebuild if stale
  await ensureFreshIndex(sd)

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

async function main() {
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
      case 'build':  return await cmdBuild(rest)
      case 'req':    return cmdReq(rest)
      case 'show':   return await cmdShow(rest)
      case 'search': return await cmdSearch(rest)
      case 'tree':   return await cmdTree(rest)
      case 'deps':   return await cmdDeps(rest)
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
  main().catch(e => {
    process.stderr.write(`spec: ${e?.message ?? String(e)}\n`)
    process.exit(1)
  })
}
