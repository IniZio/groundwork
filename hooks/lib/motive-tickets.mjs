// hooks/lib/motive-tickets.mjs
// Generates per-open-item drill-down files for charter open items of a motive.
//
// Ownership inversion (T4): tickets/ is now agent/human-authored territory.
// This module NEVER writes to or deletes from tickets/. Open-item drill-downs
// are written to open-items/ (a sibling of tickets/) and swept there only.
//
// Design constraints (mirrors motive-map.mjs):
//   - Fully synchronous.
//   - Never throws — warns to stderr, swallows all errors.
//   - Called from regenerateMotiveMap in motive-map.mjs; no additional call sites needed.
//   - Stale open-item files (ids that no longer exist) are removed from open-items/ only.
//   - Path-traversal safe: ids are sanitized before use as filenames.

import {
  writeFileSync,
  readFileSync,
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
 * Regenerate per-open-item drill-down .md files for all charter open items.
 *
 * Output directory: <motiveDir>/open-items/
 *
 * tickets/ is NEVER written to or read from — it is agent/human-authored territory.
 *
 * Never throws. Errors are warned to stderr.
 *
 * @param {string} motiveDir     — absolute path to .groundwork/motives/<slug>/
 * @param {object} opts
 * @param {Array}  opts.slices   — ledger slice objects (ignored; kept for call-site compat)
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

function _regenerate(motiveDir, { openItems, events }) {
  // Open-item drill-downs go to open-items/ — NEVER to tickets/
  const openItemsDir = join(motiveDir, 'open-items')
  mkdirSync(openItemsDir, { recursive: true })

  // Build map of safe-filename → content for all current open-item ids
  const expected = new Map() // safeName → markdown string
  const seenStems = new Map() // safeName → first raw id (for collision detection)

  for (const item of openItems) {
    if (item.resolved_by) continue
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

  // Write (or overwrite) current open-item drill-downs
  for (const [safeName, content] of expected) {
    writeFileSync(join(openItemsDir, `${safeName}.md`), content, 'utf8')
  }

  // Remove stale open-item files (ids that no longer exist in the charter).
  // SCOPE: open-items/ only — tickets/ is NEVER swept.
  if (existsSync(openItemsDir)) {
    for (const f of readdirSync(openItemsDir)) {
      if (!f.endsWith('.md')) continue
      const stem = f.slice(0, -3)
      if (!expected.has(stem)) {
        try {
          rmSync(join(openItemsDir, f))
        } catch { /* ignore */ }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/**
 * The footer appended by the old per-slice ticket generator.
 * Any tickets/ file that contains this exact string was auto-generated
 * and is safe to delete — hand-authored files will never carry it.
 */
const AUTOGEN_FOOTER = '_Auto-generated — do not edit by hand._'

/**
 * One-shot migration: delete legacy auto-generated ticket files from tickets/.
 *
 * Scans <motiveDir>/tickets/*.md; deletes only those carrying AUTOGEN_FOOTER.
 * Hand-authored files (no footer) are never touched.
 *
 * Reports each deleted path to stdout.
 * Never throws.
 *
 * @param {string} motiveDir — absolute path to .groundwork/motives/<slug>/
 * @returns {string[]} deleted file paths
 */
export function migrateAutoGeneratedTickets(motiveDir) {
  try {
    const ticketsDir = join(motiveDir, 'tickets')
    if (!existsSync(ticketsDir)) return []
    const deleted = []
    for (const file of readdirSync(ticketsDir)) {
      if (!file.endsWith('.md')) continue
      const filePath = join(ticketsDir, file)
      let content
      try { content = readFileSync(filePath, 'utf8') } catch { continue }
      const lastNonEmpty = content.split('\n').map(l => l.trimEnd()).filter(Boolean).at(-1) ?? ''
      if (lastNonEmpty.trim() === AUTOGEN_FOOTER) {
        try {
          rmSync(filePath)
          process.stdout.write(`[motive-tickets] migrate: deleted autogen ticket ${filePath}\n`)
          deleted.push(filePath)
        } catch { /* ignore — file may have been deleted concurrently */ }
      }
    }
    return deleted
  } catch (err) {
    process.stderr.write(
      `[motive-tickets] warn: migration scan failed: ${err?.message ?? err}\n`,
    )
    return []
  }
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

/**
 * Render an open-item (TBD/TBR) drill-down.
 *
 * Sections:
 *   # <id>: <statement>
 *   > <body>          (only when body is present)
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

  // Body — the long-form detail from the charter (present only when item is multi-line).
  const body = (item.body ?? '').trim()
  if (body) {
    parts.push(body)
    parts.push('')
  }

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
  // Graduation: forward link from open-item to ticket (D-75/D-76).
  // The TBD remains in the open register until actually resolved (strikethrough).
  // Rendered unconditionally from the field — ticket may not be authored yet (D-76 coexistence).
  if (item.graduated_to) {
    parts.push(`**Graduated to:** [tickets/${item.graduated_to}.md](../tickets/${item.graduated_to}.md)`)
  }
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

