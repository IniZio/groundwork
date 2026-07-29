/**
 * spec-io.mjs — shared I/O utilities for the spec CLI.
 *
 * Pure data functions; no process.exit. No cross-imports from rfc-io or journal-io.
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
  'origin_rfc', 'status', 'pattern', 'verification', 'criticality',
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
  // Match the attribute line regardless of whether it is bare or inside a bullet
  const re = /\*\*Verification\*\*\s+(\S+)\s*[·•]\s*\*\*Criticality\*\*\s+(\S+)\s*[·•]\s*\*\*Source\*\*\s+(\S+)/
  for (const line of sectionBody.split('\n')) {
    const bare = line.startsWith('- ') || line.startsWith('* ') ? line.slice(2) : line
    const m = bare.match(re)
    if (m) return { verification: m[1], criticality: m[2], source: m[3] }
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

  // Split body on H3 heading boundaries.  Every chunk that starts with "### " is
  // a potential requirement section; chunks without that prefix are preamble.
  const chunks = body.split(/^(?=### )/m)

  // Heading pattern: ### ID — Title {#anchor}
  // The em-dash (—, U+2014) or en-dash (–) separates ID from title.
  const HEADING_RE = /^### ([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-R-\S+)\s+[—–]\s+(.+?)\s+\{#([^}]+)\}\s*(?:\n|$)/

  for (const chunk of chunks) {
    if (!chunk.startsWith('### ')) continue

    const headingLine = chunk.split('\n')[0] + '\n'
    const hm = headingLine.match(HEADING_RE)
    if (!hm) continue  // non-requirement H3 (section header etc.) — skip

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
    } else if (!normativeStatement.includes('**shall**')) {
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
    if (viewFilePaths.has(absPath) && basename(absPath) !== 'README.md') continue
    let raw
    try { raw = readFileSync(absPath, 'utf8') } catch { continue }

    const filename = basename(absPath)

    if (filename === 'requirements.md') {
      // -----------------------------------------------------------------------
      // RFC-0003: parse H3 requirement sections from the body
      // -----------------------------------------------------------------------
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

  return { nodes, errors }
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
