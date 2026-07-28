#!/usr/bin/env node
/**
 * RFC Review sidecar — library + CLI
 *
 * Exported for use by rfc.mjs:
 *   checkReviewGate(rfcDir)  — AC T12.4 gate called by `rfc set-status accepted`
 *   cmdReviewGenerate, cmdReviewAdd, cmdReviewResolve, cmdReviewParseCriticmarkup
 *     — dispatched by rfc.mjs `cmdReview()`
 *
 * When invoked directly as a script, provides the same subcommands:
 *   rfc-review.mjs generate <dir> --reviewer <name>
 *   rfc-review.mjs add      <dir> --reviewer <name> --text <t> [--severity ...] [--anchor-type ...] [--anchor-ref ...]
 *   rfc-review.mjs resolve  <dir> --id <RC-NNN> [--wont-fix]
 *   rfc-review.mjs parse-criticmarkup <file> [--rfc-dir <dir>] [--reviewer <name>]
 *
 * AC T12.6 NEGATIVE REQUIREMENT: there is NO export/render/publish/bundle subcommand here.
 *
 * Exit codes: 0 success, 1 operational failure, 2 usage error.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function die(msg, code = 1) {
  process.stderr.write(`rfc review: ${msg}\n`)
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
    if (a.startsWith('--')) {
      flags[a.slice(2)] = args[i + 1]
      i++
    } else {
      positionals.push(a)
    }
  }
  return { flags, positionals }
}

// ---------------------------------------------------------------------------
// Review file I/O
// ---------------------------------------------------------------------------

function reviewsDir(rfcDir) {
  return path.join(rfcDir, 'reviews')
}

function listReviewFiles(rfcDir) {
  const dir = reviewsDir(rfcDir)
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir).filter(f => f.endsWith('.comments.json'))
  } catch {
    return []
  }
}

function readReviewFile(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

/**
 * Find the highest RC-NNN sequence number across ALL review files in this RFC's reviews/ dir.
 * Monotonic across the whole RFC (not per-file) so IDs are unambiguous when listing
 * offending comment IDs from multiple reviewer files in AC T12.4.
 */
function maxCommentSeq(rfcDir) {
  let max = 0
  for (const fname of listReviewFiles(rfcDir)) {
    let obj
    try {
      obj = readReviewFile(path.join(reviewsDir(rfcDir), fname))
    } catch {
      continue
    }
    if (!Array.isArray(obj.comments)) continue
    for (const c of obj.comments) {
      const m = typeof c.id === 'string' ? c.id.match(/^RC-(\d+)$/) : null
      if (m) max = Math.max(max, parseInt(m[1], 10))
    }
  }
  return max
}

function formatId(n) {
  return `RC-${String(n).padStart(3, '0')}`
}

/**
 * Simple frontmatter extraction without importing rfc-io.mjs
 * (to stay self-contained and avoid circular concerns).
 * Returns a plain object of key→string-value pairs.
 */
function readRfcFrontmatter(rfcDir) {
  const rfcYaml = path.join(rfcDir, 'rfc.yaml')
  if (existsSync(rfcYaml)) {
    return parseYaml(readFileSync(rfcYaml, 'utf8'))
  }
  const rfcMd = path.join(rfcDir, 'rfc.md')
  if (!existsSync(rfcMd)) return null
  const content = readFileSync(rfcMd, 'utf8')
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return null
  const fm = {}
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^(\w[\w_]*):\s*(.*)$/)
    if (kv) fm[kv[1]] = kv[2].trim()
  }
  return fm
}

function fmBodyDigest(fm) {
  if (!fm) return null
  const raw = fm.body_digest
  if (!raw || raw === 'null') return null
  return raw
}

// ---------------------------------------------------------------------------
// AC T12.4: Review gate (exported for rfc.mjs set-status accepted)
// ---------------------------------------------------------------------------

/**
 * Check whether all reviews in rfcDir/reviews/ permit acceptance.
 *
 * Fail-closed policy:
 *   - A malformed (unparseable) comments file is treated as a blocking issue.
 *   - overall_verdict must be "approved" in every file.
 *   - No blocking-severity comment may have status other than "resolved" or "wont-fix".
 *
 * Returns { ok: boolean, offending: string[], malformed: string[] }
 * offending lists the specific comment IDs or filenames that block acceptance.
 */
export function checkReviewGate(rfcDir) {
  const files = listReviewFiles(rfcDir)
  const offending = []
  const malformed = []

  for (const fname of files) {
    const filePath = path.join(reviewsDir(rfcDir), fname)
    let obj
    try {
      obj = readReviewFile(filePath)
    } catch (e) {
      malformed.push(`${fname}: ${e.message}`)
      continue
    }

    // overall_verdict must be approved
    if (obj.overall_verdict !== 'approved') {
      offending.push(`${fname}: overall_verdict="${obj.overall_verdict}"`)
    }

    // Any blocking comment not yet resolved or wont-fix
    if (Array.isArray(obj.comments)) {
      for (const c of obj.comments) {
        if (
          c.severity === 'blocking' &&
          c.status !== 'resolved' &&
          c.status !== 'wont-fix'
        ) {
          offending.push(`${c.id} (${fname}): severity=blocking status=${c.status}`)
        }
      }
    }
  }

  return { ok: offending.length === 0 && malformed.length === 0, offending, malformed }
}

// ---------------------------------------------------------------------------
// AC T12.1: generate
// ---------------------------------------------------------------------------

export function cmdReviewGenerate(args) {
  const { flags, positionals } = parseFlags(args)
  const rfcDir = positionals[0]
  if (!rfcDir) die('usage: rfc review generate <dir> --reviewer <name>', 2)
  const reviewer = flags.reviewer
  if (!reviewer) die('--reviewer <name> is required', 2)

  if (!existsSync(path.join(rfcDir, 'rfc.md'))) {
    die(`rfc.md not found in: ${rfcDir}`)
  }

  const fm = readRfcFrontmatter(rfcDir)
  if (!fm) die('Failed to read RFC frontmatter')

  const rfcUid = fm.uid ?? '(unknown)'
  const bodyDigest = fmBodyDigest(fm)

  if (bodyDigest === null) {
    process.stderr.write(
      `rfc review: warning: RFC body_digest is null (RFC is likely still in "draft" status); ` +
      `rfc_digest in the generated file will be null. ` +
      `Promote to "review" first to stamp a non-null digest.\n`
    )
  }

  const date = new Date().toISOString().slice(0, 10)
  const filename = `${date}-${reviewer}.comments.json`
  const revDir = reviewsDir(rfcDir)
  mkdirSync(revDir, { recursive: true })
  const filePath = path.join(revDir, filename)

  if (existsSync(filePath)) die(`Review file already exists: ${filePath}`)

  const now = new Date().toISOString()
  const review = {
    schema: 1,
    rfc_uid: rfcUid,
    rfc_digest: bodyDigest,
    reviewer,
    created: now,
    updated: now,
    overall_verdict: 'needs-changes',
    comments: [],
  }

  writeFileSync(filePath, JSON.stringify(review, null, 2) + '\n')
  out(`Created ${filePath}`)
}

// ---------------------------------------------------------------------------
// AC T12.2: add — assigns monotonic RC-NNN
// ---------------------------------------------------------------------------

/**
 * Find the most recently created comments file for `reviewer` in rfcDir/reviews/.
 */
function findReviewFileForReviewer(rfcDir, reviewer) {
  const suffix = `-${reviewer}.comments.json`
  const candidates = listReviewFiles(rfcDir)
    .filter(f => f.endsWith(suffix))
    .sort((a, b) => b.localeCompare(a)) // descending → most recent first
  if (candidates.length === 0) return null
  return path.join(reviewsDir(rfcDir), candidates[0])
}

export function cmdReviewAdd(args) {
  const { flags, positionals } = parseFlags(args)
  const rfcDir = positionals[0]
  if (!rfcDir) die('usage: rfc review add <dir> --reviewer <name> --text <text>', 2)
  const reviewer = flags.reviewer
  if (!reviewer) die('--reviewer <name> is required', 2)
  const text = flags.text
  if (!text) die('--text <text> is required', 2)

  const severity = flags.severity ?? 'non-blocking'
  if (!['blocking', 'non-blocking', 'nit'].includes(severity)) {
    die(`--severity must be blocking, non-blocking, or nit (got "${severity}")`, 2)
  }
  const anchorType = flags['anchor-type'] ?? 'global'
  if (!['requirement', 'task', 'section', 'global', 'quote'].includes(anchorType)) {
    die(`--anchor-type must be requirement, task, section, global, or quote (got "${anchorType}")`, 2)
  }
  const anchorRef = flags['anchor-ref']

  const filePath = findReviewFileForReviewer(rfcDir, reviewer)
  if (!filePath) {
    die(`No review file found for reviewer "${reviewer}". Run "rfc review generate" first.`)
  }

  let obj
  try {
    obj = readReviewFile(filePath)
  } catch (e) {
    die(`Failed to read review file: ${e.message}`)
  }

  // Assign monotonic ID across ALL review files in reviews/
  const seq = maxCommentSeq(rfcDir) + 1
  const id = formatId(seq)

  const anchor = { type: anchorType }
  if (anchorRef) anchor.ref = anchorRef

  obj.comments.push({ id, severity, status: 'open', anchor, text })
  obj.updated = new Date().toISOString()

  writeFileSync(filePath, JSON.stringify(obj, null, 2) + '\n')
  out(`Added ${id}`)
}

// ---------------------------------------------------------------------------
// resolve — sets status to resolved or wont-fix; AC T12.3 digest warning
// ---------------------------------------------------------------------------

export function cmdReviewResolve(args) {
  const { flags, positionals } = parseFlags(args)
  const rfcDir = positionals[0]
  if (!rfcDir) die('usage: rfc review resolve <dir> --id <RC-NNN>', 2)
  const id = flags.id
  if (!id) die('--id <RC-NNN> is required', 2)
  const wontFix = Object.prototype.hasOwnProperty.call(flags, 'wont-fix')

  // Search all review files for the comment id
  const revDir = reviewsDir(rfcDir)
  let foundFile = null
  let foundObj = null
  for (const f of listReviewFiles(rfcDir)) {
    let obj
    try { obj = readReviewFile(path.join(revDir, f)) } catch { continue }
    if (Array.isArray(obj.comments) && obj.comments.some(c => c.id === id)) {
      foundFile = f
      foundObj = obj
      break
    }
  }

  if (!foundFile) die(`Comment ${id} not found in any review file in ${revDir}`)

  // AC T12.3: warn if rfc_digest doesn't match current body_digest
  const fm = readRfcFrontmatter(rfcDir)
  const currentDigest = fmBodyDigest(fm)
  if (
    foundObj.rfc_digest != null &&
    currentDigest != null &&
    foundObj.rfc_digest !== currentDigest
  ) {
    process.stderr.write(
      `rfc review: warning: comments in ${foundFile} were written against older RFC text\n` +
      `  comment file rfc_digest: ${foundObj.rfc_digest}\n` +
      `  current body_digest:     ${currentDigest}\n`
    )
  }

  const comment = foundObj.comments.find(c => c.id === id)
  comment.status = wontFix ? 'wont-fix' : 'resolved'
  foundObj.updated = new Date().toISOString()

  writeFileSync(path.join(revDir, foundFile), JSON.stringify(foundObj, null, 2) + '\n')
  out(`${id} → ${comment.status}`)
}

// ---------------------------------------------------------------------------
// AC T12.5: parse-criticmarkup
// ---------------------------------------------------------------------------

export function cmdReviewParseCriticmarkup(args) {
  const { flags, positionals } = parseFlags(args)
  const inputFile = positionals[0]
  if (!inputFile) {
    die('usage: rfc review parse-criticmarkup <file> [--rfc-dir <dir>] [--reviewer <name>]', 2)
  }
  const reviewer = flags.reviewer ?? 'unknown'
  // Default rfc-dir to the directory containing the file
  const rfcDir = flags['rfc-dir'] ?? path.dirname(path.resolve(inputFile))

  if (!existsSync(inputFile)) die(`File not found: ${inputFile}`)

  const content = readFileSync(inputFile, 'utf8')

  // Parse {>> comment text <<} marks.
  // Capture up to 100 chars of preceding (non-whitespace-only) text as the quote.
  // That preceding text is what `anchor.type = "quote"` captures, giving the reader
  // context about which part of the document the comment refers to.
  // 100 chars is enough for a sentence fragment without being excessively large.
  const COMMENT_RE = /\{>>([\s\S]*?)<<\}/g
  const comments = []
  let seq = maxCommentSeq(rfcDir)
  let match

  while ((match = COMMENT_RE.exec(content)) !== null) {
    const commentText = match[1].trim()
    const startOffset = match.index
    // Capture the 100 chars immediately before the comment mark, trimmed
    const preceding = content.slice(Math.max(0, startOffset - 100), startOffset)
    const quote = preceding.replace(/\s+/g, ' ').trim()

    seq++
    const id = formatId(seq)
    const anchor = { type: 'quote' }
    if (quote) anchor.quote = quote

    comments.push({ id, severity: 'non-blocking', status: 'open', anchor, text: commentText })
  }

  if (comments.length === 0) {
    process.stderr.write('rfc review: no CriticMarkup comment marks ({>> ... <<}) found\n')
  }

  // Read RFC frontmatter from rfcDir if available
  const fm = readRfcFrontmatter(rfcDir)
  const rfcUid = fm?.uid ?? '(unknown)'
  const bodyDigest = fmBodyDigest(fm)

  const date = new Date().toISOString().slice(0, 10)
  const filename = `${date}-${reviewer}.comments.json`
  const revDir = reviewsDir(rfcDir)
  mkdirSync(revDir, { recursive: true })
  const filePath = path.join(revDir, filename)

  const now = new Date().toISOString()
  const review = {
    schema: 1,
    rfc_uid: rfcUid,
    rfc_digest: bodyDigest,
    reviewer,
    created: now,
    updated: now,
    overall_verdict: 'needs-changes',
    comments,
  }

  writeFileSync(filePath, JSON.stringify(review, null, 2) + '\n')
  out(`Created ${filePath} (${comments.length} comment(s))`)
}

// ---------------------------------------------------------------------------
// Entry point (when run directly, not imported)
// ---------------------------------------------------------------------------

const _thisFile = fileURLToPath(import.meta.url)
if (process.argv[1] === _thisFile) {
  const [,, subcmd, ...rest] = process.argv

  const subcommands = {
    generate: cmdReviewGenerate,
    add: cmdReviewAdd,
    resolve: cmdReviewResolve,
    'parse-criticmarkup': cmdReviewParseCriticmarkup,
  }

  if (!subcmd) {
    process.stderr.write('Usage: rfc-review.mjs <generate|add|resolve|parse-criticmarkup> ...\n')
    process.exit(2)
  }

  if (!subcommands[subcmd]) {
    process.stderr.write(`rfc review: unknown subcommand "${subcmd}"\n`)
    process.exit(2)
  }

  try {
    subcommands[subcmd](rest)
  } catch (e) {
    process.stderr.write(`rfc review: ${e.message}\n`)
    process.exit(1)
  }
}
