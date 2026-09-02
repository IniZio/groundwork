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
 *     stale-frontmatter        — ears or verify in any frontmatter → violation
 *     normative-statement      — body must contain a normative statement with bolded **shall**
 *     why-required             — every requirement body must have a **Why** rationale
 *     fit-criterion            — every requirement body must have a **Fit criterion**
 *     anchor-mismatch          — {#anchor} must equal id lowercased
 *     xref-dangling            — cross-references must resolve (same-file and relative-path)
 *     id-format                — requirement ids must be <CONCEPT>-R-NNN (exactly 3 zero-padded digits)
 *   All node invariants (concept README.md and other nodes):
 *     origin-decision-ref  — origin_decision_ref if present must be a valid decision ref (absent is allowed)
 *     required-field       — all schema-required fields must be present and non-blank
 *     enum-values          — type, pattern, verification, criticality, status
 *     summary-length       — summary must be ≤25 words
 *     snapshot-of          — if snapshot_of is declared, the referenced node must exist
 *     unknown-field        — frontmatter must not contain keys not defined in the schema
 *   Traceability invariants (requirement nodes only):
 *     automated-unverified — every automated requirement must have ≥1 test carrying // @verifies <id>
 *   Hierarchy invariants (concept tree; full-tree mode only, skipped with --rfc):
 *     exactly-one-root     — exactly one concept may declare parent: null; zero or >1 is an error
 *     parent-resolves      — every non-root concept's parent must match a known concept id
 *     no-cycles            — following parent links from any concept must terminate at the root
 *     parent-field-present — every concept must have a parent field (absent → implicit second root)
 *   S1 manifest invariants (concept nodes with spec.yaml):
 *     manifest-invalid     — spec.yaml must be valid per the spec-manifest schema
 *     missing-view-file    — every declared view file must exist on disk
 *     required-field       — view file frontmatter must have type and id fields
 *     unknown-field        — view file frontmatter must have no extra fields
 *     unsupported-source   — lint.data-model.type_names.source must be 'types'
 *     type-name-missing    — named types must exist in the configured scan root (language-aware)
 *     operation-missing    — named CLI operations must exist in hooks/*.mjs
 *     manifest-mismatch    — spec.yaml id/title/summary must match README.md
 *     unknown-view-type    — views[].type must be a core type or declared in view_types
 *     view-type-collision  — view_types[].name must not shadow a core type
 *     view-type-mismatch   — view file frontmatter type must match the spec.yaml declaration
 *   File-walk invariants (full-tree mode; skipped with --rfc for count-parity):
 *     yaml-parse-error (file-walk) — requirement file with unparseable YAML frontmatter causes
 *                                    no index node; detected by direct file walk before byFile loop
 *     count-parity                 — on-disk requirement file count must equal index requirement
 *                                    node count; catches silent-drop cases (bad frontmatter that
 *                                    did not throw, missing id field, etc.)
 *
 * Exit codes: 0 success  1 violations found (both modes)  2 usage error
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, basename, resolve, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { load as yamlLoad } from 'js-yaml'
import { loadSchema } from './lib/schema-io.mjs'
import {
  parseRequirementsDocument,
  parseYamlFrontmatter,
  ALLOWED_FRONTMATTER_FIELDS,
  CORE_VIEW_TYPES,
  isRequirementsDoc,
  hasNormativeVerb,
  extractAllHeadingAnchors,
  buildIndexData,
} from './lib/spec-io.mjs'
import { scanVerifies, lookupVerifies } from './lib/verifies-scan.mjs'

// ---------------------------------------------------------------------------
// Spec index loader
// ---------------------------------------------------------------------------

function loadSpecIndex(projectDir) {
  // Always build from disk — never read the generated cache.
  // The cache (_generated/index.json) is gitignored and drifts silently; a
  // machine holding a stale cache would pass automated-unverified (and every
  // other node-level rule) against nodes that no longer reflect disk truth.
  // Disk is authoritative; the cache is only a build artefact for other tools.
  const specDir = join(projectDir, 'doc', 'specs')
  if (!existsSync(specDir)) return null
  try {
    const { nodes } = buildIndexData(specDir)
    return { nodes }
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

    // Skip not errors — origin_decision_ref 'null' sentinel is handled by origin-decision-ref invariant
    if (keyword === 'not') continue

    // Skip all errors on origin_decision_ref — handled by the hand-written origin-decision-ref invariant
    if (field === 'origin_decision_ref') continue
    if (keyword === 'required' && params.missingProperty === 'origin_decision_ref') continue

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
  // Match both H2 (##) and H3 (###) headings — constraints.md uses H2, requirements.md uses H3
  const chunks = body.split(/^(?=#{2,3} )/m)
  const map = new Map()
  const HEADING_RE = /^#{2,3} ([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-R-\S+)/
  for (const chunk of chunks) {
    if (!chunk.startsWith('## ') && !chunk.startsWith('### ')) continue
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
  const { data: fileFm, parseError } = parseYamlFrontmatter(fileContent)
  if (parseError) {
    return [{ nodeId: targetNodes[0]?.id ?? null, violation: `yaml-parse-error: ${fileAbsPath}: ${parseError.message}` }]
  }
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

  // origin_decision_ref is optional; if present it must be a valid decision ref (<motive-slug>#D-<n>)
  const originDecisionRef = fileFm.origin_decision_ref
  if (originDecisionRef !== undefined) {
    if (!originDecisionRef || typeof originDecisionRef !== 'string' || !String(originDecisionRef).trim() || originDecisionRef === 'null' || !/^[a-z0-9][a-z0-9-]*#D-\d+$/.test(String(originDecisionRef).trim())) {
      violations.push({
        nodeId: firstNodeId,
        violation: `origin-decision-ref: file "${fileLabel}" has invalid origin_decision_ref in frontmatter (expected <motive-slug>#D-<n>, e.g. plugin-cleanup#D-5)`,
      })
    }
  }

  // Parse body sections
  const sections = parseRequirementsDocument(fileContent)

  // Reject old-format individual requirement files (no anchored H3/H2 heading).
  // Files in a requirements/ subdir that lack the "## REQ-ID — Title {#anchor}"
  // heading are using the deprecated ## Statement format and must be converted to H2+bullets.
  const isIndividualReqFile = fileAbsPath.includes('/requirements/') &&
    !fileAbsPath.endsWith('/requirements.md') && !fileAbsPath.endsWith('/constraints.md')
  if (sections.length === 0 && isIndividualReqFile) {
    violations.push({
      nodeId: firstNodeId,
      violation: `old-format-rejected: requirement file "${fileLabel}" has no anchored H3/H2 heading (old ## Statement format) — convert to "## REQ-ID — Title {#req-id}" H2+bullets format`,
    })
    return violations
  }

  // Reject H3-headed individual requirement files. Canonical Shape A is H2 (##).
  if (sections.length > 0 && isIndividualReqFile) {
    const H3_HEADING_RE = /^### [A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-R-/m
    if (H3_HEADING_RE.test(fileContent)) {
      violations.push({
        nodeId: firstNodeId || (sections[0] && sections[0].id) || fileLabel,
        violation: `h3-heading-rejected: individual requirement file "${fileLabel}" uses H3 (###) heading — use H2 (## REQ-ID — Title {#req-id}) as the canonical Shape A format`,
      })
    }
  }

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

    // Normative statement with bolded **shall** or **shall not**
    // Accepts: **shall** (affirmative), **shall not** (prohibition inside bold),
    //          **shall** not (prohibition outside bold). RFC 2119 / ISO 29148 both
    // treat SHALL NOT as first-class normative.
    if (!section.normativeStatement) {
      violations.push({
        nodeId: id,
        violation: `normative-statement: requirement "${id}" has no normative statement (no prose before first bullet)`,
      })
    } else if (!hasNormativeVerb(section.normativeStatement)) {
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

    // Unparseable **Verification** line: present but not understood is worse than absent
    // Fire only when a bullet starting with **Verification** exists but did not parse.
    const rawChunk = sectionChunks.get(id) || ''
    if (!section.verification || section.verification === 'unknown') {
      for (const line of rawChunk.split('\n')) {
        const bulletText = (line.startsWith('- ') || line.startsWith('* ')) ? line.slice(2) : null
        if (bulletText !== null && bulletText.trimStart().startsWith('**Verification**')) {
          violations.push({
            nodeId: id,
            violation: `verification-unparseable: requirement "${id}" in "${fileAbsPath}" has a **Verification** line that did not parse: ${line.trim()}`,
          })
          break
        }
      }
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
          // Collect anchors from requirement sections (existing behaviour) and
          // also from every ordinary heading (GitHub-style slug or explicit {#…}).
          const targetSections = parseRequirementsDocument(targetContent)
          const targetAnchors = new Set([
            ...targetSections.map(s => s.anchor),
            ...extractAllHeadingAnchors(targetContent),
          ])
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
    // Schema validation for requirement nodes (handles required-field, enum-values, unknown-field)
    try {
      const validate = loadSchema('spec-requirement')
      if (!validate(rawFm)) {
        for (const line of schemaErrorsToViolations(validate.errors, id, rawFm)) {
          violations.push(line)
        }
      }
    } catch {
      // Schema not found — hand-written checks below cover the essentials
    }
    // Old-format requirement nodes (not from requirements.md):
    // Check for stale fields that moved to body in RFC-0003
    if (Object.prototype.hasOwnProperty.call(rawFm, 'ears')) {
      violations.push(`stale-frontmatter: node "${id}" has "ears" in frontmatter (EARS sentence belongs in body prose)`)
    }
    if (Object.prototype.hasOwnProperty.call(rawFm, 'verify')) {
      violations.push(`stale-frontmatter: node "${id}" has "verify" in frontmatter (fit criterion belongs in body prose)`)
    }
    // D-15 individual requirement files live in a requirements/ subdirectory (e.g.
    // concept/requirements/concept-r-001.md). They use lowercase IDs and additional
    // frontmatter fields not present in old-format nodes.
    const isD15ReqFile = !!(node.relPath && node.relPath.includes('/requirements/'))

    // Unknown fields check (for non-concept nodes not covered by schema)
    for (const field of Object.keys(rawFm)) {
      if (!ALLOWED_FRONTMATTER_FIELDS.has(field) && field !== 'ears' && field !== 'verify') {
        violations.push(`unknown-field: node "${id}" has unknown frontmatter key "${field}"`)
      }
    }
    // Strict requirement ID format — skip D-15 individual files (they use lowercase ids)
    if (!isD15ReqFile && rawFm.id && !STRICT_REQ_ID_RE.test(String(rawFm.id))) {
      violations.push(`id-format: requirement "${rawFm.id}" does not match <CONCEPT>-R-NNN (exactly 3 zero-padded digits)`)
    }
  }

  // origin_decision_ref is optional; if present it must be a valid decision ref (<motive-slug>#D-<n>)
  if (rawFm.origin_decision_ref !== undefined) {
    if (!rawFm.origin_decision_ref || typeof rawFm.origin_decision_ref !== 'string' || !rawFm.origin_decision_ref.trim() || rawFm.origin_decision_ref === 'null' || !/^[a-z0-9][a-z0-9-]*#D-\d+$/.test(rawFm.origin_decision_ref.trim())) {
      violations.push(`origin-decision-ref: node "${id}" has invalid origin_decision_ref in frontmatter (expected <motive-slug>#D-<n>, e.g. plugin-cleanup#D-5)`)
    }
  }

  // Summary length ≤25 words (all node types except D-15 individual requirement files,
  // which use body sections for normative content rather than a frontmatter summary gloss)
  const _isD15ForSummary = !isConcept && !!(node.relPath && node.relPath.includes('/requirements/'))
  const summary = rawFm.summary || node.summary
  if (!_isD15ForSummary && summary && summary.trim()) {
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
// Frontmatter verification ↔ body **Verification** agreement (hard error)
// ---------------------------------------------------------------------------

/**
 * Compare frontmatter `verification:` with the parsed body `**Verification**` label.
 * Fires in both directions (fm=unverified/body=automated AND the reverse).
 * Returns violation objects — mismatches are hard errors that exit non-zero.
 *
 * @param {string}   fileContent  Raw file text
 * @param {string}   fileAbsPath  Absolute path (for error messages)
 * @param {object[]} targetNodes  Index nodes expected from this file
 * @returns {{ nodeId: string, violation: string }[]}
 */
function checkFmBodyVerificationMismatch(fileContent, fileAbsPath, targetNodes, projectDir) {
  const { data: fileFm, parseError } = parseYamlFrontmatter(fileContent)
  if (parseError) {
    return [{ nodeId: null, violation: `yaml-parse-error: ${fileAbsPath}: ${parseError.message}` }]
  }
  const fmVerification = fileFm && typeof fileFm.verification === 'string'
    ? fileFm.verification.toLowerCase().trim()
    : null
  if (!fmVerification) return []

  const sections = parseRequirementsDocument(fileContent)
  // Index node ids are lowercased (from frontmatter); section ids are from heading text (may differ in case).
  // Normalize both to lowercase for the membership check.
  const targetIds = new Set(targetNodes.map(n => n.id.toLowerCase()))
  const results = []

  for (const section of sections) {
    if (!targetIds.has(section.id.toLowerCase())) continue
    const bodyVerification = section.verification && section.verification !== 'unknown'
      ? section.verification.toLowerCase().trim()
      : null
    if (!bodyVerification) continue
    if (fmVerification !== bodyVerification) {
      results.push({
        nodeId: section.id,
        violation: `verification-mismatch: requirement "${section.id}" frontmatter verification=${fmVerification} disagrees with body **Verification**: ${bodyVerification} (${projectDir ? relative(projectDir, fileAbsPath) : basename(fileAbsPath)})`,
      })
    }
  }

  return results
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
  stale-frontmatter        ears or verify in any frontmatter is a violation
  normative-statement      body must have a normative statement with bolded **shall**
  why-required             every requirement body must have a **Why** rationale
  fit-criterion            every requirement body must have a **Fit criterion**
  anchor-mismatch          {#anchor} must equal id lowercased
  xref-dangling            cross-references must resolve (same-file and relative-path)
  id-format                requirement ids must be <CONCEPT>-R-NNN (3 zero-padded digits)

Spec invariants (all nodes):
  origin-decision-ref  origin_decision_ref if present must be a valid decision ref (<motive-slug>#D-<n>, absent is allowed)
  required-field  all schema-required fields must be present and non-blank
  enum-values     type, pattern, verification, criticality, status
  summary-length  summary must be ≤25 words
  snapshot-of     if snapshot_of is declared, the referenced node must exist
  unknown-field   frontmatter must not contain keys not defined in the schema

Hierarchy invariants (full-tree mode only; skipped with --rfc):
  exactly-one-root     exactly one concept may declare parent: null; zero or >1 is an error
  parent-resolves      every non-root concept's parent must match a known concept id
  no-cycles            following parent links from any concept must terminate at the root
  parent-field-present every concept must declare a parent field (absent treated as implicit root)

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

// ---------------------------------------------------------------------------
// File-walk helper — collects *.md files under requirements/ subdirectories
// ---------------------------------------------------------------------------

/**
 * Recursively collect *.md files whose immediate parent directory is named
 * `requirements`. Used for the file-walk YAML-parse scan and count-parity check.
 * @param {string} dir  Absolute path to walk
 * @returns {string[]}  Absolute paths
 */
function walkReqFiles(dir) {
  const results = []
  if (!existsSync(dir)) return results
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...walkReqFiles(full))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      // Match the same predicate as isRequirementsDoc:
      //   - any file named requirements.md or constraints.md (old-style multi-req files)
      //   - any *.md file whose immediate parent directory is named requirements/ (new-style)
      const name = entry.name
      if (name === 'requirements.md' || name === 'constraints.md' || basename(dir) === 'requirements') {
        results.push(full)
      }
    }
  }
  return results
}

const projectDir = process.env.GROUNDWORK_PROJECT_DIR ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd()
const specDir = join(projectDir, 'doc', 'specs')

// Load the spec index
const index = loadSpecIndex(projectDir)
if (!index) {
  if (!existsSync(specDir)) {
    const msg = `spec lint: no spec tree found; expected ${specDir}\n`
    process.stdout.write(msg)
    process.stderr.write(msg)
    process.exit(1)
  }
  process.stderr.write(`spec lint: failed to build spec index from ${specDir}.\n`)
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

// ---------------------------------------------------------------------------
// Pass 0a: File-walk YAML-parse scan
// ---------------------------------------------------------------------------
// Walk every *.md under requirements/ and attempt a YAML frontmatter parse.
// Files with unparseable frontmatter produce no index node (buildIndexData
// silently skips them), so checkRequirementsFile is never called for them —
// this pass is the only gate for that case.
// Note: parseYamlFrontmatter returns {data:{}, body} with NO parseError for
// no-frontmatter files (no ---) and non-object YAML (e.g. bare `true`) —
// those cases do not throw. Count-parity (Pass 0b) is the backstop for them.
const diskReqFiles = walkReqFiles(specDir)

for (const absReqPath of diskReqFiles) {
  let raw
  try { raw = readFileSync(absReqPath, 'utf8') } catch { continue }
  const { parseError } = parseYamlFrontmatter(raw)
  if (parseError) {
    const v = `yaml-parse-error: ${absReqPath}: ${parseError.message}`
    violations.push({ nodeId: null, violation: v })
    emitLintDrift(projectDir, rfcForJournal, null, v)
  }
}

// ---------------------------------------------------------------------------
// Pass 0b: Count-parity check (full-tree mode only)
// ---------------------------------------------------------------------------
// The index is built fresh from disk (loadSpecIndex calls buildIndexData, not
// the gitignored _generated/index.json cache), so a count mismatch means a
// file was silently dropped (bad frontmatter that did not throw, missing id
// field, etc.). Skipped in RFC mode: that mode scans a subset, so counts
// diverge by design.
if (!rfcMode) {
  const diskCount = diskReqFiles.length
  // Compare files to unique indexed file paths, not raw node count: one file
  // may contain multiple requirement sections (multiple nodes, one relPath).
  // A silently-dropped file produces zero nodes for its relPath — that's the
  // mismatch we're detecting.
  const indexedFileCount = new Set(
    allNodes.filter(n => n.type === 'requirement' && n.relPath).map(n => n.relPath),
  ).size
  if (diskCount !== indexedFileCount) {
    const v =
      `count-parity: ${diskCount} requirement file(s) on disk but ${indexedFileCount} requirement file(s) in index — run \`node scripts/build-spec-index.mjs\` (or equivalent) to rebuild`
    violations.push({ nodeId: null, violation: v })
    emitLintDrift(projectDir, rfcForJournal, null, v)
  }
}

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

  const isReqFile = isRequirementsDoc(relPath)

  if (isReqFile) {
    // Body-format requirements.md: parse H3 sections and check body invariants
    for (const { nodeId, violation } of checkRequirementsFile(fileContent, absPath, nodes, rfcMode)) {
      violations.push({ nodeId, violation })
      emitLintDrift(projectDir, rfcForJournal, nodeId, violation)
    }
    // Hard error: frontmatter verification↔body **Verification** agreement
    for (const { nodeId, violation } of checkFmBodyVerificationMismatch(fileContent, absPath, nodes, projectDir)) {
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
    // Hard error: frontmatter verification↔body **Verification** agreement
    // D-15 individual requirement files carry both a frontmatter `verification:` and a body
    // `**Verification**` bullet; they land here (not in isReqFile) but the hard check applies equally.
    for (const { nodeId, violation } of checkFmBodyVerificationMismatch(fileContent, absPath, nodes, projectDir)) {
      violations.push({ nodeId, violation })
      emitLintDrift(projectDir, rfcForJournal, nodeId, violation)
    }
  }
}

// ---------------------------------------------------------------------------
// automated-unverified: every automated requirement must have ≥1 @verifies test
// ---------------------------------------------------------------------------

// D-15 individual requirement files (in requirements/ subdirs) that carry
// verification: automated MUST have @verifies backing — this rule enforces it.
const automatedNodes = targetNodes.filter(n => n.verification === 'automated')
if (automatedNodes.length > 0) {
  const verifiesMap = scanVerifies(projectDir)
  for (const node of automatedNodes) {
    if (lookupVerifies(verifiesMap, node.id).length === 0) {
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

/** Levenshtein distance helper for near-miss type suggestions. */
function levenshtein(a, b) {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

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

  // 2. View-file frontmatter rules (from spec.yaml manifest views; views are also
  //    serialized into index.json for queryability)
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
    // view-type-mismatch: frontmatter type must match spec.yaml declaration
    const declaredType = typeof view.type === 'string' ? view.type : null
    const fmType = viewFm && typeof viewFm.type === 'string' ? viewFm.type : null
    if (declaredType && fmType && fmType !== declaredType) {
      const violation = `view-type-mismatch: view file "${view.file}" in concept "${nodeId}" declares type "${fmType}" but spec.yaml says "${declaredType}"`
      violations.push({ nodeId, violation })
      emitLintDrift(projectDir, rfcForJournal, nodeId, violation)
    }
  }

  // 2b. view-type-collision: project-declared type must not shadow a core type
  if (manifest && Array.isArray(manifest.view_types)) {
    for (const vt of manifest.view_types) {
      if (!vt || typeof vt.name !== 'string') continue
      if (CORE_VIEW_TYPES.has(vt.name)) {
        const violation = `view-type-collision: concept "${nodeId}" view_types declares "${vt.name}" which shadows a core view type`
        violations.push({ nodeId, violation })
        emitLintDrift(projectDir, rfcForJournal, nodeId, violation)
      }
    }
  }

  // 2c. unknown-view-type: views[].type must be core or project-declared
  if (views.length > 0 || (manifest && Array.isArray(manifest.view_types))) {
    const projectDeclaredNames = new Set(
      (manifest && Array.isArray(manifest.view_types))
        ? manifest.view_types.filter(vt => vt && typeof vt.name === 'string').map(vt => vt.name)
        : []
    )
    // Warn about unused project-declared types (untidy but not a violation)
    for (const name of projectDeclaredNames) {
      if (!views.some(v => v && v.type === name)) {
        process.stdout.write(`spec lint: warning: concept "${nodeId}" declares view_types entry "${name}" but no view uses it\n`)
      }
    }
    for (let i = 0; i < views.length; i++) {
      const view = views[i]
      if (!view || typeof view.type !== 'string') continue
      if (!CORE_VIEW_TYPES.has(view.type) && !projectDeclaredNames.has(view.type)) {
        // Special case: "requirements" is a deprecated FILENAME alias, not a view type.
        // A reader who names the file requirements.md and writes type: requirements hits this.
        let didYouMean = ''
        if (view.type === 'requirements') {
          didYouMean = `\n  "requirements" is not a view type — it is the deprecated alias for the FILENAME.\n  The file requirements.md must still be registered with type: constraints, not type: requirements.\n  Change this entry to: type: constraints`
        } else {
          // Near-miss: Levenshtein distance 1-2 suggestion
          for (const coreType of CORE_VIEW_TYPES) {
            if (levenshtein(view.type, coreType) <= 2) {
              didYouMean = `\n  Did you mean "${coreType}"?`
              break
            }
          }
        }
        const violation = [
          `unknown-view-type: concept "${nodeId}" declares view type "${view.type}" in views[${i}]`,
          `  (file: ${view.file ?? '?'}), which is not a known view type.${didYouMean}`,
          `  Core types: ${[...CORE_VIEW_TYPES].join(', ')}.${projectDeclaredNames.size > 0 ? `\n  Project-declared types: ${[...projectDeclaredNames].join(', ')}.` : ''}`,
          `  If none of these fit, declare a project-local type in this spec.yaml:`,
          `    view_types:`,
          `      - name: ${view.type}`,
          `        concern: "<which stakeholder question this view answers>"`,
          `        contents: "<one line: what this document contains>"`,
          `  See doc/specs/conventions.md §3.`,
        ].join('\n')
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
        const language = typeNamesConf.language ?? 'typescript'
        const scanRoot = typeNamesConf.scan_root ?? 'src'
        const scanDir = join(projectDir, scanRoot)
        if (language === 'typescript') {
          for (const name of typeNamesConf.names) {
            const grepResult = spawnSync(
              'grep', ['-rE', `^export (type|interface) ${name}\\b`, '--include=*.ts', scanDir],
              { encoding: 'utf8' },
            )
            if (!grepResult.stdout || !grepResult.stdout.trim()) {
              const violation = `type-name-missing: concept "${nodeId}" lint.data-model.type_names: TypeScript type/interface "${name}" not found in ${scanRoot}/`
              violations.push({ nodeId, violation })
              emitLintDrift(projectDir, rfcForJournal, nodeId, violation)
            }
          }
        } else {
          process.stdout.write(`spec lint: type_names check skipped for concept "${nodeId}" — language "${language}" is not supported (supported: typescript)\n`)
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
        const specYamlPath = join(conceptDir, 'spec.yaml')
        for (const field of ['id', 'title', 'summary']) {
          const specVal = manifest[field]
          const readmeVal = readmeFm[field]
          if (specVal !== readmeVal) {
            const violation = `manifest-mismatch: concept "${nodeId}" ${field} differs — ${specYamlPath}: "${specVal}" vs ${readmePath}: "${readmeVal}"`
            violations.push({ nodeId, violation })
            emitLintDrift(projectDir, rfcForJournal, nodeId, violation)
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Hierarchy invariants (D-22): exactly-one-root, parent-resolves, no-cycles,
// parent-field-present.  Applied to the full concept tree in non-RFC mode.
// _generated/** is already excluded: walkSpecFiles skips the _generated dir,
// so no _generated nodes appear in allNodes.
// ---------------------------------------------------------------------------

if (!rfcMode) {
  // Concept nodes are index.md or README.md files with an id field.
  // (type may be 'concept' or 'moc' depending on frontmatter; filter by filename.)
  const allConceptNodes = allNodes.filter(n =>
    n.relPath && (
      n.relPath === 'README.md' ||
      n.relPath.endsWith('/README.md') ||
      n.relPath.endsWith('/index.md')
    ),
  )

  // The spec index collapses both `parent: null` (explicit) and absent parent
  // to node.parent===null.  Re-read raw frontmatter to distinguish them so that
  // invariant 4 (parent-field-present) can fire on truly absent fields.
  const parentFieldAbsent = new Set()
  for (const cn of allConceptNodes) {
    if (!cn.relPath) continue
    const absPath = join(specDir, cn.relPath)
    let raw
    try { raw = readFileSync(absPath, 'utf8') } catch { continue }
    const { data } = parseYamlFrontmatter(raw)
    if (!Object.prototype.hasOwnProperty.call(data, 'parent')) {
      parentFieldAbsent.add(cn.id)
    }
  }

  // Build id→node lookup for O(1) parent resolution and cycle walks.
  const conceptNodeById = new Map(allConceptNodes.map(n => [n.id, n]))

  // Invariant 4: parent-field-present — a concept without a parent field is an
  // implicit second root and must be reported before the root-count check so the
  // user sees which node is the culprit.
  for (const cn of allConceptNodes) {
    if (parentFieldAbsent.has(cn.id)) {
      violations.push({
        nodeId: cn.id,
        violation: `parent-field-present: concept "${cn.id}" has no "parent" field — add parent: null for the root, or parent: "<concept-id>" for children`,
      })
    }
  }

  // Root concepts: node.parent===null covers both explicit `parent: null` and absent parent.
  const rootNodes = allConceptNodes.filter(cn => cn.parent === null)

  // Invariant 1: exactly-one-root
  if (rootNodes.length === 0) {
    violations.push({
      nodeId: '(tree)',
      violation: `exactly-one-root: spec tree has no root concept — exactly one concept must declare parent: null`,
    })
  } else if (rootNodes.length > 1) {
    const ids = rootNodes.map(n => n.id).join(', ')
    violations.push({
      nodeId: '(tree)',
      violation: `exactly-one-root: spec tree has ${rootNodes.length} root concepts (${ids}) — exactly one is allowed`,
    })
  }

  // Invariant 2: parent-resolves — non-root concepts must reference an existing concept id
  const conceptIdSet = new Set(allConceptNodes.map(n => n.id))
  for (const cn of allConceptNodes) {
    if (cn.parent === null) continue // root (or absent-parent, already reported)
    if (!conceptIdSet.has(cn.parent)) {
      violations.push({
        nodeId: cn.id,
        violation: `parent-resolves: concept "${cn.id}" declares parent "${cn.parent}" which does not exist in the spec tree`,
      })
    }
  }

  // Invariant 3: no-cycles — follow parent links from every concept; a revisited
  // node signals a cycle.  Guard against unknown parents (invariant 2) with a
  // belt-and-suspenders null check so we never loop infinitely.
  const reportedInCycle = new Set()
  for (const startNode of allConceptNodes) {
    if (reportedInCycle.has(startNode.id)) continue
    const visited = new Set()
    let cur = startNode.id
    while (cur !== null && cur !== undefined) {
      if (visited.has(cur)) {
        // Every node on the path from startNode to cur is in the cycle.
        // Report the starting node (one violation per cycle participant).
        if (!reportedInCycle.has(startNode.id)) {
          reportedInCycle.add(startNode.id)
          violations.push({
            nodeId: startNode.id,
            violation: `no-cycles: concept "${startNode.id}" is part of a parent-link cycle (revisited "${cur}")`,
          })
        }
        break
      }
      visited.add(cur)
      const node = conceptNodeById.get(cur)
      if (!node || node.parent === null) break
      cur = node.parent
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
