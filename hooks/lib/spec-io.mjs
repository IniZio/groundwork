/**
 * spec-io.mjs — shared I/O utilities for the spec CLI.
 *
 * Pure data functions; no process.exit. No imports from other hook-lib modules.
 *
 * RFC-0003 (accepted 2026-07-27): normative requirement content lives in anchored H3
 * sections of a per-concept `requirements.md`.  Frontmatter is metadata only.
 * `ears` and `verify` are removed from the frontmatter schema.
 */

import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs'
import { join, dirname, relative, basename } from 'node:path'
import { load as yamlLoad } from 'js-yaml'
import { loadSchema } from './schema-io.mjs'

// ---------------------------------------------------------------------------
// Frontmatter schema (RFC-0003)
// ---------------------------------------------------------------------------

/**
 * Allowed frontmatter fields for all spec files (README.md and requirements.md).
 * `ears` and `verify` are intentionally absent — they moved to the markdown body.
 *
 * Consumers (spec-lint.mjs, spec-guard.mjs) import this set for validation.
 */
export const ALLOWED_FRONTMATTER_FIELDS = new Set([
  'id', 'type', 'concept', 'parent', 'title', 'summary',
  'origin_decision_ref', 'status', 'pattern', 'verification', 'criticality',
])

/**
 * Blessed core view types. Membership for views[].type is validated here (not in the
 * JSON schema) so project-declared extensions can extend the set without schema changes.
 * Single source of truth — imported by spec-lint.mjs.
 */
export const CORE_VIEW_TYPES = new Set([
  'overview', 'data-model', 'flows', 'api', 'constraints', 'scenarios', 'cases',
])

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

/**
 * Parse YAML frontmatter from markdown content.
 * Returns { data, body } where data is the parsed object and body is the remainder.
 */
export function parseYamlFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { data: {}, body: content }
  try {
    const parsed = yamlLoad(m[1])
    const data = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {}
    return { data, body: m[2] }
  } catch {
    return { data: {}, body: content }
  }
}

// ---------------------------------------------------------------------------
// Project root and path helpers
// ---------------------------------------------------------------------------

export function findProjectRoot(startDir) {
  let dir = startDir
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(dir, 'package.json')) || existsSync(join(dir, '.git'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return startDir
}

export function specDirPath(projectRoot) {
  return join(projectRoot, 'doc', 'specs')
}

export function generatedDirPath(sd) {
  return join(sd, '_generated')
}

export function indexJsonPath(sd) {
  return join(sd, '_generated', 'index.json')
}

/**
 * Returns true when `relPath` names a requirements document (constraints.md
 * or requirements.md, at any depth under the spec directory).
 *
 * Single source of truth — imported by spec-lint.mjs and any other consumer
 * that needs to recognise requirements documents by filename.
 *
 * @param {string} relPath  Path relative to the spec directory root.
 * @returns {boolean}
 */
export function isRequirementsDoc(relPath) {
  return relPath === 'requirements.md' || relPath.endsWith('/requirements.md') ||
         relPath === 'constraints.md'  || relPath.endsWith('/constraints.md')
}

// ---------------------------------------------------------------------------
// Walk spec files (excludes _generated and dotfiles)
// ---------------------------------------------------------------------------

export function walkSpecFiles(sd) {
  const results = []
  function walk(dir) {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === '_generated') continue
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        walk(full)
      } else if (e.isFile() && e.name.endsWith('.md')) {
        results.push({ absPath: full, relPath: relative(sd, full) })
      }
    }
  }
  walk(sd)
  return results
}

// ---------------------------------------------------------------------------
// Walk spec.yaml sidecar files (S0 pre-pass helper)
// ---------------------------------------------------------------------------

/**
 * Walk all spec.yaml sidecar files found under `sd` (excludes _generated and dotfiles).
 * Returns an array of { absPath, conceptDir } where conceptDir is the directory
 * that contains the spec.yaml.
 *
 * @param {string} sd - Spec directory root
 * @returns {{ absPath: string, conceptDir: string }[]}
 */
function walkSpecYamlFiles(sd) {
  const results = []
  function walk(dir) {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === '_generated') continue
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        walk(full)
      } else if (e.isFile() && e.name === 'spec.yaml') {
        results.push({ absPath: full, conceptDir: dir })
      }
    }
  }
  walk(sd)
  return results
}

// ---------------------------------------------------------------------------
// Staleness check (AC10)
// ---------------------------------------------------------------------------

export function isIndexStale(sd) {
  const p = indexJsonPath(sd)
  if (!existsSync(p)) return true
  const idxMtime = statSync(p).mtimeMs
  for (const { absPath } of walkSpecFiles(sd)) {
    if (statSync(absPath).mtimeMs > idxMtime) return true
  }
  // S0: also check spec.yaml sidecar files (AC7)
  for (const { absPath } of walkSpecYamlFiles(sd)) {
    if (statSync(absPath).mtimeMs > idxMtime) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Text utilities
// ---------------------------------------------------------------------------

export function firstSentence(text) {
  const clean = (text || '')
    .replace(/^#+\s.*$/mg, '')
    .replace(/[`*_[\]]/g, '')
    .trim()
  const m = clean.match(/[^.!?]*[.!?]/)
  return m ? m[0].trim() : clean.slice(0, 120).trim()
}

// Matches requirement ids (CONCEPT-R-NNN new-format or CONCEPT-R-xxxx old-format)
// and concept ids (C-NAME).  The suffix is [a-z0-9]+ to cover both numeric (001)
// and legacy 4-char (abcd) suffixes.
export const ID_RE_SRC = '\\b([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-R-[a-z0-9]+|C-[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)\\b'

/**
 * Returns true when `text` contains a bolded normative verb recognisable as
 * a SHALL or SHALL NOT statement.  Accepts:
 *   - **shall**       (affirmative)
 *   - **shall not**   (prohibition, negation inside bold)
 *   - **shall** not   (prohibition, negation outside bold)
 * Single shared implementation — import this from both the indexer and linter
 * so the two code paths cannot drift apart.
 * @param {string} text
 * @returns {boolean}
 */
export function hasNormativeVerb(text) {
  return /\*\*shall( not)?\*\*|\*\*shall\*\* not\b/.test(text)
}

export function extractRefs(content, selfId) {
  const re = new RegExp(ID_RE_SRC, 'g')
  const refs = new Set()
  let m
  while ((m = re.exec(content)) !== null) {
    if (m[1] !== selfId) refs.add(m[1])
  }
  return [...refs]
}

/**
 * Return the first path-like token found in text, or null if none.
 * A path-like token contains '/' or looks like a filename (has extension and dot).
 * Used to reject file references in the `verify` field (AC12).
 */
export function pathLikeToken(text) {
  const tokens = (text || '').split(/\s+/)
  for (const t of tokens) {
    if (!t) continue
    if (t.includes('/')) return t
    // token like "foo.ts", "bar.spec.js" — must have a letter-only extension ≤5 chars
    // and enough length to not be a word-ending period
    if (/\.[a-zA-Z]{1,5}$/.test(t) && t.length > 4 && !t.endsWith('etc.')) return t
  }
  return null
}

// ---------------------------------------------------------------------------
// Requirements body parser (RFC-0003)
// ---------------------------------------------------------------------------

/**
 * Extract the text of the H1 heading from a markdown body, or null.
 * Used to derive the concept `title` and `summary` when no frontmatter field is present.
 */
function extractH1(body) {
  const m = (body || '').match(/^#\s+(.+)$/m)
  return m ? m[1].trim() : null
}

/**
 * Parse a bullet list from section body into { label, content } objects.
 * Handles two-space continuation lines.
 *
 * @param {string} sectionBody
 * @returns {{ label: string, content: string }[]}
 */
function parseBulletItems(sectionBody) {
  const items = []
  const lines = sectionBody.split('\n')
  let current = null

  for (const line of lines) {
    if (line.startsWith('- ') || line.startsWith('* ')) {
      if (current !== null) items.push(current)
      current = { raw: line.slice(2) }
    } else if (current !== null && (line.startsWith('  ') || line.startsWith('\t'))) {
      // continuation line
      current.raw += ' ' + line.trim()
    } else {
      if (current !== null) items.push(current)
      current = null
    }
  }
  if (current !== null) items.push(current)
  return items
}

/**
 * Extract the attribute line values from a section body.
 * Line form: **Verification** <v> · **Criticality** <c> · **Source** <s>
 * (may appear as a standalone line or as a bullet item).
 *
 * @param {string} sectionBody
 * @returns {{ verification: string, criticality: string, source: string } | null}
 */
function extractAttributeLine(sectionBody) {
  // Form 1 (inline): **Verification** <v> · **Criticality** <c> · **Source** <s>
  const re1 = /\*\*Verification\*\*\s+(\S+)\s*[·•]\s*\*\*Criticality\*\*\s+(\S+)\s*[·•]\s*\*\*Source\*\*\s+(\S+)/
  // Form 2 (multi-bullet): separate lines for Verification: <v> and Criticality: <c>
  // **Verification**: <v> [— <method prose>]
  // **Criticality**: <c>
  // **Source**: <s>  (optional)
  const re2v = /\*\*Verification\*\*\s*:\s*(\S+)/
  const re2c = /\*\*Criticality\*\*\s*:\s*(\S+)/
  const re2s = /\*\*Source\*\*\s*:\s*(\S+)/

  let form2v = null, form2c = null, form2s = null

  for (const line of sectionBody.split('\n')) {
    const bare = line.startsWith('- ') || line.startsWith('* ') ? line.slice(2) : line
    // Try form 1 first
    const m1 = bare.match(re1)
    if (m1) return { verification: m1[1], criticality: m1[2], source: m1[3] }
    // Accumulate form 2 fields
    const mv = bare.match(re2v)
    if (mv && !form2v) form2v = mv[1]
    const mc = bare.match(re2c)
    if (mc && !form2c) form2c = mc[1]
    const ms = bare.match(re2s)
    if (ms && !form2s) form2s = ms[1]
  }
  if (form2v || form2c) {
    return { verification: form2v ?? 'unknown', criticality: form2c ?? 'unknown', source: form2s ?? '' }
  }
  return null
}

/**
 * Extract href values from a **See also** bullet line.
 *
 * @param {string} sectionBody
 * @returns {string[]}
 */
function extractSeeAlso(sectionBody) {
  const hrefs = []
  const items = parseBulletItems(sectionBody)
  const seeAlsoItem = items.find(it => it.raw.startsWith('**See also**'))
  if (!seeAlsoItem) return hrefs
  const re = /\[([^\]]+)\]\(#([^)]+)\)/g
  let m
  while ((m = re.exec(seeAlsoItem.raw)) !== null) {
    hrefs.push(m[2])
  }
  return hrefs
}

/**
 * Parse all requirement sections from a requirements.md document.
 *
 * Each section is an anchored H3 block with the canonical shape (RFC-0003 §3.1):
 *
 *   ### CONCEPT-R-001 — Title {#concept-r-001}
 *
 *   **When** … **shall** …
 *
 *   - **Why** — …
 *   - **Fit criterion** — …
 *   - **Verification** automated · **Criticality** must · **Source** R-XXXX
 *   - **See also** [CONCEPT-R-002](#concept-r-002)
 *
 * @param {string} markdown - Full file content (frontmatter is stripped automatically)
 * @returns {RequirementSection[]}
 *
 * @typedef {Object} RequirementSection
 * @property {string}   id                - Requirement ID (e.g. ARTIFACT-R-001)
 * @property {string}   title             - Human title from H3 heading
 * @property {string}   anchor            - Anchor slug from {#anchor} (e.g. artifact-r-001)
 * @property {string|null} normativeStatement - EARS prose after the heading (contains **shall**)
 * @property {string|null} why            - Rationale from **Why** bullet
 * @property {string|null} fitCriterion   - Acceptance test from **Fit criterion** bullet
 * @property {string|null} verification   - automated | manual | hybrid from attribute line
 * @property {string|null} criticality    - must | should from attribute line
 * @property {string|null} source         - Source RFC id from attribute line
 * @property {string[]}  seeAlso          - Anchor hrefs from **See also** links
 * @property {string[]}  refs             - Extracted cross-reference IDs from section content
 * @property {string[]}  errors           - Validation errors for this section
 */
export function parseRequirementsDocument(markdown) {
  // Strip frontmatter so the H3 splitter only sees body content
  const { body } = parseYamlFrontmatter(markdown)

  const sections = []

  // Split body on H2 or H3 heading boundaries.  constraints.md uses H2 (##); requirements.md uses H3 (###).
  const chunks = body.split(/^(?=#{2,3} )/m)

  // Heading pattern: ## or ### ID — Title {#anchor}
  // The em-dash (—, U+2014) or en-dash (–) separates ID from title.
  const HEADING_RE = /^#{2,3} ([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-R-\S+)\s+[—–]\s+(.+?)\s+\{#([^}]+)\}\s*(?:\n|$)/

  for (const chunk of chunks) {
    if (!chunk.startsWith('## ') && !chunk.startsWith('### ')) continue

    const headingLine = chunk.split('\n')[0] + '\n'
    const hm = headingLine.match(HEADING_RE)
    if (!hm) continue  // non-requirement heading (section header etc.) — skip

    const id = hm[1]
    const title = hm[2].trim()
    const anchor = hm[3].trim()
    const sectionBody = chunk.slice(headingLine.trimEnd().length).trim()

    const errors = []

    // RULE-02: anchor must equal id lowercased
    if (anchor !== id.toLowerCase()) {
      errors.push(`anchor {#${anchor}} does not match id ${id} lowercased (expected {#${id.toLowerCase()}})`)
    }

    // Normative statement: non-empty prose before the first bullet
    const normativeStatement = (() => {
      const lines = sectionBody.split('\n')
      const stmtLines = []
      for (const line of lines) {
        if (line.startsWith('- ') || line.startsWith('* ')) break
        stmtLines.push(line)
      }
      const stmt = stmtLines.join('\n').trim()
      return stmt || null
    })()

    if (!normativeStatement) {
      errors.push('missing normative statement (no prose between heading and first bullet)')
    } else if (!hasNormativeVerb(normativeStatement)) {
      errors.push('normative statement does not contain bolded **shall**')
    }

    // Bullet items
    const items = parseBulletItems(sectionBody)

    const whyItem = items.find(it => it.raw.startsWith('**Why**'))
    const why = whyItem ? whyItem.raw.replace(/^\*\*Why\*\*\s*[—–]\s*/, '').trim() : null
    if (!why) errors.push('missing **Why** rationale bullet')

    const fitItem = items.find(it => it.raw.startsWith('**Fit criterion**'))
    const fitCriterion = fitItem
      ? fitItem.raw.replace(/^\*\*Fit criterion\*\*\s*[—–]\s*/, '').trim()
      : null
    if (!fitCriterion) errors.push('missing **Fit criterion** bullet')

    // Attribute line
    const attr = extractAttributeLine(sectionBody)
    const verification = attr?.verification ?? null
    const criticality = attr?.criticality ?? null
    const source = attr?.source ?? null

    // See also
    const seeAlso = extractSeeAlso(sectionBody)

    // Cross-reference IDs extracted from section content (excluding self)
    const refs = extractRefs(sectionBody, id)

    sections.push({
      id,
      title,
      anchor,
      normativeStatement,
      why,
      fitCriterion,
      verification,
      criticality,
      source,
      seeAlso,
      refs,
      errors,
    })
  }

  return sections
}

// ---------------------------------------------------------------------------
// Concept-directory resolution for parent/dir mismatch check (AC3)
// ---------------------------------------------------------------------------

/**
 * Walk up from reqAbsPath looking for a README.md that has an `id` frontmatter.
 * Returns the concept id, or null if none found within sd.
 */
export function findNearestConceptId(reqAbsPath, sd) {
  const sdNorm = sd.replace(/\/?$/, '')
  let dir = dirname(reqAbsPath)
  for (let i = 0; i < 12; i++) {
    const readme = join(dir, 'README.md')
    if (existsSync(readme)) {
      const { data } = parseYamlFrontmatter(readFileSync(readme, 'utf8'))
      if (data.id) return String(data.id)
    }
    if (dir === sdNorm || dirname(dir) === dir) break
    dir = dirname(dir)
  }
  return null
}

/**
 * Find the directory of a concept node given its id.
 * Returns the abs dir path whose README.md has that id, or null.
 */
export function findConceptDir(conceptId, sd) {
  const files = walkSpecFiles(sd)
  for (const { absPath } of files) {
    if (!absPath.endsWith('README.md')) continue
    const { data } = parseYamlFrontmatter(readFileSync(absPath, 'utf8'))
    if (String(data.id) === conceptId) return dirname(absPath)
  }
  return null
}

// ---------------------------------------------------------------------------
// Spec manifest loading (S0)
// ---------------------------------------------------------------------------

/**
 * Synchronous implementation — used internally by buildIndexData and
 * wrapped by the exported async loadSpecManifest.
 *
 * @param {string} conceptDir
 * @returns {{ manifest: object|null, errors: {field: string, problem: string}[] }}
 */
function _loadSpecManifestSync(conceptDir) {
  const p = join(conceptDir, 'spec.yaml')
  if (!existsSync(p)) return { manifest: null, errors: [] }
  let raw
  try { raw = readFileSync(p, 'utf8') } catch { return { manifest: null, errors: [] } }
  let manifest
  try {
    manifest = yamlLoad(raw)
  } catch (e) {
    return { manifest: null, errors: [{ field: 'spec.yaml', problem: `YAML parse error: ${e.message}` }] }
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { manifest: null, errors: [{ field: '(root)', problem: 'spec.yaml must be a YAML mapping object' }] }
  }
  const validate = loadSchema('spec-manifest')
  const valid = validate(manifest)
  if (valid) return { manifest, errors: [] }
  const errors = (validate.errors || []).map(err => ({
    field: err.instancePath ? err.instancePath.replace(/^\//, '') : '(root)',
    problem: err.message || 'invalid',
  }))
  return { manifest, errors }
}

/**
 * Load and validate the spec.yaml manifest for a concept directory.
 *
 * Reads `<conceptDir>/spec.yaml` if present, parses YAML, and validates
 * against schemas/spec-manifest.schema.json via loadSchema('spec-manifest').
 *
 * @param {string} conceptDir  Absolute path to the concept directory.
 * @returns {Promise<{ manifest: object|null, errors: {field: string, problem: string}[] }>}
 *   manifest: parsed YAML object, or null when file does not exist or is unreadable.
 *   errors:   array of { field, problem } pairs; empty on success.
 */
export async function loadSpecManifest(conceptDir) {
  return _loadSpecManifestSync(conceptDir)
}

// ---------------------------------------------------------------------------
// Build index data (AC2, AC3, AC4, AC6; RFC-0003 body-format)
// ---------------------------------------------------------------------------

/**
 * Build index from all spec files under `sd`.
 * Returns { nodes: Record<id, NodeRecord>, errors: ErrorRecord[] }
 *
 * File handling (RFC-0003):
 *   requirements.md  — body parsed as H3 requirement sections; one node per section.
 *   README.md / other — frontmatter id required; yields one concept/metadata node.
 *
 * Error types:
 *   { type: 'duplicate_id',            id, paths: [p1, p2] }
 *   { type: 'parent_dir_mismatch',     nodeId, frontmatter, directory, path }
 *   { type: 'unknown_frontmatter_field', field, nodeId?, path }
 *   { type: 'requirement_parse_error', nodeId, message, path }
 *
 * Legacy error type removed (ears/verify moved to body):
 *   path_in_verify — no longer emitted; check is now a lint concern only.
 */
export function buildIndexData(sd) {
  const files = walkSpecFiles(sd)
  const errors = []
  const warnings = []
  const nodes = {}
  const idToPath = {}

  // ---------------------------------------------------------------------------
  // S0 pre-pass: collect view file paths from all spec.yaml manifests.
  // Must run BEFORE the walk loop so viewFilePaths is populated (S0-AC5).
  // ---------------------------------------------------------------------------
  /** @type {Set<string>} Absolute paths of view files declared in spec.yaml manifests. */
  const viewFilePaths = new Set()
  /** @type {Map<string, {type: string, file: string}[]>} conceptDir → views array */
  const conceptDirViews = new Map()

  for (const { conceptDir } of walkSpecYamlFiles(sd)) {
    const { manifest } = _loadSpecManifestSync(conceptDir)
    if (manifest && Array.isArray(manifest.views)) {
      conceptDirViews.set(conceptDir, manifest.views)
      for (const view of manifest.views) {
        if (view && typeof view.file === 'string') {
          viewFilePaths.add(join(conceptDir, view.file))
        }
      }
    }
  }
  // ---------------------------------------------------------------------------

  for (const { absPath, relPath } of files) {
    // S0: skip files declared as views in a spec.yaml manifest.
    // README.md is always exempt — it is the concept node itself.
    // constraints.md / requirements.md are always exempt — they are requirements documents
    // and skipping them silently drops all their requirements (silent data loss).
    const _bn = basename(absPath)
    if (viewFilePaths.has(absPath) && _bn !== 'README.md' && _bn !== 'constraints.md' && _bn !== 'requirements.md') {
      // Warn if this non-canonical view file contains requirement-shaped headings — they will be silently dropped.
      let _viewRaw
      try { _viewRaw = readFileSync(absPath, 'utf8') } catch { /* unreadable — skip silently */ }
      if (_viewRaw && /^##+ [A-Z].*-R-\d/m.test(_viewRaw)) {
        warnings.push({ type: 'view_shadows_requirements', path: absPath,
          message: `${_bn} is listed under spec.yaml views: but also contains requirements — they will be silently dropped` })
      }
      continue
    }
    // constraints.md / requirements.md declared as views: canonical usage — always indexed, no warning.
    let raw
    try { raw = readFileSync(absPath, 'utf8') } catch { continue }

    const filename = basename(absPath)

    if (filename === 'constraints.md' || filename === 'requirements.md') {
      // -----------------------------------------------------------------------
      // RFC-0003: parse requirement sections from the body.
      // constraints.md is canonical; requirements.md is a deprecated alias.
      // -----------------------------------------------------------------------
      if (filename === 'requirements.md') {
        warnings.push({
          type: 'deprecated_requirements_filename',
          path: absPath,
          message: `${absPath}: requirements.md is deprecated — rename this file to constraints.md`,
        })
      }
      const { data: fileData } = parseYamlFrontmatter(raw)

      // Validate no unknown fields in file-level frontmatter (catches stale ears:/verify:)
      for (const field of Object.keys(fileData)) {
        if (!ALLOWED_FRONTMATTER_FIELDS.has(field)) {
          errors.push({ type: 'unknown_frontmatter_field', field, path: absPath })
        }
      }

      const conceptId = findNearestConceptId(absPath, sd)
      const sections = parseRequirementsDocument(raw)
      const byteSize = Buffer.byteLength(raw, 'utf8')

      for (const section of sections) {
        const id = section.id

        // AC4: duplicate id detection
        if (idToPath[id]) {
          errors.push({ type: 'duplicate_id', id, paths: [idToPath[id], absPath] })
          continue
        }
        idToPath[id] = absPath

        // Propagate section-level parse errors
        for (const msg of section.errors) {
          errors.push({ type: 'requirement_parse_error', nodeId: id, message: msg, path: absPath })
        }

        // RULE-08 (concept nodes): summary is a frontmatter label.
        // For requirement nodes: derive from normative statement or fall back to title.
        const summary = section.normativeStatement
          ? firstSentence(section.normativeStatement)
          : section.title

        nodes[id] = {
          id,
          type: 'requirement',
          title: section.title,
          summary,
          refs: section.refs,
          byteSize,
          relPath,
          // AC11: inbound computed after all nodes collected
          inbound: [],
          // Body-derived fields
          concept: conceptId,
          parent: null,
          status: null,
          pattern: null,
          verification: section.verification,
          criticality: section.criticality || 'must',
          // `ears` preserved in node shape for display consumers; populated from body
          ears: section.normativeStatement,
          anchor: section.anchor,
          why: section.why,
          fitCriterion: section.fitCriterion,
          source: section.source,
        }
      }
    } else {
      // -----------------------------------------------------------------------
      // README.md and other .md files — concept/metadata nodes from frontmatter
      // -----------------------------------------------------------------------
      const { data, body } = parseYamlFrontmatter(raw)
      if (!data.id) continue

      const id = String(data.id)

      // Reject any frontmatter field not in the allowed set (ears/verify will trigger this)
      for (const field of Object.keys(data)) {
        if (!ALLOWED_FRONTMATTER_FIELDS.has(field)) {
          errors.push({ type: 'unknown_frontmatter_field', field, nodeId: id, path: absPath })
        }
      }

      // AC4: duplicate id detection
      if (idToPath[id]) {
        errors.push({ type: 'duplicate_id', id, paths: [idToPath[id], absPath] })
        continue
      }
      idToPath[id] = absPath

      const refs = extractRefs(raw, id)
      const byteSize = Buffer.byteLength(raw, 'utf8')

      // AC3: parent frontmatter field vs directory position
      if (data.concept) {
        const expectedConcept = findNearestConceptId(absPath, sd)
        if (expectedConcept && String(data.concept) !== expectedConcept) {
          errors.push({
            type: 'parent_dir_mismatch',
            nodeId: id,
            frontmatter: String(data.concept),
            directory: expectedConcept,
            path: absPath,
          })
        }
      }

      // AC12: if verify contains a path-like token, emit a blocking error.
      // verify is not in ALLOWED_FRONTMATTER_FIELDS (RFC-0003 moved it to the body)
      // but we still check it when present in old-format files to preserve AC12 enforcement.
      if (data.verify && typeof data.verify === 'string') {
        const bad = pathLikeToken(data.verify)
        if (bad) {
          errors.push({ type: 'path_in_verify', nodeId: id, token: bad, path: absPath })
        }
      }

      // RULE-08: `summary` is the frontmatter index label (≤25 words).  When absent,
      // fall back through: ears (old-format) → H1 → title → firstSentence(body).
      // `ears` is no longer in ALLOWED_FRONTMATTER_FIELDS (RFC-0003) but may be present
      // in old-format files; we use its value for derivation without blocking.
      const h1 = extractH1(body)
      const earsStr = data.ears ? String(data.ears) : null
      const summary = data.summary
        ? String(data.summary)
        : earsStr
          ? firstSentence(earsStr)
          : h1 ?? (data.title ? String(data.title) : firstSentence(body || id))

      nodes[id] = {
        id,
        type: data.type ? String(data.type) : (data.concept ? 'requirement' : 'concept'),
        title: String(data.title || data.summary || (earsStr ? firstSentence(earsStr) : null) || h1 || id),
        summary,
        refs,
        byteSize,
        relPath,
        // AC11: inbound computed after all nodes collected
        inbound: [],
        // Frontmatter fields
        concept: data.concept ? String(data.concept) : null,
        parent: data.parent !== undefined ? (data.parent ? String(data.parent) : null) : null,
        status: data.status ? String(data.status) : null,
        pattern: data.pattern ? String(data.pattern) : null,
        verification: data.verification ? String(data.verification) : null,
        criticality: data.criticality ? String(data.criticality) : 'must',
        // ears: preserved from old-format frontmatter for display/search consumers
        ears: earsStr,
      }

      // S0: attach views from spec.yaml manifest to the concept node (README.md).
      if (basename(absPath) === 'README.md') {
        const dirViews = conceptDirViews.get(dirname(absPath))
        if (dirViews) nodes[id].views = dirViews
      }
    }
  }

  // Compute inbound references (AC11)
  for (const node of Object.values(nodes)) {
    for (const ref of node.refs) {
      if (nodes[ref]) {
        nodes[ref].inbound.push(node.id)
      }
    }
  }

  return { nodes, errors, warnings }
}

// ---------------------------------------------------------------------------
// Extract ALL heading anchors from a Markdown file (any level, any style).
//
// Two anchor sources are recognised:
//   1. Explicit {#anchor} attribute at end of heading line (Pandoc/kramdown style)
//   2. GitHub-style slug: lowercase, collapse non-alphanumeric runs to hyphens,
//      strip leading/trailing hyphens.
//
// Used by spec-lint xref resolution so that links to ordinary headings
// (e.g. `## Case register`) do not produce false xref-dangling violations.
// ---------------------------------------------------------------------------

/**
 * Convert a heading text (without the leading `#` characters or a trailing
 * `{#…}` attribute) into a GitHub-style anchor slug.
 *
 * @param {string} text
 * @returns {string}
 */
export function githubSlug(text) {
  return text
    .toLowerCase()
    // Keep Unicode letters, numbers, spaces, hyphens; strip everything else.
    // \p{L} matches any Unicode letter (including accented chars, CJK, etc.)
    // \p{N} matches any Unicode number. The `u` flag enables Unicode property escapes.
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/[\s_]+/g, '-')    // spaces/underscores → hyphens
    .replace(/-+/g, '-')        // collapse multiple hyphens
    .replace(/^-+|-+$/g, '')    // strip leading/trailing hyphens
}

/**
 * Return all heading anchors present in a Markdown string.
 * Anchors from explicit `{#…}` attributes take priority; everything else
 * gets a GitHub-style slug derived from the heading text.
 *
 * @param {string} markdown
 * @returns {Set<string>}
 */
export function extractAllHeadingAnchors(markdown) {
  const { body } = parseYamlFrontmatter(markdown)
  const anchors = new Set()
  // Strip fenced code blocks (``` or ~~~ fences) before scanning for headings so
  // that heading-shaped lines inside a fence do not manufacture phantom anchors.
  // The fence marker may be indented up to 3 spaces (CommonMark §4.5).
  const bodyWithoutFences = body.replace(
    /^( {0,3})(```+|~~~+)[^\n]*\n[\s\S]*?^\1\2[ \t]*$/gm,
    '',
  )
  // Match any ATX heading line (# through ######)
  const HEADING_LINE_RE = /^#{1,6} (.+)$/gm
  for (const match of bodyWithoutFences.matchAll(HEADING_LINE_RE)) {
    const raw = match[1].trim()
    // Check for explicit {#anchor} attribute at end of the heading text
    const explicitMatch = raw.match(/\{#([^}]+)\}\s*$/)
    if (explicitMatch) {
      anchors.add(explicitMatch[1].trim())
    } else {
      anchors.add(githubSlug(raw))
    }
  }
  return anchors
}

// ---------------------------------------------------------------------------
// Load persisted index (AC10, AC11)
// ---------------------------------------------------------------------------

export function loadIndex(sd) {
  const p = indexJsonPath(sd)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch { return null }
}

// ---------------------------------------------------------------------------
// Random suffix generation (AC5)
// ---------------------------------------------------------------------------

const BASE32_CHARS = 'abcdefghijklmnopqrstuvwxyz234567'

export function randomSuffix(existingIds) {
  const existing = new Set(existingIds)
  for (let attempt = 0; attempt < 256; attempt++) {
    let s = ''
    for (let i = 0; i < 4; i++) {
      s += BASE32_CHARS[Math.floor(Math.random() * BASE32_CHARS.length)]
    }
    if (!existing.has(s)) return s
  }
  throw new Error('could not generate a unique 4-char suffix after 256 attempts')
}
