#!/usr/bin/env node
/**
 * spec-lint.mjs — `spec lint [--rfc <uid>]` subcommand
 *
 * Without --rfc: checks every spec node against steering invariants and
 *   reports each violation as a LINT_DRIFT journal event. AC 5.
 * With --rfc <uid>: checks only the nodes named by that RFC's spec_delta
 *   and exits 1 if any violation is found. AC 6.
 *
 * NEVER writes to docs/steering/. Opens steering files read-only. AC 8.
 *
 * Steering invariants checked:
 *   1. title-present   — every spec node must have a non-empty title
 *   2. ears-or-summary — requirement nodes must have ears or summary
 *   3. origin-rfc      — every node must declare origin_rfc in its
 *                        markdown frontmatter
 *
 * Exit codes: 0 success  1 violations found (--rfc mode only)  2 usage error
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

// ---------------------------------------------------------------------------
// Project root
// ---------------------------------------------------------------------------

function findProjectRoot() {
  return dirname(dirname(fileURLToPath(import.meta.url)))
}

// ---------------------------------------------------------------------------
// Spec index loader
// ---------------------------------------------------------------------------

function loadSpecIndex(projectDir) {
  const indexPath = join(projectDir, 'docs', 'spec', '_generated', 'index.json')
  if (!existsSync(indexPath)) return null
  try {
    return JSON.parse(readFileSync(indexPath, 'utf8'))
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Minimal YAML frontmatter parser (only simple scalar values)
// ---------------------------------------------------------------------------

function parseSimpleFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return {}
  const result = {}
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/)
    if (!m) continue
    const val = m[2].trim().replace(/^['"]|['"]$/g, '')
    result[m[1]] = val === 'null' ? null : val
  }
  return result
}

// ---------------------------------------------------------------------------
// RFC discovery and spec_delta parsing
// ---------------------------------------------------------------------------

/**
 * Find the RFC directory containing rfc.md for the given uid.
 * Returns the directory path or null.
 */
function findRfcDirSync(projectDir, uid) {
  const rfcsDir = join(projectDir, '.groundwork', 'rfcs')
  if (!existsSync(rfcsDir)) return null
  let entries
  try { entries = readdirSync(rfcsDir) } catch { return null }
  for (const name of entries) {
    const dir = join(rfcsDir, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    const rfcPath = join(dir, 'rfc.md')
    if (!existsSync(rfcPath)) continue
    try {
      const content = readFileSync(rfcPath, 'utf8')
      if (content.includes(`uid: ${uid}`)) return dir
    } catch { continue }
  }
  return null
}

/**
 * Parse the spec_delta block from rfc.md content.
 * Returns an array of target path strings.
 */
function parseSpecDeltaTargets(rfcContent) {
  const targets = []
  // Match the YAML spec_delta list block (indented lines after spec_delta:)
  const specDeltaMatch = rfcContent.match(/^spec_delta:\s*\n((?:[ \t].*\n)*)/m)
  if (!specDeltaMatch) return targets
  for (const line of specDeltaMatch[1].split('\n')) {
    const m = line.match(/^\s+target:\s*(.+)$/)
    if (m) targets.push(m[1].trim())
  }
  return targets
}

// ---------------------------------------------------------------------------
// Steering invariant checks
// ---------------------------------------------------------------------------

/**
 * Returns an array of violation description strings for a spec node.
 * @param {object} node - index node (id, type, title, ears, summary, relPath, concept)
 * @param {object} rawFm - parsed frontmatter from the markdown file
 */
function checkNodeInvariants(node, rawFm) {
  const violations = []

  // Invariant 1: title must be present and non-empty.
  if (!node.title || !node.title.trim()) {
    violations.push(`title-present: node "${node.id}" has no title`)
  }

  // Invariant 2: requirement nodes must have ears or summary.
  const isRequirement = node.type === 'requirement' || (node.concept && node.type !== 'concept')
  if (isRequirement) {
    if (!(node.ears && node.ears.trim()) && !(node.summary && node.summary.trim())) {
      violations.push(`ears-or-summary: requirement "${node.id}" has neither ears nor summary`)
    }
  }

  // Invariant 3: origin_rfc must be present in the markdown frontmatter.
  if (!rawFm.origin_rfc || !rawFm.origin_rfc.trim() || rawFm.origin_rfc === 'null') {
    violations.push(`origin-rfc: node "${node.id}" has no origin_rfc in frontmatter`)
  }

  return violations
}

// ---------------------------------------------------------------------------
// Journal LINT_DRIFT event emitter (best-effort)
// ---------------------------------------------------------------------------

function emitLintDrift(projectDir, rfcUid, nodeId, violation) {
  try {
    const journalPath = join(projectDir, 'hooks', 'journal.mjs')
    if (!existsSync(journalPath)) return
    // Extract invariant name from the violation string (before first colon)
    const invariant = violation.split(':')[0].trim()
    spawnSync('node', [
      journalPath,
      'append',
      '--rfc', rfcUid,
      '--type', 'LINT_DRIFT',
      '--msg', `steering invariant violation on ${nodeId}: ${violation}`,
      '--data', JSON.stringify({ node_id: nodeId, invariant }),
    ], { stdio: 'pipe', cwd: projectDir })
  } catch { /* best-effort — never fail the caller */ }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function usage() {
  process.stdout.write(`Usage: spec lint [--rfc <uid>]

  Without --rfc: check every spec node against steering invariants.
    Violations are printed to stdout and recorded as LINT_DRIFT journal events.
    Exit 0 always (informational).

  With --rfc <uid>: check only spec nodes in that RFC's spec_delta.
    Violations are printed to stderr and recorded as LINT_DRIFT journal events.
    Exit 1 if any violation; exit 0 if clean.

Steering invariants:
  title-present   every spec node must have a non-empty title
  ears-or-summary requirement nodes must have ears or summary
  origin-rfc      every node must declare origin_rfc in frontmatter

Steering files are opened read-only; this command never writes to docs/steering/.

Exit codes: 0 success  1 violations (--rfc mode)  2 usage error
`)
}

const argv = process.argv.slice(2)
if (argv.includes('--help') || argv.includes('-h')) {
  usage()
  process.exit(0)
}

const rfcIdx = argv.indexOf('--rfc')
const rfcFlagPresent = rfcIdx >= 0
const rfcUidRaw = rfcFlagPresent ? argv[rfcIdx + 1] : undefined
// --rfc with missing or flag-like value is a usage error
const rfcUid = rfcFlagPresent && rfcUidRaw && !rfcUidRaw.startsWith('-') ? rfcUidRaw : null
const rfcMode = rfcUid != null

if (rfcFlagPresent && !rfcMode) {
  process.stderr.write('spec lint: --rfc requires a uid argument\n')
  process.exit(2)
}

const projectDir = process.env.GROUNDWORK_PROJECT_DIR ?? findProjectRoot()
const specDir = join(projectDir, 'docs', 'spec')

// Load the spec index.
const index = loadSpecIndex(projectDir)
if (!index) {
  process.stderr.write(`spec lint: spec index not found. Run "spec build" first.\n`)
  process.exit(1)
}

const allNodes = Object.values(index.nodes ?? {})
let targetNodes = allNodes
const rfcForJournal = rfcUid ?? 'R-unknown'

if (rfcMode) {
  const rfcDir = findRfcDirSync(projectDir, rfcUid)
  if (!rfcDir) {
    process.stderr.write(`spec lint: RFC "${rfcUid}" not found under .groundwork/rfcs/\n`)
    process.exit(1)
  }
  const rfcContent = readFileSync(join(rfcDir, 'rfc.md'), 'utf8')
  const deltaPaths = parseSpecDeltaTargets(rfcContent)

  // Convert delta paths to relPath format (strip docs/spec/ prefix)
  const deltaRelPaths = new Set(deltaPaths.map(p => p.replace(/^docs\/spec\//, '')))

  targetNodes = allNodes.filter(n =>
    deltaRelPaths.has(n.relPath) || deltaRelPaths.has(n.id) || deltaPaths.includes(n.id),
  )

  if (targetNodes.length === 0) {
    process.stdout.write(`spec lint --rfc ${rfcUid}: no spec nodes matched spec_delta targets.\n`)
    process.stdout.write(`targets: ${deltaPaths.join(', ') || '(none)'}\n`)
    process.exit(0)
  }
}

// Check each node.
const violations = []

for (const node of targetNodes) {
  let rawFm = {}
  if (node.relPath) {
    const absPath = join(specDir, node.relPath)
    if (existsSync(absPath)) {
      try { rawFm = parseSimpleFrontmatter(readFileSync(absPath, 'utf8')) } catch { /* ignore */ }
    }
  }

  for (const v of checkNodeInvariants(node, rawFm)) {
    violations.push({ nodeId: node.id, violation: v })
    emitLintDrift(projectDir, rfcForJournal, node.id, v)
  }
}

if (violations.length === 0) {
  process.stdout.write(rfcMode
    ? `spec lint --rfc ${rfcUid}: clean — no violations found.\n`
    : 'spec lint: clean — no steering invariant violations found.\n')
  process.exit(0)
}

const lines = violations.map(({ nodeId, violation }) => `LINT_DRIFT ${nodeId}: ${violation}`)
const out = rfcMode ? process.stderr : process.stdout
out.write(lines.join('\n') + '\n')
out.write(`\n${violations.length} violation${violations.length !== 1 ? 's' : ''} found.\n`)

if (rfcMode) process.exit(1)
