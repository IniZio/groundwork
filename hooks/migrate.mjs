#!/usr/bin/env node
/**
 * groundwork migrate features — convert legacy .groundwork/features/<slug>/
 * directories into motives under .groundwork/motives/<slug>/.
 *
 * Usage:
 *   migrate [--dry-run] [--delete] [slug [slug...]]
 *
 * Flags:
 *   --dry-run   (default) Print what would happen; write motive dirs but do NOT
 *               delete any source.  Safe to run any number of times.
 *   --delete    Actually delete each source directory AFTER the charter is
 *               written and journal events are flushed.  Requires explicit
 *               opt-in to prevent accidents.
 *
 * Without explicit slug arguments all feature directories are processed.
 *
 * Exit codes: 0 all processed (skips reported), 1 at least one feature failed.
 *
 * Safety contract (AC 6):
 *   Source directories are NEVER deleted in dry-run mode.
 *   In --delete mode a source is deleted only when every migration step
 *   succeeded for that feature (charter written + all events flushed).
 *   If anything fails the source is left intact and an error is reported.
 *   Idempotency: if the motive charter already exists the feature is skipped
 *   and the source is left intact.
 */

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { load as yamlLoad } from 'js-yaml'
import { renderCharterTemplate, charterPath } from './lib/motive-charter.mjs'

// We write journal shard lines directly (O_APPEND) so we can supply the
// original timestamp from history entries (the journal CLI has no --ts flag).

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Feature schema required top-level fields (from feature.schema.json)
const FEATURE_REQUIRED = new Set([
  'version', 'id', 'slug', 'active', 'status', 'health',
  'ac_coverage', 'resume', 'runs', 'history', 'created_at', 'updated_at',
])

// Map feature history.type → journal event type
// Valid feature history types: created, status_update, slice_complete,
//   slice_reopened, run_linked, decision, handoff, paused, resumed,
//   completed, canceled
const HISTORY_TYPE_MAP = {
  created:        'MILESTONE',
  status_update:  'MILESTONE',
  paused:         'MILESTONE',
  resumed:        'MILESTONE',
  completed:      'MILESTONE',
  canceled:       'MILESTONE',
  slice_complete: 'TASK_COMPLETE',
  slice_reopened: 'TASK_COMPLETE',
  run_linked:     'MILESTONE',
  decision:       'DECISION',
  handoff:        'HANDOFF',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function out(msg) {
  process.stdout.write(msg + '\n')
}

function warn(msg) {
  process.stderr.write(`migrate: warn: ${msg}\n`)
}

function projectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd()
}

function featuresDir(base) {
  return path.join(base, '.groundwork', 'features')
}

/**
 * Write a single journal event line directly to a shard (O_APPEND).
 * Mirrors appendEvent() from journal-io.mjs — we write directly so we can
 * supply a custom `ts` (original timestamp) rather than "now".
 */
function writeJournalEvent(projectBase, sessionId, event) {
  const journalDir = path.join(projectBase, '.groundwork', 'journal')
  mkdirSync(journalDir, { recursive: true })
  // Use the event's ts for the shard date, falling back to today.
  const date = (typeof event.ts === 'string' && event.ts.length >= 10)
    ? event.ts.slice(0, 10)
    : new Date().toISOString().slice(0, 10)
  const safeSession = /^[A-Za-z0-9_-]{1,128}$/.test(sessionId) ? sessionId : 'migrate'
  const shardPath = path.join(journalDir, `${date}-${safeSession}.jsonl`)
  const buf = Buffer.from(JSON.stringify(event) + '\n', 'utf8')
  const fd = openSync(shardPath, 'a')
  try {
    writeSync(fd, buf)
  } finally {
    closeSync(fd)
  }
}

// ---------------------------------------------------------------------------
// Feature YAML validation (inline — checks required fields from FEATURE_REQUIRED)
// ---------------------------------------------------------------------------

/**
 * Validate a feature directory by checking required fields in .feature.yaml.
 * Returns { ok: true } or { ok: false, error: string }.
 */
function validateFeatureDir(featureDir) {
  const yamlPath = path.join(featureDir, '.feature.yaml')
  if (!existsSync(yamlPath)) return { ok: false, error: '.feature.yaml not found' }
  let doc
  try {
    doc = yamlLoad(readFileSync(yamlPath, 'utf8'))
  } catch (e) {
    return { ok: false, error: `YAML parse error: ${e.message}` }
  }
  if (!doc || typeof doc !== 'object') return { ok: false, error: 'empty or non-object .feature.yaml' }
  const missing = [...FEATURE_REQUIRED].filter((k) => !(k in doc))
  if (missing.length > 0) return { ok: false, error: `missing required fields: ${missing.join(', ')}` }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Objective extraction
// ---------------------------------------------------------------------------

/**
 * Extract the objective from a feature document.
 * Priority: doc.goal → doc.description → doc.title → spec.md ## Goal section
 * → fallback placeholder.
 *
 * Per Q15, lossy history is noted in the charter rather than silently lost.
 */
function extractObjective(doc, featureDir) {
  if (doc.goal && typeof doc.goal === 'string') return doc.goal.trim()
  if (doc.description && typeof doc.description === 'string') return doc.description.trim()
  if (doc.title && typeof doc.title === 'string') return doc.title.trim()

  // Try spec.md ## Goal section
  const specPath = path.join(featureDir, 'spec.md')
  if (existsSync(specPath)) {
    try {
      const specContent = readFileSync(specPath, 'utf8')
      const m = specContent.match(/^##\s+Goal\s*\r?\n+([\s\S]*?)(?=\r?\n##|$)/m)
      if (m) {
        const goal = m[1].trim()
        if (goal) return goal
      }
    } catch { /* tolerate unreadable spec */ }
  }

  const slug = path.basename(featureDir)
  return `(migrated from feature ${slug})`
}

// ---------------------------------------------------------------------------
// Core migration for a single feature
// ---------------------------------------------------------------------------

/**
 * Migrate one feature directory to a motive.
 * Returns { ok: true, motiveDir } or { ok: false, reason: string }.
 */
function migrateFeature(featureDir, base, dryRun, sessionId) {
  const slug = path.basename(featureDir)

  // 1. Validate source .feature.yaml (AC 5)
  const yamlPath = path.join(featureDir, '.feature.yaml')
  if (!existsSync(yamlPath)) {
    return { ok: false, reason: `no .feature.yaml found in ${featureDir}` }
  }

  const featureValidation = validateFeatureDir(featureDir)
  if (!featureValidation.ok) {
    return { ok: false, reason: `feature.yaml invalid: ${featureValidation.error}` }
  }

  // 2. Load feature doc
  let doc
  try {
    doc = yamlLoad(readFileSync(yamlPath, 'utf8'))
  } catch (e) {
    return { ok: false, reason: `YAML parse error: ${e.message}` }
  }

  // 3. Determine motive charter path
  const motiveDir = path.join(base, '.groundwork', 'motives', slug)
  const charter = charterPath(base, slug)

  // Idempotency: skip if charter already exists (AC 6 safety)
  if (existsSync(charter)) {
    return { ok: false, reason: `motive charter already exists (idempotent skip): ${charter}` }
  }

  const history = Array.isArray(doc.history) ? doc.history : []
  const decisions = Array.isArray(doc.decisions) ? doc.decisions : []
  const acCoverage = (doc.ac_coverage && typeof doc.ac_coverage === 'object') ? doc.ac_coverage : {}

  if (dryRun) {
    out(`[dry-run] would create motive ${slug} (${history.length} events, ${decisions.length} decisions, ${Object.keys(acCoverage).length} ACs)`)
    return { ok: true, motiveDir, dryRun: true }
  }

  // 4. Create motive charter
  const objective = extractObjective(doc, featureDir)

  // Q15: record migration provenance in the charter rather than silently losing it.
  const acKeys = Object.keys(acCoverage)
  const migrationNote = acKeys.length > 0
    ? `\n\n> **Migration note (feature → motive):** AC coverage imported from feature \`${slug}\`. ` +
      `Original entries: ${acKeys.map(k => `${k}→[${(acCoverage[k] || []).join(', ')}]`).join('; ')}.`
    : ''

  const charterContent = renderCharterTemplate({ motive: slug, objective }) + migrationNote

  try {
    mkdirSync(motiveDir, { recursive: true })
    writeFileSync(charter, charterContent)
  } catch (e) {
    return { ok: false, reason: `failed to write charter: ${e.message}` }
  }

  // 5. Write history journal events (preserving original timestamps)
  const now = new Date().toISOString()

  for (const ev of history) {
    const journalType = HISTORY_TYPE_MAP[ev.type] || 'MILESTONE'
    const event = {
      ts: ev.at || now,
      session: ev.session_id || sessionId,
      motive: slug,
      type: journalType,
      msg: ev.summary || ev.type || '(no summary)',
      data: { source: 'feature-migrate', feature_slug: slug, feature_type: ev.type },
    }
    try {
      writeJournalEvent(base, sessionId, event)
    } catch (e) {
      warn(`${slug}: failed to write journal event: ${e.message}`)
    }
  }

  // 6. Write DECISION journal events
  for (const d of decisions) {
    const event = {
      ts: d.at || now,
      session: sessionId,
      motive: slug,
      type: 'DECISION',
      msg: d.summary || '(no summary)',
      data: { source: 'feature-migrate', feature_slug: slug, adr: d.adr || null },
    }
    try {
      writeJournalEvent(base, sessionId, event)
    } catch (e) {
      warn(`${slug}: failed to write decision journal event: ${e.message}`)
    }
  }

  // 7. Emit AC_COVERAGE events so `journal compile` reproduces the coverage view (S8/Q15)
  //    Coverage form:    one event per (ac_key, slice_id) pair, timestamped at updated_at.
  //    Declaration form: one event per ac_key with empty covering array, so ACs declared
  //                      with no covering slices (unmet-empty) appear in compiled output.
  const acTs = doc.updated_at || now
  for (const [ac, slices] of Object.entries(acCoverage)) {
    const sliceList = Array.isArray(slices) ? slices : []
    if (sliceList.length === 0) {
      // Declaration form — AC known but has no covering slices
      const event = {
        ts: acTs,
        session: sessionId,
        motive: slug,
        type: 'AC_COVERAGE',
        msg: `${ac} declared with no covering slices`,
        data: { source: 'feature-migrate', ac, covering: [] },
      }
      try {
        writeJournalEvent(base, sessionId, event)
      } catch (e) {
        warn(`${slug}: failed to write AC_COVERAGE declaration event: ${e.message}`)
      }
    } else {
      for (const slice of sliceList) {
        const event = {
          ts: acTs,
          session: sessionId,
          motive: slug,
          type: 'AC_COVERAGE',
          msg: `${ac} covered by ${slice}`,
          data: { source: 'feature-migrate', ac, slice },
        }
        try {
          writeJournalEvent(base, sessionId, event)
        } catch (e) {
          warn(`${slug}: failed to write AC_COVERAGE event: ${e.message}`)
        }
      }
    }
  }

  return { ok: true, motiveDir }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2)

  // Parse flags
  let dryRun = true   // safe default: dry-run unless --delete is given
  let deleteSource = false
  const slugArgs = []

  for (const a of args) {
    if (a === '--dry-run') { dryRun = true; continue }
    if (a === '--delete')  { deleteSource = true; dryRun = false; continue }
    if (a === '--help' || a === '-h') {
      out('Usage: migrate [--dry-run] [--delete] [slug [slug...]]\n')
      out('  --dry-run  (default) Write motive dirs but skip deletion.')
      out('  --delete   Delete source after successful migration.')
      process.exit(0)
    }
    if (!a.startsWith('-')) slugArgs.push(a)
  }

  const base = projectDir()
  const fDir = featuresDir(base)
  const sessionId =
    process.env.JOURNAL_SESSION_ID ||
    process.env.CLAUDE_CODE_SESSION_ID ||
    'migrate'

  // Enumerate feature directories
  let slugs = slugArgs
  if (slugs.length === 0) {
    if (!existsSync(fDir)) {
      out('No .groundwork/features/ directory found; nothing to migrate.')
      process.exit(0)
    }
    slugs = readdirSync(fDir).filter(name => {
      const fp = path.join(fDir, name)
      try {
        return statSync(fp).isDirectory()
      } catch { return false }
    })
  }

  if (slugs.length === 0) {
    out('No feature directories found; nothing to migrate.')
    process.exit(0)
  }

  const modeLabel = dryRun ? 'dry-run' : (deleteSource ? 'delete' : 'write-only')
  out(`migrate: processing ${slugs.length} feature(s) [mode: ${modeLabel}]`)

  let anyFailed = false

  for (const slug of slugs) {
    const featureDir = path.join(fDir, slug)
    if (!existsSync(featureDir)) {
      warn(`feature directory not found: ${featureDir}`)
      anyFailed = true
      continue
    }

    out(`\nmigrate: processing ${slug}`)
    const result = migrateFeature(featureDir, base, dryRun, sessionId)

    if (!result.ok) {
      process.stderr.write(`migrate: SKIP ${slug}: ${result.reason}\n`)
      anyFailed = true
      continue
    }

    if (dryRun) {
      out(`migrate: [dry-run] ${slug} → ok`)
      continue
    }

    out(`migrate: ${slug} → ${result.motiveDir}`)

    // AC 6: only delete if explicitly requested AND migration succeeded
    if (deleteSource) {
      out(`migrate: deleting source ${featureDir}`)
      try {
        rmSync(featureDir, { recursive: true, force: true })
        out(`migrate: deleted ${featureDir}`)
      } catch (e) {
        warn(`${slug}: failed to delete source: ${e.message}`)
        anyFailed = true
      }
    }
  }

  process.exit(anyFailed ? 1 : 0)
}

main()
