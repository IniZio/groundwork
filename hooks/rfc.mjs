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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { stringify } from 'yaml'
import {
  generateUid,
  parseFrontmatter,
  serializeFrontmatter,
  computeBodyDigest,
  nextOrdinal,
  findRfcByUid,
  readJournalEntries,
  findLedgersForRfc,
} from './lib/rfc-io.mjs'

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

const ALL_STATUSES = new Set(Object.keys(TRANSITIONS))

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

function validateFrontmatter(fm) {
  const errors = []

  const required = [
    'schema', 'uid', 'ordinal', 'slug', 'title', 'status', 'classification',
    'created', 'updated', 'accepted_at', 'accepted_by', 'supersedes',
    'superseded_by', 'body_digest', 'spec_delta', 'tasks',
  ]
  for (const f of required) {
    if (!(f in fm)) errors.push(`missing required field: ${f}`)
  }

  if (fm.schema !== 1) errors.push(`schema: must be 1 (got ${JSON.stringify(fm.schema)})`)

  if (typeof fm.uid === 'string' && !/^R-\d{8}-[A-Z0-9]{6}$/.test(fm.uid)) {
    errors.push(`uid: does not match ^R-\\d{8}-[A-Z0-9]{6}$ (got "${fm.uid}")`)
  }

  if (!ALL_STATUSES.has(fm.status)) {
    errors.push(`status: invalid "${fm.status}" — must be one of: ${[...ALL_STATUSES].join(', ')}`)
  }

  if (!['spec_change', 'tactical'].includes(fm.classification)) {
    errors.push(`classification: must be spec_change or tactical (got "${fm.classification}")`)
  }

  if (fm.accepted_by !== null && fm.accepted_by !== undefined &&
      !['human', 'advisor'].includes(fm.accepted_by)) {
    errors.push(`accepted_by: must be "human", "advisor", or null`)
  }

  if (fm.classification === 'spec_change' && fm.accepted_by === 'advisor') {
    errors.push('accepted_by: must be "human" when classification is spec_change')
  }

  if (!Array.isArray(fm.supersedes)) {
    errors.push('supersedes: must be an array')
  } else {
    for (const u of fm.supersedes) {
      if (typeof u !== 'string' || !/^R-\d{8}-[A-Z0-9]{6}$/.test(u)) {
        errors.push(`supersedes: "${u}" is not a valid RFC uid`)
      }
    }
  }

  if (!Array.isArray(fm.spec_delta)) {
    errors.push('spec_delta: must be an array')
  } else {
    for (const op of fm.spec_delta) {
      if (!['add', 'modify', 'supersede', 'remove'].includes(op.op)) {
        errors.push(`spec_delta: op must be add|modify|supersede|remove (got "${op.op}")`)
      }
      if (!op.target) errors.push('spec_delta: each op must have a non-empty target')
    }
  }

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

  return errors
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdNew(args) {
  const { flags, positionals } = parseFlags(args)
  const slug = positionals[0]
  if (!slug) die('usage: rfc new <slug> [--supersedes <uid>]', 2)

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
    const targetDir = findRfcByUid(dir, targetUid)
    if (!targetDir) die(`--supersedes: RFC with uid "${targetUid}" not found`)
    supersededDirs.push({ uid: targetUid, dir: targetDir })
  }

  const ordinal = nextOrdinal(dir)
  const uid = generateUid()
  const now = new Date().toISOString()
  const rfcDir = path.join(dir, String(ordinal).padStart(4, '0') + '-' + slug)

  if (existsSync(rfcDir)) die(`RFC directory already exists: ${rfcDir}`)

  const frontmatter = {
    schema: 1,
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
    tasks: [],
  }

  // Create directory structure (AC 1)
  mkdirSync(rfcDir, { recursive: true })
  mkdirSync(path.join(rfcDir, 'notes'), { recursive: true })
  mkdirSync(path.join(rfcDir, 'reviews'), { recursive: true })

  // Serialize frontmatter using yaml with lineWidth 0 (AC 5)
  const fmYaml = stringify(frontmatter, { lineWidth: 0 })
  const body = `\n## 1. Summary\n\nTODO\n\n## 2. Motivation\n\nTODO\n\n## 3. Design\n\nTODO\n\n## 4. Alternatives\n\nTODO\n\n## 5. Security\n\nTODO\n\n## 6. Observability\n\nTODO\n\n## 7. Migration\n\nTODO\n\n## 8. Open Questions\n\nTODO\n\n## 9. Appendix\n\n## 12. Resolution\n\n`
  writeFileSync(path.join(rfcDir, 'rfc.md'), `---\n${fmYaml}---\n${body}`)

  // AC 7: atomically set superseded_by on each target
  for (const { uid: targetUid, dir: targetDir } of supersededDirs) {
    const targetMd = path.join(targetDir, 'rfc.md')
    const content = readFileSync(targetMd, 'utf8')
    const { doc, body: targetBody } = parseFrontmatter(content)
    doc.set('superseded_by', uid)
    doc.set('updated', now)
    writeFileSync(targetMd, serializeFrontmatter(doc, targetBody))
    out(`  superseded_by on ${targetUid} → ${uid}`)
  }

  out(`Created ${rfcDir}`)
  out(`  uid: ${uid}`)
  out(`  ordinal: ${ordinal}`)
}

function cmdValidate(args) {
  const { positionals } = parseFlags(args)
  const rfcPath = positionals[0]
  if (!rfcPath) die('usage: rfc validate <dir>', 2)

  const rfcMd = path.join(rfcPath, 'rfc.md')
  if (!existsSync(rfcMd)) die(`rfc.md not found: ${rfcMd}`)

  const content = readFileSync(rfcMd, 'utf8')

  // AC 3: report line/col on YAML parse error
  let parsed
  try {
    parsed = parseFrontmatter(content)
  } catch (e) {
    if (e.line != null) {
      process.stderr.write(`rfc: YAML parse error at line ${e.line}, column ${e.col}: ${e.message}\n`)
    } else {
      process.stderr.write(`rfc: ${e.message}\n`)
    }
    process.exit(1)
  }

  const { frontmatter, body } = parsed
  const errors = validateFrontmatter(frontmatter)

  // AC 6: body_digest integrity check for review+ statuses
  const frozenStatuses = new Set(['review', 'accepted', 'implementing', 'implemented', 'rejected', 'superseded', 'abandoned'])
  if (frozenStatuses.has(frontmatter.status) && frontmatter.body_digest != null) {
    const current = computeBodyDigest(frontmatter, body)
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

  const rfcMd = path.join(rfcPath, 'rfc.md')
  if (!existsSync(rfcMd)) die(`rfc.md not found: ${rfcMd}`)

  const content = readFileSync(rfcMd, 'utf8')
  let parsed
  try {
    parsed = parseFrontmatter(content)
  } catch (e) {
    die(`YAML parse error: ${e.message}`)
  }

  const { frontmatter, doc, body } = parsed
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

  // Stamp body_digest when first entering review (draft → review)
  if (newStatus === 'review' && currentStatus === 'draft') {
    const digest = computeBodyDigest(doc.toJS(), body)
    doc.set('body_digest', digest)
  }

  if (newStatus === 'accepted' && !doc.get('accepted_at')) {
    doc.set('accepted_at', now)
  }

  // AC 4: body (everything after closing fence) is passed through UNCHANGED
  writeFileSync(rfcMd, serializeFrontmatter(doc, body))
  out(`${currentStatus} → ${newStatus}`)
}

function cmdStatus(args) {
  const { positionals } = parseFlags(args)
  const rfcPath = positionals[0]
  if (!rfcPath) die('usage: rfc status <dir>', 2)

  const rfcMd = path.join(rfcPath, 'rfc.md')
  if (!existsSync(rfcMd)) die(`rfc.md not found: ${rfcMd}`)

  const content = readFileSync(rfcMd, 'utf8')
  let parsed
  try {
    parsed = parseFrontmatter(content)
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

  // AC 9: program counter — tasks from frontmatter (plan, not progress)
  const tasks = Array.isArray(frontmatter.tasks) ? frontmatter.tasks : []
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
// Help
// ---------------------------------------------------------------------------

const HELP_TEXT = `rfc — Groundwork RFC management CLI

Usage:
  rfc new <slug> [--supersedes <uid> ...]   Create a new RFC
  rfc validate <dir>                         Validate rfc.md frontmatter
  rfc set-status <dir> <status>              Transition RFC status
  rfc status <dir>                           Print RFC status and run ledger state

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

const commands = { new: cmdNew, validate: cmdValidate, 'set-status': cmdSetStatus, status: cmdStatus }

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
