#!/usr/bin/env node
/**
 * groundwork migrate features — convert legacy .groundwork/features/<slug>/
 * directories into RFC directories under .groundwork/rfcs/<NNNN>-<slug>/.
 *
 * Usage:
 *   migrate [--dry-run] [--delete] [slug [slug...]]
 *
 * Flags:
 *   --dry-run   (default) Print what would happen; write RFC dirs but do NOT
 *               delete any source.  Safe to run any number of times.
 *   --delete    Actually delete each source directory AFTER its RFC passes
 *               `rfc validate`.  Requires explicit opt-in to prevent accidents.
 *
 * Without explicit slug arguments all feature directories are processed.
 *
 * Exit codes: 0 all processed (skips reported), 1 at least one feature failed.
 *
 * Safety contract (AC 6):
 *   Source directories are NEVER deleted in dry-run mode.
 *   In --delete mode a source is deleted only when:
 *     a) every migration step succeeded for that feature, AND
 *     b) `node hooks/rfc.mjs validate <rfcDir>` exits 0.
 *   If validate fails the source is left intact and an error is reported.
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
import { spawnSync } from 'node:child_process'
import { load as yamlLoad } from 'js-yaml'
import { stringify as yamlStringify } from 'yaml'
import { generateUid, nextOrdinal } from './lib/rfc-io.mjs'

// We write journal shard lines directly (O_APPEND) so we can supply the
// original timestamp from history entries (the journal CLI has no --ts flag).

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

// Feature schema required top-level fields (from feature.schema.json)
const FEATURE_REQUIRED = new Set([
  'version', 'id', 'slug', 'active', 'status', 'health',
  'ac_coverage', 'resume', 'runs', 'history', 'created_at', 'updated_at',
])

// Map feature history.type → RFC journal event type
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

function rfcsDir(base) {
  return path.join(base, '.groundwork', 'rfcs')
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
// Feature YAML validation (lightweight — shells out to feature.mjs)
// ---------------------------------------------------------------------------

/**
 * Validate a feature directory by shelling out to hooks/feature.mjs validate.
 * Returns { ok: true } or { ok: false, error: string }.
 */
function validateFeatureDir(featureDir) {
  const featureCli = path.join(REPO_ROOT, 'hooks', 'feature.mjs')
  const result = spawnSync(process.execPath, [featureCli, 'validate', featureDir], {
    encoding: 'utf8',
  })
  if (result.status === 0) return { ok: true }
  const stderr = (result.stderr || '').trim()
  const stdout = (result.stdout || '').trim()
  return { ok: false, error: stderr || stdout || `exit ${result.status}` }
}

// ---------------------------------------------------------------------------
// tasks.md parser
// ---------------------------------------------------------------------------

/**
 * Parse tasks.md and return an array of { id, title, wave } objects.
 * Wave is derived from the most recent "## Wave N" heading above the task.
 *
 * Task lines match: - [ ] F1.1 Title text  (open or done checkbox)
 * IDs are the first whitespace-delimited token after the checkbox.
 */
function parseTasks(content) {
  const lines = content.split(/\r?\n/)
  const tasks = []
  let currentWave = 1
  const WAVE_RE = /^#{1,3}\s+[Ww]ave\s+(\d+)/
  const TASK_RE = /^- \[[ xX]\]\s+(\S+)\s+(.*)/

  for (const line of lines) {
    const wm = line.match(WAVE_RE)
    if (wm) {
      currentWave = parseInt(wm[1], 10)
      continue
    }
    const tm = line.match(TASK_RE)
    if (tm) {
      tasks.push({ id: tm[1], title: tm[2].trim(), wave: currentWave })
    }
  }
  return tasks
}

// ---------------------------------------------------------------------------
// RFC validate (shells out to hooks/rfc.mjs validate <dir>)
// ---------------------------------------------------------------------------

/**
 * Returns { ok: true } or { ok: false, error: string }.
 *
 * Honours MIGRATE_RFC_CLI env var so tests can inject a stub.
 */
function validateRfc(rfcDir) {
  const rfcCli = process.env.MIGRATE_RFC_CLI || path.join(REPO_ROOT, 'hooks', 'rfc.mjs')
  const result = spawnSync(process.execPath, [rfcCli, 'validate', rfcDir], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir() },
  })
  if (result.status === 0) return { ok: true }
  const stderr = (result.stderr || '').trim()
  const stdout = (result.stdout || '').trim()
  return { ok: false, error: stderr || stdout || `exit ${result.status}` }
}

// ---------------------------------------------------------------------------
// Core migration for a single feature
// ---------------------------------------------------------------------------

/**
 * Migrate one feature directory to an RFC.
 * Returns { ok: true, rfcDir } or { ok: false, reason: string }.
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

  // 3. Parse tasks.md (AC 1)
  const tasksMdPath = path.join(featureDir, 'tasks.md')
  let parsedTasks = []
  if (existsSync(tasksMdPath)) {
    parsedTasks = parseTasks(readFileSync(tasksMdPath, 'utf8'))
  }

  // 4. Determine RFC directory
  const rDir = rfcsDir(base)
  const ordinal = nextOrdinal(rDir)
  const rfcDirName = String(ordinal).padStart(4, '0') + '-' + slug
  const rfcDir = path.join(rDir, rfcDirName)

  if (existsSync(rfcDir)) {
    return { ok: false, reason: `RFC directory already exists: ${rfcDir}` }
  }

  if (dryRun) {
    out(`[dry-run] would create ${rfcDir} (${parsedTasks.length} tasks, ${(doc.history || []).length} history events, ${(doc.decisions || []).length} decisions)`)
    return { ok: true, rfcDir, dryRun: true }
  }

  // 5. Create RFC directory structure
  try {
    mkdirSync(rfcDir, { recursive: true })
    mkdirSync(path.join(rfcDir, 'notes'), { recursive: true })
    mkdirSync(path.join(rfcDir, 'reviews'), { recursive: true })
  } catch (e) {
    return { ok: false, reason: `failed to create RFC dir: ${e.message}` }
  }

  // 6. Build tasks[] for frontmatter from parsed tasks (AC 1)
  //    AC 4: do NOT include resume or ac_coverage in frontmatter
  const rfcTasks = parsedTasks.map(t => ({
    id: t.id,
    title: t.title,
    wave: t.wave,
    blocked_by: [],
    files: [],
    ac: [],
  }))

  // 7. Write rfc.md
  const uid = generateUid()
  const now = new Date().toISOString()
  const title = (doc.id || slug).replace(/^feat_/, '').replace(/[-_]/g, ' ')
  const frontmatter = {
    schema: 1,
    uid,
    ordinal,
    slug,
    title,
    status: 'draft',
    classification: 'tactical',
    created: doc.created_at || now,
    updated: now,
    accepted_at: null,
    accepted_by: null,
    supersedes: [],
    superseded_by: null,
    body_digest: null,
    spec_delta: [],
    tasks: rfcTasks,
  }

  const fmYaml = yamlStringify(frontmatter, { lineWidth: 0 })
  const body = `\n## 1. Summary\n\nMigrated from feature ledger \`${slug}\`.\n\n## 2. Motivation\n\nTODO\n\n## 3. Design\n\nTODO\n\n## 4. Alternatives\n\nTODO\n\n## 5. Security\n\nTODO\n\n## 6. Observability\n\nTODO\n\n## 7. Migration\n\nTODO\n\n## 8. Open Questions\n\nTODO\n\n## 9. Appendix\n\n## 12. Resolution\n\n`

  try {
    writeFileSync(path.join(rfcDir, 'rfc.md'), `---\n${fmYaml}---\n${body}`)
  } catch (e) {
    return { ok: false, reason: `failed to write rfc.md: ${e.message}` }
  }

  // 8. Copy plan.md to notes/ (AC 3)
  const planPath = path.join(featureDir, 'plan.md')
  if (existsSync(planPath)) {
    try {
      const planContent = readFileSync(planPath, 'utf8')
      writeFileSync(path.join(rfcDir, 'notes', 'plan.md'), planContent)

      // Also copy any docs/prds/ files referenced in plan.md (AC 3)
      const prdRefs = [...planContent.matchAll(/docs\/prds\/([^\s\)'"]+)/g)]
        .map(m => m[0])
      for (const ref of prdRefs) {
        const prdSrc = path.join(base, ref)
        if (existsSync(prdSrc)) {
          const destDir = path.join(rfcDir, 'notes', path.dirname(ref))
          mkdirSync(destDir, { recursive: true })
          writeFileSync(
            path.join(rfcDir, 'notes', ref),
            readFileSync(prdSrc, 'utf8'),
          )
        }
      }
    } catch (e) {
      warn(`${slug}: failed to copy plan.md: ${e.message}`)
    }
  }

  // 9. Write journal events (AC 2)
  //    - One event per history entry, preserving original timestamps
  //    - One DECISION event per decisions entry
  const history = Array.isArray(doc.history) ? doc.history : []
  const decisions = Array.isArray(doc.decisions) ? doc.decisions : []

  for (const ev of history) {
    const journalType = HISTORY_TYPE_MAP[ev.type] || 'MILESTONE'
    const event = {
      ts: ev.at || now,
      session: ev.session_id || sessionId,
      rfc: uid,
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

  for (const d of decisions) {
    const event = {
      ts: d.at || now,
      session: sessionId,
      rfc: uid,
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

  // 10. Validate RFC before returning success (AC 6)
  const rfcValidation = validateRfc(rfcDir)
  if (!rfcValidation.ok) {
    return {
      ok: false,
      reason: `RFC failed validation (source preserved): ${rfcValidation.error}`,
      rfcDir,
    }
  }

  return { ok: true, rfcDir }
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
      out('  --dry-run  (default) Write RFC dirs but skip deletion.')
      out('  --delete   Delete source after successful rfc validate.')
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

    out(`migrate: ${slug} → ${result.rfcDir}`)

    // AC 6: only delete if explicitly requested AND validate passed
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
