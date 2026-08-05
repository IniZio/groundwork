/**
 * motive-charter.mjs — Charter reader, path resolver, and template renderer.
 *
 * PURITY NOTE: This module is intentionally IMPURE (reads from the filesystem).
 * It MUST NOT be imported by motive-compile.mjs or motive-render.mjs.
 * It is injected as opts.charter into compile(), mirroring motive-ground-truth.mjs.
 *
 * Charter file location: <projectDir>/.groundwork/motives/<slug>/motive.md
 *
 * Exported signatures (frozen in S0; implementations land in S3):
 *
 *   readCharter({ projectDir, motive }) → Charter | null
 *     Reads and parses the charter file. Returns null (never throws) when the
 *     file is missing, unreadable, or malformed.
 *     Charter: {
 *       objective: string,
 *       open_items: Array<{
 *         id: string,
 *         kind: 'TBD' | 'TBR',
 *         statement: string,
 *         owner?: string,
 *         blocked_by?: string,
 *       }>,
 *       notes: string,
 *       out_of_scope: string,
 *       path: string,
 *     }
 *
 *   charterPath(projectDir, motive) → string
 *     Returns the absolute path to the charter file (does not touch disk).
 *
 *   renderCharterTemplate({ motive, objective }) → string
 *     Returns the initial charter Markdown source. Pure.
 */

import path from 'node:path'
import fs from 'node:fs'

// ---------------------------------------------------------------------------
// charterPath — pure path resolver
// ---------------------------------------------------------------------------

/**
 * @param {string} projectDir
 * @param {string} motive
 * @returns {string}
 */
export function charterPath(projectDir, motive) {
  return path.join(projectDir, '.groundwork', 'motives', motive, 'motive.md')
}

// ---------------------------------------------------------------------------
// renderCharterTemplate — pure template generator
// ---------------------------------------------------------------------------

/**
 * @param {{ motive: string, objective: string }} opts
 * @returns {string}
 */
export function renderCharterTemplate({ motive, objective }) {
  const obj = (objective ?? '').trim() || 'TBD'
  return `# motive: ${motive}

## Objective

${obj}

## Notes

<!-- Add notes here. -->

## Open items

<!-- TBD/TBR register. One bullet per open item. Format:
- TBD-1: What needs to be decided. @owner blocked-by:TBD-2
- TBR-1: What needs to be researched.
Kind is derived from the id prefix (TBD or TBR). -->

## Out of scope

<!-- Pointers to .groundwork/out-of-scope/ for rejected items. -->
`
}

// ---------------------------------------------------------------------------
// readCharter — impure: reads and parses the charter file
// ---------------------------------------------------------------------------

// Matches a section heading at any level (1–6).
// Group 1 = the run of '#' characters (used to determine level).
// Group 2 = heading title text.
const SECTION_RE = /^(#{1,6})\s+(.+)$/

// Matches a valid open-item bullet:
//   - TBD-<id>: statement [@owner] [blocked-by:<ref>]
//   - TBR-<id>: statement ...
const OPEN_ITEM_RE = /^-\s+((?:TBD|TBR)-\S+):\s+(.+)$/i

// Matches a valid acceptance-criteria bullet (STRICT — uppercase AC- only):
//   - AC-<id>: statement
// The /i flag is intentionally absent: lowercase `ac-` is a near-miss and
// triggers a warning (see parseAcceptanceCriteria).
const AC_ITEM_RE = /^-\s+(AC-\S+):\s+(.+)$/

// Case-insensitive fallback — used ONLY to detect near-misses (lowercase/mixed
// AC- prefix) so a helpful warning can be emitted.  Never used to accept items.
const AC_ITEM_RE_CI = /^-\s+(AC-\S+):\s+(.+)$/i

// Extracts @owner from remainder
const OWNER_RE = /@(\S+)/

// Extracts blocked-by:<ref>
const BLOCKED_BY_RE = /\bblocked-by:(\S+)/i

/**
 * Parse open-item bullets from the Open items section body.
 * Malformed bullet lines (starting with "- " but not matching the format)
 * are counted and warned to stderr once; valid items are returned.
 *
 * Strikethrough filtering: a bullet whose statement (including any continuation
 * lines) starts with `~~` is considered resolved/closed and excluded from the
 * returned items.  This matches the repo convention of wrapping the original
 * intent in `~~…~~` and appending a RESOLVED or CLOSED annotation.
 *
 * @param {string} body
 * @returns {{ items: Array<object>, malformedCount: number }}
 */
function parseOpenItems(body) {
  // Strip HTML comments (<!-- ... -->) before line-by-line parsing
  const stripped = body.replace(/<!--[\s\S]*?-->/g, '')

  const items = []
  let malformedCount = 0

  for (const line of stripped.split('\n')) {
    const trimmed = line.trim()

    // Continuation line: indented (not a new bullet) — append to current item's statement
    if (!trimmed.startsWith('-')) {
      if (trimmed && items.length > 0) {
        items[items.length - 1].statement += ' ' + trimmed
      }
      continue
    }

    const m = OPEN_ITEM_RE.exec(trimmed)
    if (!m) {
      malformedCount++
      continue
    }

    const id = m[1]
    const kind = /** @type {'TBD'|'TBR'} */ (id.slice(0, 3).toUpperCase())
    let remainder = m[2].trim()

    // Extract optional fields from remainder
    const ownerM = OWNER_RE.exec(remainder)
    const owner = ownerM ? ownerM[1] : undefined

    const blockedByM = BLOCKED_BY_RE.exec(remainder)
    const blocked_by = blockedByM ? blockedByM[1] : undefined

    // Strip @owner and blocked-by:... from statement
    let statement = remainder
      .replace(OWNER_RE, '')
      .replace(BLOCKED_BY_RE, '')
      .trim()
      // Collapse multiple spaces
      .replace(/\s{2,}/g, ' ')

    /** @type {{ id: string, kind: 'TBD'|'TBR', statement: string, owner?: string, blocked_by?: string }} */
    const item = { id, kind, statement }
    if (owner) item.owner = owner
    if (blocked_by) item.blocked_by = blocked_by

    items.push(item)
  }

  // Post-pass: drop resolved items (statement starts with `~~` after all
  // continuations have been joined).  Checked here rather than inline so that
  // multi-line strikethrough entries (where the closing `~~` is on a later
  // continuation line) are evaluated with their full accumulated statement.
  const openItems = items.filter((item) => !item.statement.startsWith('~~'))

  return { items: openItems, malformedCount }
}

/**
 * Parse acceptance-criteria bullets from the Acceptance criteria section body.
 *
 * The id matcher is STRICT: only uppercase `AC-` prefix is accepted.  A line
 * like `- ac-1: text` does NOT produce an item; instead it is collected in
 * `caseMismatchLines` so the caller can emit a visible warning.  Silently
 * dropping a human's intended criterion is a worse failure than the key-split
 * the strict parser prevents — the warning surfaces the typo immediately.
 *
 * @param {string} body
 * @returns {{ items: Array<{ id: string, statement: string }>, caseMismatchLines: string[] }}
 */
function parseAcceptanceCriteria(body) {
  if (!body) return { items: [], caseMismatchLines: [] }
  const stripped = body.replace(/<!--[\s\S]*?-->/g, '')
  const items = []
  const caseMismatchLines = []

  for (const line of stripped.split('\n')) {
    const trimmed = line.trim()

    // Continuation line: not a new bullet — append to current item's statement
    if (!trimmed.startsWith('-')) {
      if (trimmed && items.length > 0) {
        items[items.length - 1].statement += ' ' + trimmed
      }
      continue
    }

    const m = AC_ITEM_RE.exec(trimmed)
    if (!m) {
      // Near-miss: would have matched with a case-insensitive regex — warn, don't silently drop.
      if (AC_ITEM_RE_CI.test(trimmed)) {
        caseMismatchLines.push(trimmed)
      }
      // Other non-matching bullets (unrelated content) are skipped silently.
      continue
    }

    items.push({ id: m[1], statement: m[2].trim() })
  }

  return { items, caseMismatchLines }
}

/**
 * Split markdown into sections keyed by heading name (lowercased, trimmed).
 * Returns Map<string, string> where values are the section body text.
 *
 * Level-aware, two-pass heading detection:
 *
 *   The "section-boundary level" is established by the SECOND heading encountered.
 *   The first heading is often a document title (e.g. `# motive: my-motive`) at a
 *   shallower depth than the actual content sections (`## Objective`, `## Notes`, …).
 *   Using the second heading's level avoids treating the document title's level as the
 *   boundary, which would otherwise swallow all `##` sections into the `#` title body.
 *
 *   Once the boundary level is established, headings at that level or shallower open
 *   new sections; deeper headings are kept as body text so that `### Sub-detail` inside
 *   `## Objective` does not truncate the Objective body.
 *
 *   When the file has only one heading (no second heading to set the boundary), that
 *   single heading's level is used.
 *
 * @param {string} src
 * @returns {Map<string, string>}
 */
function splitSections(src) {
  const sections   = new Map()
  let currentKey   = null
  let sectionLevel = 0   // established section-boundary level (0 = not yet known)
  const bodyLines  = []

  for (const line of src.split('\n')) {
    const m = SECTION_RE.exec(line)
    if (m) {
      const level = m[1].length          // e.g. '##' → 2
      const title = m[2].trim().toLowerCase()

      if (sectionLevel === 0) {
        if (currentKey === null) {
          // First heading: tentative section — boundary level not yet established.
          currentKey   = title
          bodyLines.length = 0
        } else {
          // Second heading: now we know the boundary level.  Close the first section
          // and use THIS heading's level as the boundary going forward.
          sectionLevel = level
          sections.set(currentKey, bodyLines.join('\n').trim())
          currentKey   = title
          bodyLines.length = 0
        }
      } else if (level <= sectionLevel) {
        // At or above boundary level → new top-level section.
        if (currentKey != null) {
          sections.set(currentKey, bodyLines.join('\n').trim())
        }
        currentKey   = title
        bodyLines.length = 0
      } else {
        // Deeper than boundary level → sub-heading, kept as body content.
        bodyLines.push(line)
      }
    } else {
      bodyLines.push(line)
    }
  }
  // Flush the last section.  If sectionLevel was never established (single heading),
  // treat that heading's own level as the boundary (single-section document).
  if (currentKey != null) {
    sections.set(currentKey, bodyLines.join('\n').trim())
  }
  return sections
}

/**
 * Parse "DECISION <id>: <text>" lines from the Decisions section body.
 * Multi-line decisions (continuation lines before the next DECISION) are joined.
 * Returns an array of { id: string, text: string }.
 *
 * @param {string} body
 * @returns {Array<{ id: string, text: string }>}
 */
function _parseCharterDecisions(body) {
  if (!body) return []
  const DECISION_RE = /^DECISION\s+(\S+?):\s*(.*)$/i
  const items = []
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    const m = DECISION_RE.exec(trimmed)
    if (m) {
      items.push({ id: m[1], text: m[2].trim() })
    } else if (trimmed && items.length > 0) {
      // continuation of the previous DECISION
      items[items.length - 1].text += ' ' + trimmed
    }
  }
  return items
}

/**
 * @param {{ projectDir: string, motive: string }} opts
 * @returns {{ objective: string, open_items: Array<object>, notes: string, out_of_scope: string, decisions: Array<{id: string, text: string}>, path: string } | null}
 */
export function readCharter({ projectDir, motive }) {
  const filePath = charterPath(projectDir, motive)
  let src
  try {
    src = fs.readFileSync(filePath, 'utf8')
  } catch {
    // Missing or unreadable — tolerated
    return null
  }

  try {
    const sections = splitSections(src)

    const objective = sections.get('objective') ?? ''
    const notes = sections.get('notes') ?? ''
    const out_of_scope = sections.get('out of scope') ?? ''
    const openItemsBody = sections.get('open items') ?? ''
    const decisionsBody = sections.get('decisions') ?? ''
    const acBody = sections.get('acceptance criteria') ?? ''

    const { items: open_items, malformedCount } = parseOpenItems(openItemsBody)

    if (malformedCount > 0) {
      process.stderr.write(
        `[motive-charter] ${malformedCount} malformed open-item line(s) in ${filePath} — skipped\n`,
      )
    }

    // Extract inline DECISION lines from the Decisions section body.
    // Each line of the form "DECISION <id>: <text>" (possibly paragraph-wrapped)
    // becomes a synthetic entry { id, text } for the MAP decisions section.
    const decisions = _parseCharterDecisions(decisionsBody)

    const { items: acceptance_criteria, caseMismatchLines } = parseAcceptanceCriteria(acBody)

    for (const line of caseMismatchLines) {
      process.stderr.write(
        `[motive-charter] warn: AC id must start with uppercase "AC-" — line skipped: "${line}" in ${filePath}\n`,
      )
    }

    return {
      objective,
      open_items,
      notes,
      out_of_scope,
      decisions,
      acceptance_criteria,
      path: filePath,
    }
  } catch {
    // Unexpected parse failure — tolerated
    return null
  }
}
