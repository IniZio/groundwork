// hooks/lib/motive-ticket-doc.mjs
// Ticket document format + writer library.
//
// A ticket is a durable work object — human-authored, never overwritten by
// groundwork code once created.  Format matches the mattpocock issue style:
// plain-text metadata lines, then ## section headings.
//
// Exports
//   renderTemplate(opts)   → markdown string (empty bodies for authors)
//   parseTicket(content)   → { emptySections: string[] }
//   writeTicket(path, opts) → Promise<{ written: boolean }>
//   resolveTicketPath(charter, motiveDir, ticketId) → string (absolute path)

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'

// ---------------------------------------------------------------------------
// Required sections (order matches template)
// ---------------------------------------------------------------------------

export const REQUIRED_SECTIONS = [
  'Question',
  'Context',
  'Evidence',
  'Decision',
  'Ruled out',
  'Revisions',
  'Links',
]

// ---------------------------------------------------------------------------
// renderTemplate
// ---------------------------------------------------------------------------

/**
 * Render an empty ticket template in mattpocock issue style.
 *
 * @param {object} opts
 * @param {string} opts.title       — ticket title (h1)
 * @param {string} [opts.type]      — Type field (e.g. "decision", "research")
 * @param {string} [opts.status]    — Status field (e.g. "open")
 * @param {string} [opts.blockedBy] — Blocked-by field (e.g. "T1" or "—")
 * @returns {string}
 */
export function renderTemplate({ title, type = 'decision', status = 'open', blockedBy = '—' }) {
  const sections = REQUIRED_SECTIONS.map((name) => `## ${name}\n\n`).join('\n')
  return `# ${title}\n\nType: ${type}\nStatus: ${status}\nBlocked by: ${blockedBy}\n\n${sections}`
}

// ---------------------------------------------------------------------------
// parseTicket
// ---------------------------------------------------------------------------

/**
 * Parse an existing ticket and report which required sections have empty bodies.
 *
 * "Empty" means the section body — the text between this heading and the next
 * ## heading (or EOF) — contains no non-whitespace characters.
 *
 * The file is NOT rewritten.
 *
 * @param {string} content — raw markdown text
 * @returns {{ emptySections: string[] }}
 */
export function parseTicket(content) {
  const emptySections = []

  for (const name of REQUIRED_SECTIONS) {
    // Match the section heading (## exactly, case-sensitive)
    const headingRe = new RegExp(
      `^## ${escapeRegExp(name)}\\s*$`,
      'm',
    )
    const match = headingRe.exec(content)
    if (!match) {
      // Section is absent — counts as empty
      emptySections.push(name)
      continue
    }

    // Body: from end of heading line to next ## heading or EOF
    const afterHeading = content.slice(match.index + match[0].length)
    const nextHeadingIdx = afterHeading.search(/^## /m)
    const body = nextHeadingIdx === -1 ? afterHeading : afterHeading.slice(0, nextHeadingIdx)

    if (body.trim() === '') {
      emptySections.push(name)
    }
  }

  return { emptySections }
}

// ---------------------------------------------------------------------------
// writeTicket
// ---------------------------------------------------------------------------

/**
 * Write a ticket file only when it does not already exist.
 *
 * Never overwrites or deletes an existing file (ARTIFACT-R-008).
 *
 * @param {string} ticketPath — absolute path for the ticket file
 * @param {object} opts       — passed through to renderTemplate
 * @returns {Promise<{ written: boolean }>}
 */
export async function writeTicket(ticketPath, opts) {
  if (existsSync(ticketPath)) {
    return { written: false }
  }
  mkdirSync(dirname(ticketPath), { recursive: true })
  writeFileSync(ticketPath, renderTemplate(opts), 'utf8')
  return { written: true }
}

// ---------------------------------------------------------------------------
// resolveTicketPath
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute path for a ticket file.
 *
 * Resolution order (ARTIFACT-R-009):
 *   1. charter.tickets_dir  — explicit override
 *   2. <motiveDir>/tickets/ — default
 *
 * @param {object|null} charter  — motive charter object (may be null/undefined)
 * @param {string} motiveDir     — absolute path to .groundwork/motives/<slug>/
 * @param {string} ticketId      — ticket identifier used as the filename stem
 * @returns {string}             — absolute path including the .md extension
 */
export function resolveTicketPath(charter, motiveDir, ticketId) {
  const dir =
    charter?.tickets_dir ? charter.tickets_dir : join(motiveDir, 'tickets')
  const safeName = sanitizeId(ticketId)
  return join(dir, `${safeName}.md`)
}

// ---------------------------------------------------------------------------
// lintResearchCitation
// ---------------------------------------------------------------------------

/**
 * A resolvable primary-source reference is any of:
 *   - a URL (http:// or https://)
 *   - a relative file path (starting with ./ or ../)
 *   - an absolute file path (/ followed by a word character, at a word boundary)
 *   - a doc/specs requirement id: bare token of the form <CONCEPT>-R-<digits>
 *     e.g. ARTIFACT-R-012 (uppercase concept letters/digits, literal "-R-", digits)
 *
 * The regex is intentionally simple — it matches concrete locators, not
 * prose descriptions.
 */
const RESOLVABLE_REF_RE = /https?:\/\/|\.\.?\/|(?:^|[ \t(["'])\/[a-zA-Z0-9_]|\b[A-Z][A-Z0-9]*-R-\d+\b/m

/**
 * Lint rule scoped to research-type tickets.
 *
 * A research ticket must carry at least one resolvable primary-source
 * reference in its Evidence or Links section (D-81).
 *
 * Non-research ticket types always pass this rule.
 *
 * @param {string} content - raw markdown text
 * @returns {{ pass: boolean, reason: string|null }}
 */
export function lintResearchCitation(content) {
  const typeMatch = /^Type:\s*(.+)$/m.exec(content)
  const type = typeMatch ? typeMatch[1].trim().toLowerCase() : ''

  if (type !== 'research') {
    return { pass: true, reason: null }
  }

  const evidenceBody = _extractSectionBody(content, 'Evidence')
  const linksBody = _extractSectionBody(content, 'Links')
  const combined = (evidenceBody ?? '') + '\n' + (linksBody ?? '')

  if (RESOLVABLE_REF_RE.test(combined)) {
    return { pass: true, reason: null }
  }

  return {
    pass: false,
    reason:
      'research ticket must have ≥1 resolvable reference (URL, file path, or requirement id e.g. ARTIFACT-R-012) in Evidence or Links',
  }
}

function _extractSectionBody(content, sectionName) {
  const re = new RegExp(`^## ${escapeRegExp(sectionName)}\\s*$`, 'm')
  const match = re.exec(content)
  if (!match) return null
  const after = content.slice(match.index + match[0].length)
  const nextIdx = after.search(/^## /m)
  return nextIdx === -1 ? after : after.slice(0, nextIdx)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function sanitizeId(id) {
  // Keep alphanumerics, hyphens, underscores; replace everything else with '-'
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '-')
}
