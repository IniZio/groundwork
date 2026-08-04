// hooks/lib/motive-tickets.mjs
// Generates per-ticket drill-down files for every ledger slice and charter open
// item of a motive, wayfinder-style.
//
// Design constraints (mirrors motive-map.mjs):
//   - Fully synchronous.
//   - Never throws — warns to stderr, swallows all errors.
//   - Called from regenerateMotiveMap in motive-map.mjs; no additional call sites needed.
//   - Stale ticket files (ids that no longer exist) are removed on every regeneration.
//   - Path-traversal safe: ids are sanitized before use as filenames.

import {
  writeFileSync,
  readdirSync,
  mkdirSync,
  rmSync,
  existsSync,
} from 'node:fs'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Regenerate per-ticket .md files for all slices and open items.
 *
 * Output directory: <motiveDir>/tickets/
 *
 * Never throws. Errors are warned to stderr.
 *
 * @param {string} motiveDir     — absolute path to .groundwork/motives/<slug>/
 * @param {object} opts
 * @param {Array}  opts.slices   — ledger slice objects (may be empty)
 * @param {Array}  opts.openItems — charter open_items (may be empty)
 * @param {Array}  opts.events   — all journal events for this motive (may be empty)
 */
export function regenerateMotiveTickets(motiveDir, { slices = [], openItems = [], events = [] }) {
  try {
    _regenerate(motiveDir, { slices, openItems, events })
  } catch (err) {
    process.stderr.write(
      `[motive-tickets] warn: failed to regenerate tickets: ${err?.message ?? err}\n`,
    )
  }
}

// ---------------------------------------------------------------------------
// Sanitize
// ---------------------------------------------------------------------------

/**
 * Escape special regex metacharacters in a string (for use in RegExp constructor).
 */
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Convert an id (e.g. "S-ANCHOR", "TBD-1", "map-autogen") to a safe filename stem.
 * Lowercases; replaces any char outside [a-z0-9_-] with '-'; collapses runs; trims.
 * Rejects path-traversal attempts (returns null for ids that contain / or ..).
 */
export function sanitizeId(id) {
  if (!id || typeof id !== 'string') return null
  if (id.includes('/') || id.includes('..')) return null
  return id
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    || null
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

function _regenerate(motiveDir, { slices, openItems, events }) {
  const ticketsDir = join(motiveDir, 'tickets')
  mkdirSync(ticketsDir, { recursive: true })

  // Build map of safe-filename → content for all current ids
  const expected = new Map() // safeName → markdown string
  const seenStems = new Map() // safeName → first raw id (for collision detection)

  for (const slice of slices) {
    const safeName = sanitizeId(slice.id)
    if (!safeName) continue
    if (seenStems.has(safeName)) {
      process.stderr.write(
        `[motive-tickets] warn: id collision: "${slice.id}" and "${seenStems.get(safeName)}" both sanitize to "${safeName}" — overwriting\n`,
      )
    } else {
      seenStems.set(safeName, slice.id)
    }
    const relatedEvents = events.filter(
      (ev) => ev.data?.slice === slice.id,
    )
    expected.set(safeName, _renderSliceTicket(slice, relatedEvents))
  }

  for (const item of openItems) {
    const safeName = sanitizeId(item.id)
    if (!safeName) continue
    if (seenStems.has(safeName)) {
      process.stderr.write(
        `[motive-tickets] warn: id collision: "${item.id}" and "${seenStems.get(safeName)}" both sanitize to "${safeName}" — overwriting\n`,
      )
    } else {
      seenStems.set(safeName, item.id)
    }
    // Find DECISION events that explicitly reference this open-item id via structured
    // fields (ev.data.tbd / ev.data.resolves) or as a whole word in the message text.
    // Never use bare substring includes — "TBD-1" must not match "TBD-12".
    const wordBoundary = new RegExp(`\\b${escapeRegExp(item.id)}\\b`)
    const relatedDecisions = events.filter(
      (ev) =>
        ev.type === 'DECISION' &&
        (ev.data?.tbd === item.id ||
          ev.data?.resolves === item.id ||
          wordBoundary.test(ev.msg ?? '')),
    )
    expected.set(safeName, _renderOpenItemTicket(item, relatedDecisions))
  }

  // Write (or overwrite) current tickets
  for (const [safeName, content] of expected) {
    writeFileSync(join(ticketsDir, `${safeName}.md`), content, 'utf8')
  }

  // Remove stale tickets (ids that no longer exist in the ledger/charter)
  if (existsSync(ticketsDir)) {
    for (const f of readdirSync(ticketsDir)) {
      if (!f.endsWith('.md')) continue
      const stem = f.slice(0, -3)
      if (!expected.has(stem)) {
        try {
          rmSync(join(ticketsDir, f))
        } catch { /* ignore */ }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

/**
 * Render a slice ticket.
 *
 * Sections:
 *   # <id>: <desc>
 *   ## Status
 *   ## Details
 *   ## Acceptance criteria
 *   ## Related events
 *   ---
 *   _Auto-generated_
 */
function _renderSliceTicket(slice, relatedEvents) {
  const parts = []

  const desc = slice.desc ?? '(no description)'
  parts.push(`# ${slice.id}: ${desc}`)
  parts.push('')

  // Status
  parts.push('## Status')
  parts.push('')
  parts.push(_sliceStatusLine(slice))
  parts.push('')

  // Details
  parts.push('## Details')
  parts.push('')
  if (slice.wave != null) parts.push(`**Wave:** ${slice.wave}`)
  if (slice.kind) parts.push(`**Kind:** ${slice.kind}`)
  if (slice.completed_at) parts.push(`**Completed at:** ${slice.completed_at.slice(0, 10)}`)
  if (slice.session_id) parts.push(`**Session:** ${slice.session_id}`)
  parts.push('')

  // Acceptance criteria
  const acceptance = Array.isArray(slice.acceptance) ? slice.acceptance : []
  if (acceptance.length) {
    parts.push('## Acceptance criteria')
    parts.push('')
    for (const ac of acceptance) {
      const check = slice.status === 'complete' ? 'x' : ' '
      parts.push(`- [${check}] ${ac}`)
    }
    parts.push('')
  }

  // Related events
  if (relatedEvents.length) {
    parts.push('## Related events')
    parts.push('')
    for (const ev of relatedEvents) {
      const ts = (ev.ts ?? '').slice(0, 10)
      const label = ev.type
      const msg = ev.msg ?? JSON.stringify(ev.data ?? '')
      parts.push(`- **${label}**${ts ? ` (${ts})` : ''}: ${msg}`)
    }
    parts.push('')
  }

  parts.push('---')
  parts.push('_Auto-generated — do not edit by hand._')

  return parts.join('\n') + '\n'
}

function _sliceStatusLine(slice) {
  if (slice.status === 'complete') return '**complete**'
  if (slice.status === 'in_progress') return '**in progress**'
  const blocked = _deps(slice).filter(Boolean)
  if (blocked.length) return `**blocked** by ${blocked.join(', ')}`
  return '**ready**'
}

/**
 * Render an open-item (TBD/TBR) ticket.
 *
 * Sections:
 *   # <id>: <statement>
 *   ## Status
 *   ## Details
 *   ## Related decisions
 *   ---
 *   _Auto-generated_
 */
function _renderOpenItemTicket(item, relatedDecisions) {
  const parts = []

  const statement = (item.statement ?? '').replace(/\s*\n\s*/g, ' ').trim() || '(no statement)'
  parts.push(`# ${item.id}: ${statement}`)
  parts.push('')

  // Status — sourced from the charter open-item record, not inferred from mentions.
  // An item present in open_items is open unless explicitly marked resolved (resolved_by).
  parts.push('## Status')
  parts.push('')
  const status = item.resolved_by ? 'resolved' : 'open'
  parts.push(`**${status}**`)
  parts.push('')

  // Details
  parts.push('## Details')
  parts.push('')
  if (item.kind) parts.push(`**Kind:** ${item.kind}`)
  if (item.owner) parts.push(`**Owner:** @${item.owner}`)
  if (item.blocked_by) parts.push(`**Blocked by:** ${item.blocked_by}`)
  if (item.resolved_by) parts.push(`**Resolved by:** ${item.resolved_by}`)
  parts.push('')

  // Related decisions (mentions this open item — not a proxy for resolution status)
  if (relatedDecisions.length) {
    parts.push('## Related decisions')
    parts.push('')
    for (const d of relatedDecisions) {
      const ts = (d.ts ?? '').slice(0, 10)
      const msg = d.msg ?? JSON.stringify(d.data ?? '')
      parts.push(`- ${ts ? `[${ts}] ` : ''}${msg}`)
    }
    parts.push('')
  }

  parts.push('---')
  parts.push('_Auto-generated — do not edit by hand._')

  return parts.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _deps(slice) {
  if (Array.isArray(slice.blocked_by)) return slice.blocked_by
  if (slice.blocked_by) return [slice.blocked_by]
  return []
}
