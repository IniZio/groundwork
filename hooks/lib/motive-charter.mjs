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

// Matches a section heading: ## Section Name
const SECTION_RE = /^##\s+(.+)$/

// Matches a valid open-item bullet:
//   - TBD-<id>: statement [@owner] [blocked-by:<ref>]
//   - TBR-<id>: statement ...
const OPEN_ITEM_RE = /^-\s+((?:TBD|TBR)-\S+):\s+(.+)$/i

// Extracts @owner from remainder
const OWNER_RE = /@(\S+)/

// Extracts blocked-by:<ref>
const BLOCKED_BY_RE = /\bblocked-by:(\S+)/i

/**
 * Parse open-item bullets from the Open items section body.
 * Malformed bullet lines (starting with "- " but not matching the format)
 * are counted and warned to stderr once; valid items are returned.
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

  return { items, malformedCount }
}

/**
 * Split markdown into sections keyed by heading name (lowercased, trimmed).
 * Returns Map<string, string> where values are the section body text.
 *
 * @param {string} src
 * @returns {Map<string, string>}
 */
function splitSections(src) {
  const sections = new Map()
  let currentKey = null
  const bodyLines = []

  for (const line of src.split('\n')) {
    const m = SECTION_RE.exec(line)
    if (m) {
      if (currentKey != null) {
        sections.set(currentKey, bodyLines.join('\n').trim())
      }
      currentKey = m[1].trim().toLowerCase()
      bodyLines.length = 0
    } else {
      bodyLines.push(line)
    }
  }
  if (currentKey != null) {
    sections.set(currentKey, bodyLines.join('\n').trim())
  }
  return sections
}

/**
 * @param {{ projectDir: string, motive: string }} opts
 * @returns {{ objective: string, open_items: Array<object>, notes: string, out_of_scope: string, path: string } | null}
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

    const { items: open_items, malformedCount } = parseOpenItems(openItemsBody)

    if (malformedCount > 0) {
      process.stderr.write(
        `[motive-charter] ${malformedCount} malformed open-item line(s) in ${filePath} — skipped\n`,
      )
    }

    return {
      objective,
      open_items,
      notes,
      out_of_scope,
      path: filePath,
    }
  } catch {
    // Unexpected parse failure — tolerated
    return null
  }
}
