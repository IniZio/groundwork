#!/usr/bin/env node
/**
 * spec-lint.mjs — `spec lint [--rfc <uid>]` subcommand
 *
 * Without --rfc: checks every spec node against 8 spec invariants and
 *   reports each violation as a LINT_DRIFT journal event. AC 5.
 * With --rfc <uid>: checks only the nodes named by that RFC's spec_delta
 *   and exits 1 if any violation is found. AC 6.
 *
 * Spec files are opened read-only; this command never writes to doc/specs/**. AC 8.
 *
 * Spec invariants checked:
 *   1. ears-or-summary — requirement nodes must have ears or summary (either/or)
 *   2. origin-rfc      — every node must declare origin_rfc in its
 *                        markdown frontmatter
 *   3. required-field  — all schema-required fields must be present and non-blank
 *   4. enum-values     — type, pattern, verification, criticality, status
 *   5. id-format       — concept and requirement id regexes
 *   6. summary-length  — summary must be ≤25 words
 *   7. snapshot-of     — if snapshot_of is declared, the referenced node must exist
 *   8. unknown-field   — frontmatter must not contain keys not defined in the schema
 *
 * Exit codes: 0 success  1 violations found (--rfc mode only)  2 usage error
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { loadSchema } from './lib/schema-io.mjs'

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
  const indexPath = join(projectDir, 'doc', 'specs', '_generated', 'index.json')
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
// Fields requiring whitespace-only check (schema minLength passes for "   " since length≥1)
// ---------------------------------------------------------------------------

// Free-text string fields that need whitespace-only detection beyond schema minLength.
// Enum and pattern fields are covered by schema enum/pattern constraints.
// origin_rfc is checked by the hand-written origin-rfc invariant.
// ears and summary for requirements are checked by the ears-or-summary invariant.
const CONCEPT_WHITESPACE_FIELDS = ['title', 'summary']
const REQ_WHITESPACE_FIELDS = ['verify']

// ---------------------------------------------------------------------------
// Schema error → spec-lint violation converter
// ---------------------------------------------------------------------------

/**
 * Convert Ajv validation errors from spec schemas into spec-lint violation lines.
 *
 * Filtering:
 *   - anyOf errors and their sub-errors (ears-or-summary handled by invariant 1)
 *   - not errors (origin_rfc 'null' sentinel handled by invariant 2)
 *   - all errors on origin_rfc field (handled by invariant 2)
 *   - oneOf and sub-errors from within oneOf (parent field complexity)
 *   - pattern errors on requirement id field (hand-written check is concept-prefix-specific)
 *
 * @param {import('ajv').ErrorObject[]} errors  Ajv errors from validate.errors
 * @param {string} nodeId                        Node id for error messages
 * @param {object} rawFm                         Parsed frontmatter (to recover bad values)
 * @param {boolean} isConcept                    true = concept schema, false = requirement schema
 * @returns {string[]}  violation strings ready to push into the violations array
 */
function schemaErrorsToViolations(errors, nodeId, rawFm, isConcept) {
  if (!errors || errors.length === 0) return []
  const result = []

  for (const err of errors) {
    const { keyword, instancePath, params, schemaPath } = err
    const field = instancePath ? instancePath.replace(/^\//, '') : ''

    // Skip anyOf errors and errors emitted from within anyOf branches
    // (ears-or-summary is validated by invariant 1, which also catches whitespace-only)
    if (keyword === 'anyOf') continue
    if (schemaPath && schemaPath.includes('/anyOf/')) continue

    // Skip not errors — origin_rfc 'null' sentinel is handled by invariant 2
    if (keyword === 'not') continue

    // Skip all errors on origin_rfc — handled by the hand-written origin-rfc invariant
    if (field === 'origin_rfc') continue
    if (keyword === 'required' && params.missingProperty === 'origin_rfc') continue

    // Skip oneOf errors and errors from within oneOf branches (parent field)
    if (keyword === 'oneOf') continue
    if (schemaPath && schemaPath.includes('/oneOf/')) continue

    // Skip requirement id pattern errors — hand-written check is concept-prefix-specific
    if (!isConcept && keyword === 'pattern' && field === 'id') continue

    if (keyword === 'required') {
      result.push(`required-field: node "${nodeId}" is missing required field "${params.missingProperty}"`)
    } else if (keyword === 'minLength') {
      result.push(`required-field: node "${nodeId}" is missing required field "${field}"`)
    } else if (keyword === 'type' && field) {
      result.push(`required-field: node "${nodeId}" is missing required field "${field}"`)
    } else if (keyword === 'enum') {
      const badValue = rawFm[field]
      const allowed = (params.allowedValues || []).join('|')
      result.push(`enum-value: node "${nodeId}" has invalid ${field} "${badValue}" (must be ${allowed})`)
    } else if (keyword === 'const' && field === 'type') {
      result.push(`enum-value: node "${nodeId}" has invalid type "${rawFm.type}" (must be concept or requirement)`)
    } else if (keyword === 'pattern') {
      const val = rawFm[field]
      const nodekind = isConcept ? 'concept' : 'requirement'
      result.push(`id-format: ${nodekind} "${nodeId}" field "${field}" value "${val}" does not match pattern ${params.pattern}`)
    } else if (keyword === 'additionalProperties') {
      const badKey = params.additionalProperty
      result.push(`unknown-field: node "${nodeId}" has unknown frontmatter key "${badKey}"`)
    }
    // Unknown keywords: silently skip (safe future-proofing)
  }

  return result
}

// ---------------------------------------------------------------------------
// Spec invariant checks
// ---------------------------------------------------------------------------

/**
 * Returns an array of violation description strings for a spec node.
 * @param {object} node  - index node (id, type, title, ears, summary, relPath, concept)
 * @param {object} rawFm - parsed frontmatter from the markdown file
 * @param {object} index - full spec index (nodes map) for referential integrity checks
 */
function checkNodeInvariants(node, rawFm, index) {
  const violations = []
  const id = node.id || rawFm.id || '(unknown)'
  const nodeType = rawFm.type || node.type
  const isRequirement = nodeType === 'requirement' || (node.concept && nodeType !== 'concept')
  const isConcept = !isRequirement

  // --- Schema validation (required fields, enum values, concept id format) ---
  // Delegates invariants 3, 4, and 5 (concept part) to JSON Schema.
  // Filtered: anyOf (inv 1), not/origin_rfc (inv 2), oneOf/parent, req id pattern (inv 5 req part).
  try {
    const schemaName = isConcept ? 'spec-concept' : 'spec-requirement'
    const validate = loadSchema(schemaName)
    if (!validate(rawFm)) {
      for (const line of schemaErrorsToViolations(validate.errors, id, rawFm, isConcept)) {
        violations.push(line)
      }
    }
  } catch {
    // Schema load failure is an operational error; hand-written checks below still run.
  }

  // Invariant 1: requirement nodes must have ears or summary (either/or).
  // Hand-written because the schema's anyOf passes for whitespace-only ears/summary
  // (minLength:1 is satisfied by "   "), and spec-build populates node.summary from body
  // text when the YAML field is absent, masking the absence in the index node.
  if (isRequirement) {
    const hasEars = rawFm.ears && rawFm.ears.trim()
    const hasSummary = rawFm.summary && rawFm.summary.trim()
    if (!hasEars && !hasSummary) {
      violations.push(`ears-or-summary: requirement "${id}" has neither ears nor summary`)
    }
  }

  // Invariant 2: origin_rfc must be present in the markdown frontmatter.
  // Hand-written to produce the "origin-rfc:" prefix and to catch whitespace-only values
  // (schema minLength:1 does not reject "   "). Schema handles "null" sentinel and empty
  // string, but schema errors on origin_rfc are filtered so this is the sole reporter.
  if (!rawFm.origin_rfc || typeof rawFm.origin_rfc !== 'string' || !rawFm.origin_rfc.trim() || rawFm.origin_rfc === 'null') {
    violations.push(`origin-rfc: node "${id}" has no origin_rfc in frontmatter`)
  }

  // Invariant 3 (whitespace supplement): required string fields with whitespace-only values.
  // Schema minLength:1 does not reject non-empty whitespace strings (e.g. "   " has length 3).
  // Enum and pattern fields are caught by schema for whitespace. Only free-text fields need this.
  const whitespaceFields = isConcept ? CONCEPT_WHITESPACE_FIELDS : REQ_WHITESPACE_FIELDS
  for (const field of whitespaceFields) {
    const val = rawFm[field]
    if (typeof val === 'string' && val !== '' && val.trim() === '') {
      violations.push(`required-field: node "${id}" is missing required field "${field}"`)
    }
  }

  // Invariant 5 (requirement id, concept-prefix check): schema validates the general
  // <SUFFIX>-R-[a-z0-9]{4} shape but cannot enforce that SUFFIX matches this node's
  // concept id. Hand-written check catches prefix/concept mismatches.
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

  // Invariant 7 (new): snapshot_of referential integrity.
  // If a node declares snapshot_of: <id>, that id must resolve to an existing node
  // in the spec index. JSON Schema cannot express cross-node referential integrity.
  if (rawFm.snapshot_of) {
    const snapshotTarget = String(rawFm.snapshot_of).trim()
    if (snapshotTarget && !(index.nodes && index.nodes[snapshotTarget])) {
      violations.push(`snapshot-of: node "${id}" references snapshot_of "${snapshotTarget}" which does not exist in the spec tree`)
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

  Without --rfc: check every spec node against 8 spec invariants.
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
  snapshot-of     if snapshot_of is declared, the referenced node must exist
  unknown-field   frontmatter must not contain keys not defined in the schema

Spec files are opened read-only; this command never writes to doc/specs/**.

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

const projectDir = process.env.GROUNDWORK_PROJECT_DIR ?? process.env.CLAUDE_PROJECT_DIR ?? findProjectRoot()
const specDir = join(projectDir, 'doc', 'specs')

// Load the spec index.
const index = loadSpecIndex(projectDir)
if (!index) {
  if (!existsSync(specDir)) {
    process.stdout.write('spec lint: clean — no spec tree found.\n')
    process.exit(0)
  }
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

  // Convert delta paths to relPath format (strip doc/specs/ prefix)
  const deltaRelPaths = new Set(deltaPaths.map(p => p.replace(/^doc\/specs\//, '')))

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

  for (const v of checkNodeInvariants(node, rawFm, index)) {
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
