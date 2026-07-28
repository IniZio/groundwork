#!/usr/bin/env node
/**
 * spec-lint.mjs — `spec lint [--rfc <uid>]` subcommand
 *
 * Without --rfc: checks every spec node against spec invariants, prints each
 *   violation to stdout, and exits 1 if any violations are found.
 * With --rfc <uid>: checks only the nodes named by that RFC's spec_delta.
 *   Exits 1 if any violation is found.
 *
 * Spec files are opened read-only; this command never writes to doc/specs/**. AC 8.
 *
 * Invariants checked:
 *   Body-format requirement invariants (requirements.md H3 sections):
 *     stale-frontmatter    — ears or verify in any frontmatter → violation
 *     normative-statement  — body must contain a normative statement with bolded **shall**
 *     why-required         — every requirement body must have a **Why** rationale
 *     fit-criterion        — every requirement body must have a **Fit criterion**
 *     anchor-mismatch      — {#anchor} must equal id lowercased
 *     xref-dangling        — cross-references must resolve (same-file and relative-path)
 *     id-format            — requirement ids must be <CONCEPT>-R-NNN (exactly 3 zero-padded digits)
 *   All node invariants (concept README.md and other nodes):
 *     origin-rfc           — every node must declare origin_rfc in its frontmatter
 *     required-field       — all schema-required fields must be present and non-blank
 *     enum-values          — type, pattern, verification, criticality, status
 *     summary-length       — summary must be ≤25 words
 *     snapshot-of          — if snapshot_of is declared, the referenced node must exist
 *     unknown-field        — frontmatter must not contain keys not defined in the schema
 *   Traceability invariants (requirement nodes only):
 *     automated-unverified — every automated requirement must have ≥1 test carrying // @verifies <id>
 *   S1 manifest invariants (concept nodes with spec.yaml):
 *     manifest-invalid     — spec.yaml must be valid per the spec-manifest schema
 *     missing-view-file    — every declared view file must exist on disk
 *     required-field       — view file frontmatter must have type and id fields
 *     unknown-field        — view file frontmatter must have no extra fields
 *     unsupported-source   — lint.data-model.type_names.source must be 'types'
 *     type-name-missing    — named TypeScript types must exist in src/
 *     operation-missing    — named CLI operations must exist in hooks/*.mjs
 *     manifest-mismatch    — spec.yaml id/title/summary must match README.md
 *
 * Exit codes: 0 success  1 violations found (both modes)  2 usage error
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { load as yamlLoad } from 'js-yaml'
import { loadSchema } from './lib/schema-io.mjs'
import {
  parseRequirementsDocument,
  parseYamlFrontmatter,
  ALLOWED_FRONTMATTER_FIELDS,
} from './lib/spec-io.mjs'
import { verifiedIds } from './lib/verifies-scan.mjs'

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
// Local spec.yaml manifest loader (sync; mirrors spec-io's private _loadSpecManifestSync)
// ---------------------------------------------------------------------------

/**
 * Load and validate spec.yaml for a concept directory synchronously.
 *
 * @param {string} conceptDir  Absolute path to the concept directory.
 * @returns {{ manifest: object|null, errors: {field: string, problem: string}[] }}
 */
function loadSpecManifestSync(conceptDir) {
  const p = join(conceptDir, 'spec.yaml')
  if (!existsSync(p)) return { manifest: null, errors: [] }
  let raw
  try { raw = readFileSync(p, 'utf8') } catch { return { manifest: null, errors: [] } }
  let manifest
  try { manifest = yamlLoad(raw) } catch (e) {
    return { manifest: null, errors: [{ field: 'spec.yaml', problem: `YAML parse error: ${e.message}` }] }
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { manifest: null, errors: [{ field: '(root)', problem: 'spec.yaml must be a YAML mapping object' }] }
  }
  const validate = loadSchema('spec-manifest')
  const valid = validate(manifest)
  if (valid) return { manifest, errors: [] }
  const errors = (validate.errors || []).map(err => ({
    field: err.keyword === 'required'
      ? (err.params?.missingProperty || '(root)')
      : (err.instancePath ? err.instancePath.replace(/^\//, '') : '(root)'),
    problem: err.message || 'invalid',
  }))
  return { manifest, errors }
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
    // S2+: try rfc.yaml sidecar first (uid field moved out of rfc.md prose)
    const yamlPath = join(dir, 'rfc.yaml')
    if (existsSync(yamlPath)) {
      try {
        const parsed = yamlLoad(readFileSync(yamlPath, 'utf8'))
        if (parsed && parsed.uid === uid) return dir
      } catch { /* fall through to rfc.md check */ }
    }
    // Legacy: uid may still be in rfc.md frontmatter or body
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
  const specDeltaMatch = rfcContent.match(/^spec_delta:\s*\n((?:[ \t].*\n)*)/m)
  if (!specDeltaMatch) return targets
  for (const line of specDeltaMatch[1].split('\n')) {
    const m = line.match(/^\s+target:\s*(.+)$/)
    if (m) targets.push(m[1].trim())
  }
  return targets
}

// ---------------------------------------------------------------------------
// Strict requirement ID pattern (RFC-0003): <CONCEPT>-R-NNN, 3 zero-padded digits
// ---------------------------------------------------------------------------

const STRICT_REQ_ID_RE = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-R-\d{3}$/

// ---------------------------------------------------------------------------
// Fields requiring whitespace-only check for concept nodes
// ---------------------------------------------------------------------------

const CONCEPT_WHITESPACE_FIELDS = ['title', 'summary']

// ---------------------------------------------------------------------------
// Schema error → spec-lint violation converter (for concept schema validation)
// ---------------------------------------------------------------------------

/**
 * Convert Ajv validation errors from the concept schema into violation strings.
 *
 * @param {import('ajv').ErrorObject[]} errors  Ajv errors from validate.errors
 * @param {string} nodeId                        Node id for error messages
 * @param {object} rawFm                         Parsed frontmatter
 * @returns {string[]}  violation strings
 */
function schemaErrorsToViolations(errors, nodeId, rawFm) {
  if (!errors || errors.length === 0) return []
  const result = []

  for (const err of errors) {
    const { keyword, instancePath, params, schemaPath } = err
    const field = instancePath ? instancePath.replace(/^\//, '') : ''

    // Skip not errors — origin_rfc 'null' sentinel is handled by origin-rfc invariant
    if (keyword === 'not') continue

    // Skip all errors on origin_rfc — handled by the hand-written origin-rfc invariant
    if (field === 'origin_rfc') continue
    if (keyword === 'required' && params.missingProperty === 'origin_rfc') continue

    // Skip oneOf errors and errors from within oneOf branches (parent field)
    if (keyword === 'oneOf') continue
    if (schemaPath && schemaPath.includes('/oneOf/')) continue

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
      result.push(`id-format: concept "${nodeId}" field "${field}" value "${val}" does not match pattern ${params.pattern}`)
    } else if (keyword === 'additionalProperties') {
      const badKey = params.additionalProperty
      result.push(`unknown-field: node "${nodeId}" has unknown frontmatter key "${badKey}"`)
    }
    // Unknown keywords: silently skip (safe future-proofing)
  }

  return result
}

// ---------------------------------------------------------------------------
// Body-format requirements.md processing (RFC-0003)
// ---------------------------------------------------------------------------

/**
 * Extract section raw chunks from a requirements.md body, keyed by requirement id.
 * Used for scanning relative-path cross-references that are not captured by seeAlso.
 *
 * @param {string} fileContent
 * @returns {Map<string, string>}  id → raw chunk text
 */
function getSectionChunks(fileContent) {
  const { body } = parseYamlFrontmatter(fileContent)
  const chunks = body.split(/^(?=### )/m)
  const map = new Map()
  const HEADING_RE = /^### ([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-R-\S+)/
  for (const chunk of chunks) {
    if (!chunk.startsWith('### ')) continue
    const firstLine = chunk.split('\n')[0]
    const hm = firstLine.match(HEADING_RE)
    if (hm) map.set(hm[1], chunk)
  }
  return map
}

/**
 * Extract relative-path cross-reference links from a section body chunk.
 * Matches [text](path#anchor) where path is a relative filesystem path.
 * Same-file #anchor links (handled via seeAlso) are excluded.
 *
 * @param {string} text  Raw section body text
 * @returns {{ filePart: string, anchor: string }[]}
 */
function extractRelativeLinks(text) {
  const links = []
  // Match [text](href) where href contains both a path component and a # anchor
  const re = /\[([^\]]*)\]\(([^)]+)\)/g
  let m
  while ((m = re.exec(text)) !== null) {
    const href = m[2].trim()
    // Skip http(s) links and pure same-file anchor links (those are in seeAlso)
    if (href.startsWith('http://') || href.startsWith('https://')) continue
    if (href.startsWith('#')) continue
    // Must contain # to be a file+anchor link
    const hashIdx = href.lastIndexOf('#')
    if (hashIdx < 0) continue
    const filePart = href.slice(0, hashIdx)
    const anchor = href.slice(hashIdx + 1)
    if (filePart && anchor) links.push({ filePart, anchor })
  }
  return links
}

/**
 * Check a requirements.md file's frontmatter and all (or target) requirement sections.
 *
 * @param {string}   fileContent   Raw file text
 * @param {string}   fileAbsPath   Absolute path to the file (for resolving relative refs)
 * @param {object[]} targetNodes   Index nodes from this file that should be checked
 * @param {boolean}  rfcMode       When true, only check sections in targetNodes
 * @returns {{ nodeId: string, violation: string }[]}
 */
function checkRequirementsFile(fileContent, fileAbsPath, targetNodes, rfcMode) {
  const violations = []
  const { data: fileFm } = parseYamlFrontmatter(fileContent)
  const fileLabel = basename(fileAbsPath)
  const firstNodeId = targetNodes[0]?.id || '(file)'

  // Stale frontmatter: ears and verify moved to body in RFC-0003
  if (Object.prototype.hasOwnProperty.call(fileFm, 'ears')) {
    violations.push({
      nodeId: firstNodeId,
      violation: `stale-frontmatter: file "${fileLabel}" has "ears" in frontmatter (EARS sentence belongs in body prose)`,
    })
  }
  if (Object.prototype.hasOwnProperty.call(fileFm, 'verify')) {
    violations.push({
      nodeId: firstNodeId,
      violation: `stale-frontmatter: file "${fileLabel}" has "verify" in frontmatter (fit criterion belongs in body prose)`,
    })
  }

  // origin_rfc must be present at file level
  const originRfc = fileFm.origin_rfc
  if (!originRfc || typeof originRfc !== 'string' || !String(originRfc).trim() || originRfc === 'null') {
    violations.push({
      nodeId: firstNodeId,
      violation: `origin-rfc: file "${fileLabel}" has no origin_rfc in frontmatter`,
    })
  }

  // Parse body sections
  const sections = parseRequirementsDocument(fileContent)
  const fileAnchors = new Set(sections.map(s => s.anchor))
  const sectionChunks = getSectionChunks(fileContent)
  const targetIds = new Set(targetNodes.map(n => n.id))

  for (const section of sections) {
    // In RFC mode, only check sections present in targetNodes
    if (rfcMode && targetIds.size > 0 && !targetIds.has(section.id)) continue

    const id = section.id

    // Strict 3-digit ID format
    if (!STRICT_REQ_ID_RE.test(id)) {
      violations.push({
        nodeId: id,
        violation: `id-format: requirement "${id}" does not match <CONCEPT>-R-NNN (exactly 3 zero-padded digits)`,
      })
    }

    // Anchor must equal id lowercased
    if (section.anchor !== id.toLowerCase()) {
      violations.push({
        nodeId: id,
        violation: `anchor-mismatch: requirement "${id}" has anchor {#${section.anchor}} but expected {#${id.toLowerCase()}}`,
      })
    }

    // Normative statement with bolded **shall**
    if (!section.normativeStatement) {
      violations.push({
        nodeId: id,
        violation: `normative-statement: requirement "${id}" has no normative statement (no prose before first bullet)`,
      })
    } else if (!section.normativeStatement.includes('**shall**')) {
      violations.push({
        nodeId: id,
        violation: `normative-statement: requirement "${id}" normative statement does not contain bolded **shall**`,
      })
    }

    // Why — REQUIRED
    if (!section.why) {
      violations.push({
        nodeId: id,
        violation: `why-required: requirement "${id}" is missing **Why** rationale bullet`,
      })
    }

    // Fit criterion — REQUIRED
    if (!section.fitCriterion) {
      violations.push({
        nodeId: id,
        violation: `fit-criterion: requirement "${id}" is missing **Fit criterion** bullet`,
      })
    }

    // Same-file cross-references: must resolve to a section in this file
    for (const anchor of section.seeAlso) {
      if (!fileAnchors.has(anchor)) {
        violations.push({
          nodeId: id,
          violation: `xref-dangling: requirement "${id}" references non-existent same-file anchor #${anchor}`,
        })
      }
    }

    // Relative-path cross-references: file must exist and anchor must be present
    const rawChunk = sectionChunks.get(id) || ''
    for (const { filePart, anchor } of extractRelativeLinks(rawChunk)) {
      const targetAbsPath = resolve(dirname(fileAbsPath), filePart)
      if (!existsSync(targetAbsPath)) {
        violations.push({
          nodeId: id,
          violation: `xref-dangling: requirement "${id}" references non-existent file "${filePart}"`,
        })
      } else {
        try {
          const targetContent = readFileSync(targetAbsPath, 'utf8')
          const targetSections = parseRequirementsDocument(targetContent)
          const targetAnchors = new Set(targetSections.map(s => s.anchor))
          if (!targetAnchors.has(anchor)) {
            violations.push({
              nodeId: id,
              violation: `xref-dangling: requirement "${id}" references non-existent anchor #${anchor} in "${filePart}"`,
            })
          }
        } catch {
          violations.push({
            nodeId: id,
            violation: `xref-dangling: requirement "${id}" cannot read target file "${filePart}"`,
          })
        }
      }
    }
  }

  return violations
}

// ---------------------------------------------------------------------------
// Concept/metadata node invariant checks
// ---------------------------------------------------------------------------

/**
 * Check invariants for a concept or metadata node (README.md and other non-requirements.md files).
 *
 * @param {object} node   Index node
 * @param {object} rawFm  Parsed frontmatter from the source file
 * @param {object} index  Full spec index (for referential integrity)
 * @returns {string[]}  violation description strings
 */
function checkNodeInvariants(node, rawFm, index) {
  const violations = []
  const id = node.id || rawFm.id || '(unknown)'
  const nodeType = rawFm.type || node.type
  const isRequirement = nodeType === 'requirement' || (node.concept && nodeType !== 'concept')
  const isConcept = !isRequirement

  if (isConcept) {
    // Schema validation for concept nodes (handles required-field, enum-values, id-format, unknown-field)
    try {
      const validate = loadSchema('spec-concept')
      if (!validate(rawFm)) {
        for (const line of schemaErrorsToViolations(validate.errors, id, rawFm)) {
          violations.push(line)
        }
      }
    } catch {
      // Schema not found — hand-written checks below cover the essentials
    }

    // Whitespace-only required fields (schema minLength:1 passes for "   ")
    for (const field of CONCEPT_WHITESPACE_FIELDS) {
      const val = rawFm[field]
      if (typeof val === 'string' && val !== '' && val.trim() === '') {
        violations.push(`required-field: node "${id}" is missing required field "${field}"`)
      }
    }
  } else {
    // Old-format requirement nodes (not from requirements.md):
    // Check for stale fields that moved to body in RFC-0003
    if (Object.prototype.hasOwnProperty.call(rawFm, 'ears')) {
      violations.push(`stale-frontmatter: node "${id}" has "ears" in frontmatter (EARS sentence belongs in body prose)`)
    }
    if (Object.prototype.hasOwnProperty.call(rawFm, 'verify')) {
      violations.push(`stale-frontmatter: node "${id}" has "verify" in frontmatter (fit criterion belongs in body prose)`)
    }
    // Unknown fields check (for non-concept nodes not covered by schema)
    for (const field of Object.keys(rawFm)) {
      if (!ALLOWED_FRONTMATTER_FIELDS.has(field) && field !== 'ears' && field !== 'verify') {
        violations.push(`unknown-field: node "${id}" has unknown frontmatter key "${field}"`)
      }
    }
    // Strict requirement ID format
    if (rawFm.id && !STRICT_REQ_ID_RE.test(String(rawFm.id))) {
      violations.push(`id-format: requirement "${rawFm.id}" does not match <CONCEPT>-R-NNN (exactly 3 zero-padded digits)`)
    }
  }

  // origin_rfc must be present in frontmatter (all node types)
  if (!rawFm.origin_rfc || typeof rawFm.origin_rfc !== 'string' || !rawFm.origin_rfc.trim() || rawFm.origin_rfc === 'null') {
    violations.push(`origin-rfc: node "${id}" has no origin_rfc in frontmatter`)
  }

  // Summary length ≤25 words (all node types)
  const summary = rawFm.summary || node.summary
  if (summary && summary.trim()) {
    const wordCount = summary.trim().split(/\s+/).length
    if (wordCount > 25) {
      violations.push(`summary-length: node "${id}" summary has ${wordCount} words (max 25)`)
    }
  }

  // snapshot_of referential integrity (all node types)
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
// Usage
// ---------------------------------------------------------------------------

function usage() {
  process.stdout.write(`Usage: spec lint [--rfc <uid>]

  Without --rfc: check every spec node against all spec invariants.
    Violations are printed to stdout.
    Exit 1 if any violations found; exit 0 if clean.

  With --rfc <uid>: check only spec nodes in that RFC's spec_delta.
    Violations are printed to stderr.
    Exit 1 if any violation; exit 0 if clean.

Spec invariants (body-format requirements.md):
  stale-frontmatter   ears or verify in any frontmatter is a violation
  normative-statement body must have a normative statement with bolded **shall**
  why-required        every requirement body must have a **Why** rationale
  fit-criterion       every requirement body must have a **Fit criterion**
  anchor-mismatch     {#anchor} must equal id lowercased
  xref-dangling       cross-references must resolve (same-file and relative-path)
  id-format           requirement ids must be <CONCEPT>-R-NNN (3 zero-padded digits)

Spec invariants (all nodes):
  origin-rfc      every node must declare origin_rfc in frontmatter
  required-field  all schema-required fields must be present and non-blank
  enum-values     type, pattern, verification, criticality, status
  summary-length  summary must be ≤25 words
  snapshot-of     if snapshot_of is declared, the referenced node must exist
  unknown-field   frontmatter must not contain keys not defined in the schema

Traceability invariants (requirement nodes only):
  automated-unverified  every automated requirement must have ≥1 test with // @verifies <id>

S1 manifest invariants (concept nodes with spec.yaml):
  manifest-invalid    spec.yaml must be valid per the spec-manifest schema
  missing-view-file   every declared view file must exist on disk
  unsupported-source  lint.data-model.type_names.source must be 'types'
  type-name-missing   named TypeScript types must exist in src/
  operation-missing   named CLI operations must exist in hooks/*.mjs
  manifest-mismatch   spec.yaml id/title/summary must match README.md

Spec files are opened read-only; this command never writes to doc/specs/**.

Exit codes: 0 success  1 violations found  2 usage error
`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2)
if (argv.includes('--help') || argv.includes('-h')) {
  usage()
  process.exit(0)
}

const rfcIdx = argv.indexOf('--rfc')
const rfcFlagPresent = rfcIdx >= 0
const rfcUidRaw = rfcFlagPresent ? argv[rfcIdx + 1] : undefined
const rfcUid = rfcFlagPresent && rfcUidRaw && !rfcUidRaw.startsWith('-') ? rfcUidRaw : null
const rfcMode = rfcUid != null

if (rfcFlagPresent && !rfcMode) {
  process.stderr.write('spec lint: --rfc requires a uid argument\n')
  process.exit(2)
}

const projectDir = process.env.GROUNDWORK_PROJECT_DIR ?? process.env.CLAUDE_PROJECT_DIR ?? findProjectRoot()
const specDir = join(projectDir, 'doc', 'specs')

// Load the spec index
const index = loadSpecIndex(projectDir)
if (!index) {
  if (!existsSync(specDir)) {
    process.stdout.write('spec lint: clean — no spec tree found.\n')
    process.exit(0)
  }
  process.stderr.write('spec lint: spec index not found. Run "spec build" first.\n')
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
  const rfcYamlPath = join(rfcDir, 'rfc.yaml')
  let deltaPaths
  if (existsSync(rfcYamlPath)) {
    const rfcYaml = yamlLoad(readFileSync(rfcYamlPath, 'utf8'))
    deltaPaths = Array.isArray(rfcYaml?.spec_delta)
      ? rfcYaml.spec_delta.map(item => item.target).filter(Boolean)
      : []
  } else {
    const rfcContent = readFileSync(join(rfcDir, 'rfc.md'), 'utf8')
    deltaPaths = parseSpecDeltaTargets(rfcContent)
  }

  const missingPaths = deltaPaths.filter(t => !existsSync(join(projectDir, t)))
  if (missingPaths.length > 0) {
    for (const mp of missingPaths) {
      process.stderr.write(`spec lint: spec_delta target does not exist on disk: ${mp}\n`)
    }
    process.exit(1)
  }

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

// ---------------------------------------------------------------------------
// Run invariant checks — group nodes by source file
// ---------------------------------------------------------------------------

const violations = []

// Group target nodes by their source file (relPath)
const byFile = new Map()
for (const node of targetNodes) {
  const rp = node.relPath || ''
  if (!byFile.has(rp)) byFile.set(rp, [])
  byFile.get(rp).push(node)
}

for (const [relPath, nodes] of byFile) {
  if (!relPath) continue
  const absPath = join(specDir, relPath)
  if (!existsSync(absPath)) continue

  let fileContent
  try { fileContent = readFileSync(absPath, 'utf8') } catch { continue }

  const isReqFile = relPath === 'requirements.md' || relPath.endsWith('/requirements.md')

  if (isReqFile) {
    // Body-format requirements.md: parse H3 sections and check body invariants
    for (const { nodeId, violation } of checkRequirementsFile(fileContent, absPath, nodes, rfcMode)) {
      violations.push({ nodeId, violation })
      emitLintDrift(projectDir, rfcForJournal, nodeId, violation)
    }
  } else {
    // Concept/metadata nodes: check frontmatter-based invariants
    const { data: rawFm } = parseYamlFrontmatter(fileContent)
    for (const node of nodes) {
      for (const v of checkNodeInvariants(node, rawFm, index)) {
        violations.push({ nodeId: node.id, violation: v })
        emitLintDrift(projectDir, rfcForJournal, node.id, v)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// automated-unverified: every automated requirement must have ≥1 @verifies test
// ---------------------------------------------------------------------------

const automatedNodes = targetNodes.filter(n => n.verification === 'automated')
if (automatedNodes.length > 0) {
  const verified = verifiedIds(projectDir)
  for (const node of automatedNodes) {
    if (!verified.has(node.id)) {
      const violation = `automated-unverified: verification=automated but no test carries // @verifies ${node.id}`
      violations.push({ nodeId: node.id, violation })
      emitLintDrift(projectDir, rfcForJournal, node.id, violation)
    }
  }
}

// ---------------------------------------------------------------------------
// S1 checks: spec.yaml manifest validation, view-file rules, lint block, agreement
// ---------------------------------------------------------------------------

/** Allowed frontmatter keys in view files (must be exactly these two). */
const VIEW_ALLOWED_FIELDS = new Set(['type', 'id'])

// Process each concept node (README.md-based nodes indexed with type === 'concept')
const conceptNodes = targetNodes.filter(n => n.type === 'concept')

for (const conceptNode of conceptNodes) {
  const nodeId = conceptNode.id
  const conceptDir = join(specDir, dirname(conceptNode.relPath || ''))

  // 1. Validate spec.yaml when present
  const { manifest, errors: manifestErrors } = loadSpecManifestSync(conceptDir)
  for (const { field, problem } of manifestErrors) {
    const violation = `manifest-invalid: concept "${nodeId}" spec.yaml field "${field}": ${problem}`
    violations.push({ nodeId, violation })
    emitLintDrift(projectDir, rfcForJournal, nodeId, violation)
  }

  // 2. View-file frontmatter rules (from spec.yaml manifest views; index.json does not
  //    serialize the views field, so we read directly from the manifest here)
  const views = (manifest && Array.isArray(manifest.views)) ? manifest.views : []
  for (const view of views) {
    if (!view || typeof view.file !== 'string') continue
    const viewAbsPath = join(conceptDir, view.file)
    if (!existsSync(viewAbsPath)) {
      const violation = `missing-view-file: concept "${nodeId}" declares view file "${view.file}" which does not exist`
      violations.push({ nodeId, violation })
      emitLintDrift(projectDir, rfcForJournal, nodeId, violation)
      continue
    }
    let viewContent
    try { viewContent = readFileSync(viewAbsPath, 'utf8') } catch { continue }
    // If the view file is the concept node itself (e.g. overview → README.md),
    // its frontmatter is already validated by the concept schema — skip the
    // strict two-field check (plan decision V2).
    const conceptNodeAbsPath = join(specDir, conceptNode.relPath || '')
    if (viewAbsPath === conceptNodeAbsPath) continue
    const { data: viewFm } = parseYamlFrontmatter(viewContent)
    const viewFields = Object.keys(viewFm || {})
    // Must have exactly 'type' and 'id' — no more, no less
    for (const f of VIEW_ALLOWED_FIELDS) {
      if (!viewFields.includes(f)) {
        const violation = `required-field: view file "${view.file}" in concept "${nodeId}" is missing required field "${f}"`
        violations.push({ nodeId, violation })
        emitLintDrift(projectDir, rfcForJournal, nodeId, violation)
      }
    }
    for (const f of viewFields) {
      if (!VIEW_ALLOWED_FIELDS.has(f)) {
        const violation = `unknown-field: view file "${view.file}" in concept "${nodeId}" has unknown frontmatter field "${f}"`
        violations.push({ nodeId, violation })
        emitLintDrift(projectDir, rfcForJournal, nodeId, violation)
      }
    }
  }

  // 3 & 4. Lint block checks and agreement check (require manifest to be parseable)
  if (manifest) {
    const lint = manifest.lint || {}

    // 3a. data-model / type_names lint check
    const typeNamesConf = lint['data-model']?.type_names
    if (typeNamesConf && Array.isArray(typeNamesConf.names) && typeNamesConf.names.length > 0) {
      if (typeNamesConf.source !== 'types') {
        const violation = `unsupported-source: concept "${nodeId}" lint.data-model.type_names has unsupported source '${typeNamesConf.source}'; only 'types' is supported in this repo`
        violations.push({ nodeId, violation })
        emitLintDrift(projectDir, rfcForJournal, nodeId, violation)
      } else {
        const srcDir = join(projectDir, 'src')
        for (const name of typeNamesConf.names) {
          const grepResult = spawnSync(
            'grep', ['-rE', `^export (type|interface) ${name}\\b`, '--include=*.ts', srcDir],
            { encoding: 'utf8' },
          )
          if (!grepResult.stdout || !grepResult.stdout.trim()) {
            const violation = `type-name-missing: concept "${nodeId}" lint.data-model.type_names: TypeScript type/interface "${name}" not found in src/`
            violations.push({ nodeId, violation })
            emitLintDrift(projectDir, rfcForJournal, nodeId, violation)
          }
        }
      }
    }

    // 3b. api / operations lint check
    const opsConf = lint['api']?.operations
    if (Array.isArray(opsConf) && opsConf.length > 0) {
      const hooksDir = join(projectDir, 'hooks')
      for (const op of opsConf) {
        const grepResult = spawnSync(
          'grep', ['-rE', `['"]${op}['"]`, '--include=*.mjs', hooksDir],
          { encoding: 'utf8' },
        )
        if (!grepResult.stdout || !grepResult.stdout.trim()) {
          const violation = `operation-missing: concept "${nodeId}" lint.api.operations: CLI operation "${op}" not found in hooks/*.mjs`
          violations.push({ nodeId, violation })
          emitLintDrift(projectDir, rfcForJournal, nodeId, violation)
        }
      }
    }

    // 4. Agreement check: spec.yaml vs README.md frontmatter
    const readmePath = join(conceptDir, 'README.md')
    if (existsSync(readmePath)) {
      let readmeContent
      try { readmeContent = readFileSync(readmePath, 'utf8') } catch { readmeContent = null }
      if (readmeContent) {
        const { data: readmeFm } = parseYamlFrontmatter(readmeContent)
        for (const field of ['id', 'title', 'summary']) {
          const specVal = manifest[field]
          const readmeVal = readmeFm[field]
          if (specVal !== readmeVal) {
            const violation = `manifest-mismatch: concept "${nodeId}" spec.yaml.${field} ("${specVal}") != README.md.${field} ("${readmeVal}")`
            violations.push({ nodeId, violation })
            emitLintDrift(projectDir, rfcForJournal, nodeId, violation)
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Report and exit
// ---------------------------------------------------------------------------

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

// Exit 1 on violations — in ALL modes (fixes the bug where non-rfc mode exited 0)
process.exit(1)
