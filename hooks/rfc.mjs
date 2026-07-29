#!/usr/bin/env node
/**
 * Groundwork RFC CLI
 *
 * Commands:
 *   rfc new <slug> [--supersedes <uid> ...]
 *   rfc validate <dir>
 *   rfc set-status <dir> <status>
 *   rfc status <dir>
 *
 * Exit codes: 0 success, 1 operational failure, 2 usage error.
 *
 * §3.2 TRANSITION TABLE (rfc.md §3.2, lines 1012-1023):
 *   draft        → review | abandoned
 *   review       → review | accepted | rejected | superseded
 *   accepted     → implementing | superseded | abandoned
 *   implementing → implemented | superseded | abandoned
 *   implemented  → superseded
 *   rejected     → (terminal)
 *   superseded   → (terminal)
 *   abandoned    → superseded
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseDocument, stringify } from 'yaml'
import {
  assembleLogicalBody,
  generateUid,
  parseFrontmatter,
  serializeFrontmatter,
  computeBodyDigest,
  nextOrdinal,
  findRfcByUid,
  readJournalEntries,
  findLedgersForRfc,
  readTasksSidecar,
  validateSectionLayout,
  generateManifestBlock,
  extractManifestBlock,
  writeManifest,
} from './lib/rfc-io.mjs'
import {
  checkReviewGate,
  cmdReviewGenerate,
  cmdReviewAdd,
  cmdReviewResolve,
  cmdReviewParseCriticmarkup,
} from './rfc-review.mjs'
import { loadSchema, ajvErrorsToLines } from './lib/schema-io.mjs'

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function die(msg, code = 1) {
  process.stderr.write(`rfc: ${msg}\n`)
  process.exit(code)
}

function out(msg) {
  process.stdout.write(msg + '\n')
}

/** Parse --flag value pairs from argv. Returns { flags, positionals }. */
function parseFlags(args) {
  const flags = {}
  const positionals = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--') {
      positionals.push(...args.slice(i + 1))
      break
    }
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = args[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        if (key === 'supersedes') {
          // collect multiple --supersedes values into an array
          if (!Array.isArray(flags[key])) flags[key] = []
          flags[key].push(next)
        } else {
          flags[key] = next
        }
        i++
      } else {
        flags[key] = true
      }
    } else {
      positionals.push(a)
    }
  }
  return { flags, positionals }
}

function projectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd()
}

function rfcsDir() {
  return path.join(projectDir(), '.groundwork', 'rfcs')
}

// ---------------------------------------------------------------------------
// Sidecar helpers — S2: rfc.yaml takes over machine-readable frontmatter
// ---------------------------------------------------------------------------

/**
 * Read RFC frontmatter, preferring rfc.yaml sidecar over rfc.md YAML block.
 *
 * Returns { frontmatter, doc, body, source } where:
 *   source = 'sidecar' when read from rfc.yaml
 *   source = 'rfc.md'  when read from rfc.md frontmatter (legacy)
 *   body   = prose string from rfc.md (sidecar path returns full rfc.md content)
 *   doc    = yaml.Document (parseDocument result; for sidecar path, parses rfc.yaml)
 *
 * Throws if neither source is readable.
 */
function readSidecarFrontmatter(rfcPath) {
  const yamlPath = path.join(rfcPath, 'rfc.yaml')
  const mdPath = path.join(rfcPath, 'rfc.md')

  if (existsSync(yamlPath)) {
    const yamlContent = readFileSync(yamlPath, 'utf8')
    const doc = parseDocument(yamlContent)
    const frontmatter = doc.toJS()
    const body = existsSync(mdPath) ? readFileSync(mdPath, 'utf8') : ''
    return { frontmatter, doc, body, source: 'sidecar' }
  }

  // Legacy fallback: read frontmatter from rfc.md YAML block
  const content = readFileSync(mdPath, 'utf8')
  const parsed = parseFrontmatter(content)
  return { ...parsed, source: 'rfc.md' }
}

/**
 * Find an RFC directory by uid, checking rfc.yaml first then rfc.md frontmatter.
 * Local dual-read version — works after frontmatter has been extracted to rfc.yaml.
 *
 * @param {string} dir  Path to the .groundwork/rfcs/ directory.
 * @param {string} uid  RFC uid to search for.
 * @returns {string|null}  Absolute path to the RFC directory, or null.
 */
function findRfcByUidLocal(dir, uid) {
  if (!existsSync(dir)) return null
  for (const name of readdirSync(dir)) {
    const rfcDir = path.join(dir, name)
    try {
      const { frontmatter } = readSidecarFrontmatter(rfcDir)
      if (frontmatter.uid === uid) return rfcDir
    } catch {
      // Skip unreadable entries
    }
  }
  return null
}

/**
 * Compute the S2 body digest: SHA-256 over all section files in canonical
 * section order (all sections, no §1–8 filter) concatenated with the JSON
 * encoding of the tasks[] array from tasks.yaml.
 *
 * Input set differs from the legacy computeBodyDigest (rfc-io.mjs) in two ways:
 *   1. No §§1–8 filter — all sections contribute.
 *   2. spec_delta is excluded (it moves to rfc.yaml and is mutable metadata).
 *
 * @param {string} rfcDir  Absolute path to the RFC directory.
 * @returns {string}  Hex-encoded SHA-256 digest.
 */
function computeNewBodyDigest(rfcDir) {
  const prose = assembleLogicalBody(rfcDir, null)
  const tasks = readTasksSidecar(rfcDir)
  return createHash('sha256').update(prose + JSON.stringify(tasks), 'utf8').digest('hex')
}

// ---------------------------------------------------------------------------
// §3.2 Transition table (quoted from rfc.md §3.2, lines 1012-1023)
// ---------------------------------------------------------------------------

const TRANSITIONS = {
  draft:        ['review', 'abandoned'],
  review:       ['review', 'accepted', 'rejected', 'superseded'],
  accepted:     ['implementing', 'superseded', 'abandoned'],
  implementing: ['implemented', 'superseded', 'abandoned'],
  implemented:  ['superseded'],
  rejected:     [],
  superseded:   [],
  abandoned:    ['superseded'],
}

// spec_delta change types — Keep a Changelog v1.1.0 vocabulary (full published
// set; partial adoption of a standard is the anti-pattern RFC-0002 §3 rejects).
// `supersede` from the prior bespoke enum maps to `Deprecated`; the replacement
// pointer moves into the entry's `description` text. See RFC-0002 §11/§12.
const SPEC_DELTA_OPS = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security']

const ALL_STATUSES = new Set(Object.keys(TRANSITIONS))

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

/**
 * Validate RFC frontmatter object against the given JSON Schema and additional
 * hand-written invariants.
 *
 * @param {object} fm         Parsed frontmatter JS object.
 * @param {string} schemaName Schema name passed to loadSchema(). Use
 *   'rfc-manifest' for sidecar RFCs and 'rfc-frontmatter' for legacy rfc.md.
 */
function validateFrontmatter(fm, schemaName = 'rfc-frontmatter') {
  const errors = []

  // ---------------------------------------------------------------------------
  // JSON Schema validation — field types, enums, required, additionalProperties
  // ---------------------------------------------------------------------------
  // Covers: required fields, schema version, uid pattern, status/classification
  // enums, accepted_by oneOf, supersedes/superseded_by patterns, spec_delta type
  // and item additionalProperties (enforces the note→description rename from STD7).
  // Does NOT cover: spec_delta op vocabulary (custom message below), spec_delta
  // target (custom "non-empty target" message below), cross-field accepted_by+
  // spec_change, tasks shape, status transitions, body_digest, manifest freshness.
  const schemaValidate = loadSchema(schemaName)
  if (!schemaValidate(fm)) {
    // Filter out spec_delta op enum and target errors — hand-written checks below
    // emit better-formatted messages for those specific paths.
    const filtered = (schemaValidate.errors ?? []).filter(err => {
      const p = err.instancePath
      if (/^\/spec_delta\/\d+\/op$/.test(p) && err.keyword === 'enum') return false
      if (/^\/spec_delta\/\d+$/.test(p) && err.keyword === 'required') return false
      if (/^\/spec_delta\/\d+\/target$/.test(p) && err.keyword === 'minLength') return false
      return true
    })
    errors.push(...ajvErrorsToLines(filtered, 'rfc'))
  }

  // ---------------------------------------------------------------------------
  // Hand-written checks for invariants the schema cannot express
  // ---------------------------------------------------------------------------

  // spec_delta op vocabulary — Keep a Changelog v1.1.0 values only.
  // Custom message includes the legacy→new mapping so an unreached RFC on another
  // machine knows exactly how to hand-migrate (`.groundwork/` is gitignored).
  if (Array.isArray(fm.spec_delta)) {
    for (const op of fm.spec_delta) {
      if (!SPEC_DELTA_OPS.includes(op.op)) {
        errors.push(
          `spec_delta: op must be ${SPEC_DELTA_OPS.join('|')} (got "${op.op}")` +
          ` — legacy mapping: add→Added, modify→Changed, remove→Removed, supersede→Deprecated`
        )
      }
      if (!op.target) errors.push('spec_delta: each op must have a non-empty target')
    }
  }

  // Cross-field: spec_change classification requires human acceptance (not expressible
  // as a simple enum constraint; would need if/then JSON Schema logic).
  if (fm.classification === 'spec_change' && fm.accepted_by === 'advisor') {
    errors.push('accepted_by: must be "human" when classification is spec_change')
  }

  // tasks[] validation — only when the key is present in frontmatter.
  // For multi-file RFCs, tasks live in tasks.yaml; for legacy single-file RFCs,
  // migrate.mjs may still write tasks to frontmatter.
  if ('tasks' in fm) {
    if (!Array.isArray(fm.tasks)) {
      errors.push('tasks: must be an array')
    } else {
      for (const t of fm.tasks) {
        const tid = t.id ?? '?'
        for (const f of ['id', 'title', 'wave', 'blocked_by', 'files', 'ac']) {
          if (!(f in t)) errors.push(`tasks[${tid}]: missing field ${f}`)
        }
        if (t.conditional === true && !t.trigger) {
          errors.push(`tasks[${tid}]: conditional:true requires a trigger field`)
        }
      }
    }
  }

  return errors
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

// Section scaffold for rfc new — §§1-13 leaf files under sections/.
// Heading depth is 2 (##) for all top-level sections per §1.1 rule 5.
// Entries with a `content` field use that verbatim instead of the default "TODO" body.
const SCAFFOLD_SECTIONS = [
  { prefix: '01', slug: 'summary',           heading: '## 1. Summary' },
  { prefix: '02', slug: 'motivation',         heading: '## 2. Motivation' },
  { prefix: '03', slug: 'design',             heading: '## 3. Design' },
  { prefix: '04', slug: 'alternatives',       heading: '## 4. Alternatives' },
  { prefix: '05', slug: 'security',           heading: '## 5. Security' },
  { prefix: '06', slug: 'observability',      heading: '## 6. Observability' },
  { prefix: '07', slug: 'migration',          heading: '## 7. Migration' },
  { prefix: '08', slug: 'open-questions',     heading: '## 8. Open Questions' },
  { prefix: '09', slug: 'appendix',           heading: '## 9. Appendix' },
  { prefix: '10', slug: 'tasks',              heading: '## 10. Tasks' },
  { prefix: '11', slug: 'conflict-register',  heading: '## 11. Conflict Register' },
  { prefix: '12', slug: 'resolution',         heading: '## 12. Resolution' },
  {
    prefix: '13',
    slug: 'decision-record',
    heading: '## 13. Decision Record',
    // MADR (Markdown Architectural Decision Records) structure.
    // One block per major decision this RFC introduces. Duplicate from
    // "### Decision N" through its closing "---" for each additional decision.
    // NOTE: do NOT use MADR's status vocabulary (proposed/accepted/deprecated/…)
    // or its immutability rule — the RFC lifecycle (rfc.md §3.2) is authoritative.
    content: `\
## 13. Decision Record

<!-- One block per major decision this RFC introduces.
     Duplicate from the next "### Decision N" heading through its closing "---"
     for each additional decision. Do NOT use MADR status fields (proposed/accepted/…)
     — RFC status is governed by the frontmatter status field and §3.2. -->

### Decision 1: <title>

#### Context and Problem Statement

TODO — what is the problem, and why does it require a decision now?

#### Decision Drivers

- TODO

#### Considered Options

- Option A — TODO
- Option B — TODO

#### Decision Outcome

Chosen option: **Option A**, because TODO.

#### Consequences

- Good: TODO
- Bad: TODO

#### Pros and Cons of Options

**Option A**

- Pro: TODO
- Con: TODO

**Option B**

- Pro: TODO
- Con: TODO

---
`,
  },
]

function cmdNew(args) {
  const { flags, positionals } = parseFlags(args)
  const slug = positionals[0]
  if (!slug) die('usage: rfc new <slug> [--supersedes <uid>]', 2)

  // Unknown flags → error (rfc new was extended; unknown flags must be rejected).
  const knownFlags = new Set(['supersedes'])
  for (const key of Object.keys(flags)) {
    if (!knownFlags.has(key)) die(`rfc new: unknown flag --${key}`, 2)
  }

  const dir = rfcsDir()
  mkdirSync(dir, { recursive: true })

  // Resolve all --supersedes targets before writing anything (AC 7 atomicity)
  const supersedesUids = Array.isArray(flags.supersedes)
    ? flags.supersedes
    : flags.supersedes ? [flags.supersedes] : []

  const supersededDirs = []
  for (const targetUid of supersedesUids) {
    if (!/^R-\d{8}-[A-Z0-9]{6}$/.test(targetUid)) {
      die(`--supersedes: "${targetUid}" is not a valid RFC uid`)
    }
    // Use local dual-read lookup so we find RFCs whose frontmatter has moved to rfc.yaml
    const targetDir = findRfcByUidLocal(dir, targetUid)
    if (!targetDir) die(`--supersedes: RFC with uid "${targetUid}" not found`)
    supersededDirs.push({ uid: targetUid, dir: targetDir })
  }

  const ordinal = nextOrdinal(dir)
  const uid = generateUid()
  const now = new Date().toISOString()
  const rfcDir = path.join(dir, String(ordinal).padStart(4, '0') + '-' + slug)

  if (existsSync(rfcDir)) die(`RFC directory already exists: ${rfcDir}`)

  // Frontmatter — tasks is NOT included; it lives in tasks.yaml sidecar.
  const frontmatter = {
    schema: 2,
    uid,
    ordinal,
    slug,
    title: slug.replace(/-/g, ' '),
    status: 'draft',
    classification: 'tactical',
    created: now,
    updated: now,
    accepted_at: null,
    accepted_by: null,
    supersedes: supersedesUids,
    superseded_by: null,
    body_digest: null,
    spec_delta: [],
  }

  // Create directory structure (AC 1)
  mkdirSync(rfcDir, { recursive: true })
  mkdirSync(path.join(rfcDir, 'notes'), { recursive: true })
  mkdirSync(path.join(rfcDir, 'reviews'), { recursive: true })

  // Create sections/ directory with one leaf file per §§1-12.
  const sectionsDir = path.join(rfcDir, 'sections')
  mkdirSync(sectionsDir, { recursive: true })
  for (const s of SCAFFOLD_SECTIONS) {
    const filename = `${s.prefix}-${s.slug}.md`
    writeFileSync(path.join(sectionsDir, filename), s.content ?? `${s.heading}\n\nTODO\n`)
  }

  // Create tasks.yaml sidecar — empty array for a new RFC.
  writeFileSync(path.join(rfcDir, 'tasks.yaml'), '[]\n')

  // Write rfc.yaml: machine-readable sidecar (S2 pattern).
  const fmYaml = stringify(frontmatter, { lineWidth: 0 })
  writeFileSync(path.join(rfcDir, 'rfc.yaml'), fmYaml)

  // Write rfc.md: prose-only (no YAML frontmatter block).
  // Section prose lives entirely in sections/; rfc.md holds abstract + manifest.
  const body = `\n> Abstract: TODO\n\n<!-- rfc:manifest:begin — generated by \`rfc index\`; do not hand-edit -->\n<!-- rfc:manifest:end -->\n`
  writeFileSync(path.join(rfcDir, 'rfc.md'), body)

  // Generate the manifest immediately so validate exits 0 right after new.
  writeManifest(rfcDir)

  // AC 7: atomically set superseded_by on each target.
  // Support both sidecar (rfc.yaml) and legacy (rfc.md frontmatter) targets.
  for (const { uid: targetUid, dir: targetDir } of supersededDirs) {
    const targetYaml = path.join(targetDir, 'rfc.yaml')
    if (existsSync(targetYaml)) {
      // Sidecar target: update rfc.yaml
      const yamlContent = readFileSync(targetYaml, 'utf8')
      const doc = parseDocument(yamlContent)
      doc.set('superseded_by', uid)
      doc.set('updated', now)
      writeFileSync(targetYaml, doc.toString({ lineWidth: 0 }))
    } else {
      // Legacy target: update rfc.md frontmatter
      const targetMd = path.join(targetDir, 'rfc.md')
      const content = readFileSync(targetMd, 'utf8')
      const { doc, body: targetBody } = parseFrontmatter(content)
      doc.set('superseded_by', uid)
      doc.set('updated', now)
      writeFileSync(targetMd, serializeFrontmatter(doc, targetBody))
    }
    out(`  superseded_by on ${targetUid} → ${uid}`)
  }

  out(`Created ${rfcDir}`)
  out(`  uid: ${uid}`)
  out(`  ordinal: ${ordinal}`)
}

function cmdIndex(args) {
  const { positionals } = parseFlags(args)
  const rfcPath = positionals[0]
  if (!rfcPath) die('usage: rfc index <dir>', 2)

  const rfcMd = path.join(rfcPath, 'rfc.md')
  if (!existsSync(rfcMd)) die(`rfc.md not found: ${rfcMd}`)

  const sectionsDir = path.join(rfcPath, 'sections')
  if (!existsSync(sectionsDir)) die(`sections/ not found: ${sectionsDir}`)

  writeManifest(rfcPath)
  out('Manifest written.')
}

function cmdValidate(args) {
  const { positionals } = parseFlags(args)
  const rfcPath = positionals[0]
  if (!rfcPath) die('usage: rfc validate <dir>', 2)

  // Require at minimum rfc.md (prose) or rfc.yaml (sidecar) to exist
  const rfcYaml = path.join(rfcPath, 'rfc.yaml')
  const rfcMd = path.join(rfcPath, 'rfc.md')
  if (!existsSync(rfcYaml) && !existsSync(rfcMd)) die(`rfc.md not found: ${rfcPath}`)

  // AC 3: report line/col on YAML parse error
  let parsed
  try {
    parsed = readSidecarFrontmatter(rfcPath)
  } catch (e) {
    if (e.line != null) {
      process.stderr.write(`rfc: YAML parse error at line ${e.line}, column ${e.col}: ${e.message}\n`)
    } else {
      process.stderr.write(`rfc: ${e.message}\n`)
    }
    process.exit(1)
  }

  const { frontmatter, body: rfcBody, source } = parsed
  // Use rfc-manifest schema for sidecar RFCs; rfc-frontmatter for legacy rfc.md
  const schemaName = source === 'sidecar' ? 'rfc-manifest' : 'rfc-frontmatter'
  const errors = validateFrontmatter(frontmatter, schemaName)

  // Strict layout validation — keyed on schema version, NOT on filesystem presence.
  // schema >= 2 → STRICT: sections/ MUST exist, tasks.yaml MUST exist, naming validated.
  // schema 1 (or absent/null, treated as 1) → legacy/lenient: no layout requirements.
  // Absent schema: treated as 1 (lenient) so that pre-schema RFCs and migrate.mjs output
  // (which stamps schema: 1) remain valid without any migration step.
  const sectionsDir = path.join(rfcPath, 'sections')
  if ((frontmatter.schema ?? 1) >= 2) {
    // sections/ MUST exist for a schema-2 RFC — a single-file schema-2 RFC is non-conformant.
    if (!existsSync(sectionsDir)) {
      errors.push('layout: sections/ directory is missing (required for schema 2+ RFCs)')
    }
    // tasks.yaml MUST exist for schema-2 RFCs.
    if (!existsSync(path.join(rfcPath, 'tasks.yaml'))) {
      errors.push('layout: tasks.yaml is missing (required for schema 2+ RFCs)')
    }
    // Validate naming and numbering conventions inside sections/ (only if it exists).
    if (existsSync(sectionsDir)) {
      const layoutErrors = validateSectionLayout(sectionsDir)
      errors.push(...layoutErrors)
    }
  }

  // Manifest freshness check — schema >= 2 + sections/ must exist (layout error already
  // reported if missing). A stale manifest fails validate; run `rfc index <dir>` to fix.
  // For sidecar RFCs, rfcBody is the full rfc.md prose content; for legacy, the full rfc.md.
  if ((frontmatter.schema ?? 1) >= 2 && existsSync(sectionsDir)) {
    const currentBlock = extractManifestBlock(rfcBody)
    const expectedBlock = generateManifestBlock(rfcPath)
    if (currentBlock !== expectedBlock) {
      errors.push('manifest: stale — run `rfc index <dir>` to regenerate')
    }
  }

  // AC 6: body_digest integrity check for review+ statuses.
  // Sidecar RFCs use the S2 digest definition (all sections + tasks, no spec_delta).
  // Legacy rfc.md RFCs use the old definition (§§1–8 + spec_delta + tasks).
  const frozenStatuses = new Set(['review', 'accepted', 'implementing', 'implemented', 'rejected', 'superseded', 'abandoned'])
  if (frozenStatuses.has(frontmatter.status) && frontmatter.body_digest != null) {
    const current = source === 'sidecar'
      ? computeNewBodyDigest(rfcPath)
      : computeBodyDigest(frontmatter, rfcPath)
    if (current !== frontmatter.body_digest) {
      errors.push(
        `body_digest mismatch: body was mutated after RFC moved to "${frontmatter.status}"\n` +
        `  stored:  ${frontmatter.body_digest}\n` +
        `  current: ${current}`
      )
    }
  }

  if (errors.length > 0) {
    for (const e of errors) process.stderr.write(`rfc: validate: ${e}\n`)
    process.exit(1)
  }

  out('OK')
  process.exit(0)
}

function cmdSetStatus(args) {
  const { positionals } = parseFlags(args)
  const rfcPath = positionals[0]
  const newStatus = positionals[1]

  if (!rfcPath || !newStatus) die('usage: rfc set-status <dir> <status>', 2)
  if (!ALL_STATUSES.has(newStatus)) {
    die(`invalid status "${newStatus}". Must be: ${[...ALL_STATUSES].join(', ')}`, 2)
  }

  let parsed
  try {
    parsed = readSidecarFrontmatter(rfcPath)
  } catch (e) {
    die(`YAML parse error: ${e.message}`)
  }

  const { frontmatter, doc, body, source } = parsed
  const currentStatus = frontmatter.status
  const permitted = TRANSITIONS[currentStatus] ?? []

  // AC 8: enforce transition table
  if (!permitted.includes(newStatus)) {
    if (permitted.length === 0) {
      die(`"${currentStatus}" is a terminal state — no transitions are permitted`)
    }
    die(
      `Transition "${currentStatus}" → "${newStatus}" is not permitted.\n` +
      `  Permitted from "${currentStatus}": ${permitted.join(', ')}`
    )
  }

  const now = new Date().toISOString()
  doc.set('status', newStatus)
  doc.set('updated', now)

  // Stamp body_digest when first entering review (draft → review).
  // Sidecar RFCs use the S2 digest (all sections + tasks, no spec_delta).
  // Legacy rfc.md RFCs use the old definition (§§1–8 + spec_delta + tasks).
  if (newStatus === 'review' && currentStatus === 'draft') {
    const digest = source === 'sidecar'
      ? computeNewBodyDigest(rfcPath)
      : computeBodyDigest(doc.toJS(), rfcPath)
    doc.set('body_digest', digest)
  }

  // AC T12.4: review gate — refuse if any review sidecar blocks acceptance
  if (newStatus === 'accepted') {
    const gate = checkReviewGate(rfcPath)
    if (!gate.ok) {
      const lines = [
        ...gate.malformed.map(m => `  MALFORMED: ${m}`),
        ...gate.offending.map(m => `  ${m}`),
      ]
      die(`Cannot accept RFC: review gate failed:\n${lines.join('\n')}`)
    }
  }

  if (newStatus === 'accepted' && !doc.get('accepted_at')) {
    doc.set('accepted_at', now)
  }

  if (source === 'sidecar') {
    // Write updated frontmatter back to rfc.yaml; rfc.md prose is unchanged.
    // lineWidth: 0 prevents YAML from reflowing long strings at 80 chars (AC5).
    writeFileSync(path.join(rfcPath, 'rfc.yaml'), doc.toString({ lineWidth: 0 }))
  } else {
    // Legacy: write frontmatter back into rfc.md
    // AC 4: body (everything after closing fence) is passed through UNCHANGED
    writeFileSync(path.join(rfcPath, 'rfc.md'), serializeFrontmatter(doc, body))
  }
  out(`${currentStatus} → ${newStatus}`)
}

function cmdStatus(args) {
  const { positionals } = parseFlags(args)
  const rfcPath = positionals[0]
  if (!rfcPath) die('usage: rfc status <dir>', 2)

  let parsed
  try {
    parsed = readSidecarFrontmatter(rfcPath)
  } catch (e) {
    die(`YAML parse error: ${e.message}`)
  }

  const { frontmatter } = parsed
  const pdir = projectDir()

  out(`RFC ${frontmatter.uid} — ${frontmatter.title}`)
  out(`  status:         ${frontmatter.status}`)
  out(`  ordinal:        ${frontmatter.ordinal}`)
  out(`  classification: ${frontmatter.classification}`)
  out(`  created:        ${frontmatter.created}`)
  out(`  updated:        ${frontmatter.updated}`)

  // AC 9: program counter — tasks from tasks.yaml sidecar if available,
  // else fall back to frontmatter.tasks (legacy single-file compatibility).
  const tasksPath = path.join(rfcPath, 'tasks.yaml')
  const tasks = existsSync(tasksPath)
    ? readTasksSidecar(rfcPath)
    : (Array.isArray(frontmatter.tasks) ? frontmatter.tasks : [])
  if (tasks.length > 0) {
    out('')
    out('Tasks (from frontmatter — plan only, no progress state):')
    for (const t of tasks) {
      const cond = t.conditional ? ' [conditional]' : ''
      out(`  [${t.id}] wave ${t.wave}${cond}: ${t.title}`)
      if (t.blocked_by?.length) out(`         blocked_by: ${t.blocked_by.join(', ')}`)
    }
  }

  // AC 9: acceptance-criteria coverage map
  const allAc = [...new Set(tasks.flatMap(t => t.ac ?? []))]
  if (allAc.length > 0) {
    out('')
    out('AC coverage map:')
    for (const ac of allAc) {
      const covering = tasks.filter(t => t.ac?.includes(ac)).map(t => t.id).join(', ')
      out(`  ${ac}: [${covering}]`)
    }
  }

  // AC 9/10: ledger-derived fields
  const ledgers = findLedgersForRfc(pdir, frontmatter.uid)
  if (ledgers.length === 0) {
    // AC 10: no matching ledger — print unavailable, exit 0
    out('')
    out('Run ledger:   (unavailable — no run ledger declares rfc_ref matching this RFC)')
    out('Gate history: (unavailable)')
    process.exit(0)
  }

  out('')
  out(`Run ledger(s): ${ledgers.length}`)
  for (const ledger of ledgers) {
    out(`  Session: ${ledger.session_id ?? '(unknown)'}`)
    if (Array.isArray(ledger.slices)) {
      for (const s of ledger.slices) {
        out(`    [${s.id}] ${s.status} — ${s.name ?? s.id}`)
      }
    }
    if (ledger.gate) {
      out(`  Gate: ${JSON.stringify(ledger.gate)}`)
    }
  }

  // AC 9: gate history from journal shards
  const journalEntries = readJournalEntries(pdir, frontmatter.uid)
  const gateHistory = journalEntries.filter(e =>
    e.type === 'GATE' || e.type === 'MILESTONE' || e.type === 'TASK_COMPLETE'
  )
  if (gateHistory.length > 0) {
    out('')
    out('Gate history (from journal):')
    for (const e of gateHistory) {
      out(`  [${e.ts}] ${e.type}: ${e.msg ?? JSON.stringify(e.data ?? {})}`)
    }
  }

  process.exit(0)
}

// ---------------------------------------------------------------------------
// review subcommand (T12) — dispatches to rfc-review.mjs exports
// ---------------------------------------------------------------------------

function cmdReview(args) {
  const subcmd = args[0]
  const rest = args.slice(1)
  const reviewCmds = {
    generate: cmdReviewGenerate,
    add: cmdReviewAdd,
    resolve: cmdReviewResolve,
    'parse-criticmarkup': cmdReviewParseCriticmarkup,
  }
  if (!subcmd || !reviewCmds[subcmd]) {
    const known = Object.keys(reviewCmds).join(', ')
    die(
      `review: unknown subcommand "${subcmd ?? ''}". ` +
      `Available: ${known}`,
      2
    )
  }
  reviewCmds[subcmd](rest)
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

const HELP_TEXT = `rfc — Groundwork RFC management CLI

Usage:
  rfc new <slug> [--supersedes <uid> ...]        Create a new RFC
  rfc index <dir>                                Regenerate the manifest block in rfc.md
  rfc validate <dir>                              Validate rfc.md frontmatter
  rfc set-status <dir> <status>                  Transition RFC status
  rfc status <dir>                               Print RFC status and run ledger state
  rfc review generate <dir> --reviewer <name>    Create an empty review sidecar
  rfc review add      <dir> --reviewer <name> --text <t> [--severity ...] [--anchor-type ...]
  rfc review resolve  <dir> --id <RC-NNN> [--wont-fix]
  rfc review parse-criticmarkup <file> [--rfc-dir <dir>] [--reviewer <name>]

Statuses: draft | review | accepted | implementing | implemented | rejected | superseded | abandoned

Exit codes: 0 success, 1 operational failure, 2 usage error

§3.2 transition table (rfc.md §3.2):
  draft        → review | abandoned
  review       → review | accepted | rejected | superseded
  accepted     → implementing | superseded | abandoned
  implementing → implemented | superseded | abandoned
  implemented  → superseded
  rejected     → (terminal)
  abandoned    → superseded
  superseded   → (terminal)`

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const [,, cmd, ...rest] = process.argv

if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
  out(HELP_TEXT)
  process.exit(0)
}

const commands = { new: cmdNew, index: cmdIndex, validate: cmdValidate, 'set-status': cmdSetStatus, status: cmdStatus, review: cmdReview }

if (!commands[cmd]) {
  die(`unknown command "${cmd}". Run \`rfc help\` for usage.`, 2)
}

try {
  const result = commands[cmd](rest)
  // handle both sync and async command functions
  if (result && typeof result.catch === 'function') {
    result.catch(e => { process.stderr.write(`rfc: ${e.message}\n`); process.exit(1) })
  }
} catch (e) {
  process.stderr.write(`rfc: ${e.message}\n`)
  process.exit(1)
}
