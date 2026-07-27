#!/usr/bin/env node
/**
 * spec-lint.mjs — `spec lint [--rfc <uid>]` subcommand
 *
 * Without --rfc: checks every spec node against 6 spec invariants and
 *   reports each violation as a LINT_DRIFT journal event. AC 5.
 * With --rfc <uid>: checks only the nodes named by that RFC's spec_delta
 *   and exits 1 if any violation is found. AC 6.
 *
 * Spec files are opened read-only; this command never writes to docs/spec/**. AC 8.
 *
 * Spec invariants checked:
 *   1. ears-or-summary — requirement nodes must have ears or summary (either/or)
 *   2. origin-rfc      — every node must declare origin_rfc in its
 *                        markdown frontmatter
 *   3. required-field  — all schema-required fields must be present and non-blank
 *   4. enum-values     — type, pattern, verification, criticality, status
 *   5. id-format       — concept and requirement id regexes
 *   6. summary-length  — summary must be ≤25 words
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
    const rawVal = m[2].trim()
    // Check for the unquoted YAML null scalar BEFORE stripping quotes, so that
    // a quoted "null" string is preserved as the string 'null' (making the
    // sentinel check `rawFm.origin_rfc === 'null'` reachable for that case).
    const val = rawVal === 'null' ? null : rawVal.replace(/^['"]|['"]$/g, '')
    result[m[1]] = val
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
// Schema constants (RFC §2.2 concept nodes, §2.3 requirement nodes)
// ---------------------------------------------------------------------------

// Required fields per node type
const CONCEPT_REQUIRED = ['id', 'type', 'title', 'summary', 'parent', 'origin_rfc']
// ears and summary are intentionally omitted from REQ_REQUIRED: the either/or
// rule ("ears or summary") is enforced by the ears-or-summary invariant below,
// which gives a clearer error message than two individual required-field hits.
const REQ_REQUIRED = ['id', 'type', 'concept', 'pattern', 'verify', 'verification', 'origin_rfc', 'status']

// Valid enum values
const VALID_PATTERN = new Set(['ubiquitous', 'event', 'state', 'option', 'unwanted'])
const VALID_VERIFICATION = new Set(['automated', 'manual', 'hybrid'])
const VALID_CRITICALITY = new Set(['must', 'should'])
const VALID_STATUS = new Set(['active', 'superseded', 'withdrawn'])

// Id regexes (RFC §2.2, §2.3)
const CONCEPT_ID_RE = /^C-[A-Z0-9]+(-[A-Z0-9]+)*$/
// Requirement ids: <CONCEPT-SUFFIX>-R-[a-z0-9]{4} (suffix = concept id with C- removed)

// ---------------------------------------------------------------------------
// Spec invariant checks
// ---------------------------------------------------------------------------

/**
 * Returns an array of violation description strings for a spec node.
 * @param {object} node - index node (id, type, title, ears, summary, relPath, concept)
 * @param {object} rawFm - parsed frontmatter from the markdown file
 */
function checkNodeInvariants(node, rawFm) {
  const violations = []
  const id = node.id || rawFm.id || '(unknown)'
  const nodeType = rawFm.type || node.type
  const isRequirement = nodeType === 'requirement' || (node.concept && nodeType !== 'concept')
  const isConcept = !isRequirement

  // Invariant 1: requirement nodes must have ears or summary (either/or).
  // Uses rawFm (frontmatter) — not the index node — because spec-build populates
  // node.summary from body text when the YAML field is absent, masking the absence.
  // ears and summary are not in REQ_REQUIRED so this is the sole check for them.
  if (isRequirement) {
    const hasEars = rawFm.ears && rawFm.ears.trim()
    const hasSummary = rawFm.summary && rawFm.summary.trim()
    if (!hasEars && !hasSummary) {
      violations.push(`ears-or-summary: requirement "${id}" has neither ears nor summary`)
    }
  }

  // Invariant 2: origin_rfc must be present in the markdown frontmatter.
  if (!rawFm.origin_rfc || !rawFm.origin_rfc.trim() || rawFm.origin_rfc === 'null') {
    violations.push(`origin-rfc: node "${id}" has no origin_rfc in frontmatter`)
  }

  // Invariant 3: required fields must be present and non-blank.
  // Note: `parent` accepts explicit null (root concept); all other required fields must be non-null, non-blank strings.
  const requiredFields = isRequirement ? REQ_REQUIRED : CONCEPT_REQUIRED
  for (const field of requiredFields) {
    const val = rawFm[field]
    if (field === 'parent') {
      // null is explicitly valid (root concept); only truly absent (undefined) is a violation
      if (val === undefined) {
        violations.push(`required-field: node "${id}" is missing required field "${field}"`)
      }
    } else if (val === undefined || val === null || val === '' || (typeof val === 'string' && val.trim() === '')) {
      violations.push(`required-field: node "${id}" is missing required field "${field}"`)
    }
  }

  // Invariant 4: enum values must be valid.
  if (rawFm.type && rawFm.type !== 'concept' && rawFm.type !== 'requirement') {
    violations.push(`enum-value: node "${id}" has invalid type "${rawFm.type}" (must be concept or requirement)`)
  }
  if (isRequirement) {
    if (rawFm.pattern && !VALID_PATTERN.has(rawFm.pattern)) {
      violations.push(`enum-value: node "${id}" has invalid pattern "${rawFm.pattern}" (must be ubiquitous|event|state|option|unwanted)`)
    }
    if (rawFm.verification && !VALID_VERIFICATION.has(rawFm.verification)) {
      violations.push(`enum-value: node "${id}" has invalid verification "${rawFm.verification}" (must be automated|manual|hybrid)`)
    }
    if (rawFm.criticality && !VALID_CRITICALITY.has(rawFm.criticality)) {
      violations.push(`enum-value: node "${id}" has invalid criticality "${rawFm.criticality}" (must be must|should)`)
    }
    if (rawFm.status && !VALID_STATUS.has(rawFm.status)) {
      violations.push(`enum-value: node "${id}" has invalid status "${rawFm.status}" (must be active|superseded|withdrawn)`)
    }
  }

  // Invariant 5: id format must match schema regex.
  if (isConcept && rawFm.id) {
    if (!CONCEPT_ID_RE.test(rawFm.id)) {
      violations.push(`id-format: concept "${rawFm.id}" does not match pattern ^C-[A-Z0-9]+(-[A-Z0-9]+)*$`)
    }
  }
  if (isRequirement && rawFm.id) {
    const conceptId = rawFm.concept || ''
    const suffix = conceptId.replace(/^C-/, '')
    if (suffix) {
      const reqIdRe = new RegExp(`^${suffix}-R-[a-z0-9]{4}$`)
      if (!reqIdRe.test(rawFm.id)) {
        violations.push(`id-format: requirement "${rawFm.id}" does not match pattern ${suffix}-R-[a-z0-9]{4}`)
      }
    } else {
      if (!/^[A-Z0-9]+(-[A-Z0-9]+)*-R-[a-z0-9]{4}$/.test(rawFm.id)) {
        violations.push(`id-format: requirement "${rawFm.id}" does not match pattern <SUFFIX>-R-[a-z0-9]{4}`)
      }
    }
  }

  // Invariant 6: summary must be ≤25 words.
  const summary = rawFm.summary || node.summary
  if (summary && summary.trim()) {
    const wordCount = summary.trim().split(/\s+/).length
    if (wordCount > 25) {
      violations.push(`summary-length: node "${id}" summary has ${wordCount} words (max 25)`)
    }
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
      '--msg', `spec invariant violation on ${nodeId}: ${violation}`,
      '--data', JSON.stringify({ node_id: nodeId, invariant }),
    ], { stdio: 'pipe', cwd: projectDir })
  } catch { /* best-effort — never fail the caller */ }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function usage() {
  process.stdout.write(`Usage: spec lint [--rfc <uid>]

  Without --rfc: check every spec node against 6 spec invariants.
    Violations are printed to stdout and recorded as LINT_DRIFT journal events.
    Exit 0 always (informational).

  With --rfc <uid>: check only spec nodes in that RFC's spec_delta.
    Violations are printed to stderr and recorded as LINT_DRIFT journal events.
    Exit 1 if any violation; exit 0 if clean.

Spec invariants:
  ears-or-summary requirement nodes must have ears or summary (either/or)
  origin-rfc      every node must declare origin_rfc in frontmatter
  required-field  all schema-required fields must be present and non-blank
  enum-values     type, pattern, verification, criticality, status
  id-format       concept and requirement id regexes
  summary-length  summary must be ≤25 words

Spec files are opened read-only; this command never writes to docs/spec/**.

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

  // FIX 3: Verify each spec_delta target path exists on disk. A delta pointing
  // at a nonexistent path is always a lint failure — fail-open hides typos.
  const missingPaths = deltaPaths.filter(t => !existsSync(join(projectDir, t)))
  if (missingPaths.length > 0) {
    for (const mp of missingPaths) {
      process.stderr.write(`spec lint: spec_delta target does not exist on disk: ${mp}\n`)
    }
    process.exit(1)
  }

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
    : 'spec lint: clean — no spec invariant violations found.\n')
  process.exit(0)
}

const lines = violations.map(({ nodeId, violation }) => `LINT_DRIFT ${nodeId}: ${violation}`)
const out = rfcMode ? process.stderr : process.stdout
out.write(lines.join('\n') + '\n')
out.write(`\n${violations.length} violation${violations.length !== 1 ? 's' : ''} found.\n`)

if (rfcMode) process.exit(1)
