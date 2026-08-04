// hooks/lib/motive-map.mjs
// Generates .groundwork/motives/<slug>/MAP.md — a human-readable wayfinder map.
//
// Design constraints:
//   - Fully synchronous (ledger commands are sync; avoids async complexity).
//   - Never throws — warns to stderr, exits 0 so CLI mutations are unaffected.
//   - Single atomic writeFileSync at the end (no partial writes).
//   - No compile() pipeline — lightweight direct read of charter + ledger + journal.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { readCharter } from './motive-charter.mjs'
import { readAllEvents, filterEvents } from './journal-io.mjs'
import { regenerateMotiveTickets, sanitizeId } from './motive-tickets.mjs'
import { resolvedUnits, inFlightUnit, isExhausted } from './pacing.mjs'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Regenerate MAP.md for a given motive.
 *
 * Silent no-op when the motive directory doesn't exist (charter not yet written).
 * Warns to stderr on any error — never throws, never changes the caller's exit code.
 *
 * @param {string} projectDir  — absolute path, same as CLAUDE_PROJECT_DIR
 * @param {string} motive      — motive slug (e.g. "groundwork-development")
 */
export function regenerateMotiveMap(projectDir, motive) {
  if (!projectDir || !motive) return
  try {
    _generate(projectDir, motive)
  } catch (err) {
    process.stderr.write(
      `[motive-map] warn: failed to regenerate MAP.md for "${motive}": ${err?.message ?? err}\n`,
    )
  }
}

// ---------------------------------------------------------------------------
// Core generation
// ---------------------------------------------------------------------------

function _generate(projectDir, motive) {
  const motiveDir = join(projectDir, '.groundwork', 'motives', motive)
  if (!existsSync(motiveDir)) return  // no charter directory yet — skip silently

  const charter            = readCharter({ projectDir, motive })
  const ledgerDoc          = _readMotiveLedgerDoc(projectDir, motive)
  const slices             = Array.isArray(ledgerDoc?.slices) ? ledgerDoc.slices.filter(Boolean) : []
  const decisions          = _readDecisions(projectDir, motive)
  const outOfScope         = _readOutOfScope(projectDir)
  const rejectionDecisions = _readRejectionDecisions(projectDir, motive)
  const allEvents          = _readAllMotiveEvents(projectDir, motive)

  // Generate per-ticket drill-down files (errors swallowed inside)
  regenerateMotiveTickets(motiveDir, {
    slices,
    openItems: charter?.open_items ?? [],
    events: allEvents,
  })

  const md = _renderMap({ motive, charter, slices, ledgerDoc, decisions, outOfScope, rejectionDecisions })
  writeFileSync(join(motiveDir, 'MAP.md'), md, 'utf8')
}

// ---------------------------------------------------------------------------
// Data readers
// ---------------------------------------------------------------------------

/**
 * Return the whole chosen ledger document for this motive (not just slices).
 * Prefers the active ledger; falls back to the last-written one.
 * Returns null when no matching ledger exists.
 */
function _readMotiveLedgerDoc(projectDir, motive) {
  const candidates = []

  // Scan per-session ledgers in .groundwork/runs/
  const runsDir = join(projectDir, '.groundwork', 'runs')
  if (existsSync(runsDir)) {
    for (const f of readdirSync(runsDir)) {
      if (!f.endsWith('.json')) continue
      try {
        const data = JSON.parse(readFileSync(join(runsDir, f), 'utf8'))
        if (data.motive === motive) candidates.push(data)
      } catch { /* skip unreadable / malformed */ }
    }
  }

  // Legacy single-run ledger
  const legacyPath = join(projectDir, '.groundwork', 'run.json')
  if (existsSync(legacyPath)) {
    try {
      const data = JSON.parse(readFileSync(legacyPath, 'utf8'))
      if (data.motive === motive) candidates.push(data)
    } catch { /* ignore */ }
  }

  if (!candidates.length) return null
  return candidates.find((c) => c.active) ?? candidates[candidates.length - 1]
}

/**
 * Return DECISION events for this motive, newest first, with near-duplicates collapsed.
 * Exact-normalized-text duplicates are dropped; when one entry is a prefix/truncation
 * of another the longer one is kept.
 */
function _readDecisions(projectDir, motive) {
  const journalDir = join(projectDir, '.groundwork', 'journal')
  if (!existsSync(journalDir)) return []
  try {
    const all            = readAllEvents(journalDir)
    const { shown = [] } = filterEvents(all, { motive, type: 'DECISION' })
    const latest = shown.slice().reverse()  // latest first, non-mutating
    return _dedupeDecisions(latest)
  } catch {
    return []
  }
}

/**
 * Collapse duplicate entries and honour supersession.
 * Input and output are newest-first.
 *
 * Dedupe rules (in priority order):
 *   1. Supersession by id — if a DECISION event's data.supersedes lists another event's
 *      data.id, the superseded event is excluded.  Supersession requires structured ids;
 *      unstructured (legacy) decisions with no data.id cannot be superseded this way.
 *   2. Exact normalised-text match — keep the newest (first in newest-first input).
 *   3. Strict prefix/truncation — one normalised text is a leading prefix of the other;
 *      the longer entry wins.
 *
 * Intentionally NOT used: shared-prefix heuristic (≥N chars) — it dropped genuinely
 * distinct decisions that happen to share a topic opening ("Adopt ASD-STE100 … for
 * orchestrator rule files" vs "… for all spec prose, trial only").
 */
function _dedupeDecisions(decisions) {
  // ── Step 1: honour supersession by structured data.id ────────────────────
  const supersededIds = new Set()
  for (const d of decisions) {
    const s = d.data?.supersedes
    if (s == null) continue
    if (Array.isArray(s)) s.forEach((id) => supersededIds.add(id))
    else supersededIds.add(s)
  }
  const active = supersededIds.size === 0
    ? decisions
    : decisions.filter((d) => {
        const id = d.data?.id
        return id == null || !supersededIds.has(id)
      })

  // ── Step 2: exact and prefix/truncation dedup ─────────────────────────────
  const norm = (d) =>
    (d.msg ?? JSON.stringify(d.data ?? '')).toLowerCase().replace(/\s+/g, ' ').trim()

  const result = []
  for (const d of active) {
    const dNorm = norm(d)
    let skip = false
    let replaceIdx = -1
    for (let i = 0; i < result.length; i++) {
      const rNorm = norm(result[i])
      if (rNorm === dNorm) { skip = true; break }            // exact dup — keep result[i] (newer)
      if (rNorm.startsWith(dNorm)) { skip = true; break }    // result[i] is longer — skip d
      if (dNorm.startsWith(rNorm)) { replaceIdx = i; break } // d is longer — replace result[i]
    }
    if (!skip) {
      if (replaceIdx >= 0) result[replaceIdx] = d
      else result.push(d)
    }
  }
  return result
}

/**
 * Return human labels for every entry in .groundwork/out-of-scope/.
 */
function _readOutOfScope(projectDir) {
  const dir = join(projectDir, '.groundwork', 'out-of-scope')
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace(/\.md$/, '').replace(/-/g, ' '))
  } catch {
    return []
  }
}

/**
 * Return formatted labels for DECISION events that carry a rejection marker.
 * Detection: data.status==='rejected', data.rejects truthy, or "reject"/"not adopted"
 * appears in data.title or msg (case-insensitive).
 *
 * Dedup rule — first-sentence strict prefix (structural identity, not fuzzy prose):
 *   Two rejection events are considered the same rejection when one event's first
 *   sentence (text before the first ". " or end of msg) is a strict prefix of the
 *   other's first sentence after case-folding and whitespace normalisation.
 *   The shorter first sentence is the "summary form"; the longer is the "full prose".
 *   We keep the FULL PROSE (P-E: human-first content).  If the summary form carried a
 *   structured data.id, we append it to the kept label as " (D-X)" so the id is not lost.
 *
 * This is deliberately more conservative than a shared-prefix-length heuristic: it only
 * merges when the entire first sentence of one event is a strict prefix of the other's.
 * When the relationship is unclear, both entries are rendered.
 *
 * NOT used: session-level suppression — session identity ≠ rejection identity.
 */
function _readRejectionDecisions(projectDir, motive) {
  const journalDir = join(projectDir, '.groundwork', 'journal')
  if (!existsSync(journalDir)) return []
  try {
    const all            = readAllEvents(journalDir)
    const { shown = [] } = filterEvents(all, { motive, type: 'DECISION' })

    // Collect rejection events
    const rejections = []
    for (const ev of shown) {
      const data  = ev.data ?? {}
      const title = (data.title ?? '').toLowerCase()
      const msg   = (ev.msg   ?? '').toLowerCase()
      const isRejection =
        data.status === 'rejected' ||
        !!data.rejects ||
        /\breject(ed|s)?\b/.test(title) ||
        /\bnot adopted\b/.test(msg) ||
        /\bdo not adopt\b/.test(msg) ||
        /\brejected\b/.test(msg)
      if (!isRejection) continue
      rejections.push(ev)
    }

    // Extract first sentence for comparison: text before the first ". " (or whole msg)
    const firstSentence = (ev) => {
      const msg = (ev.msg ?? '').replace(/\s+/g, ' ').trim()
      const cut = msg.indexOf('. ')
      return (cut >= 0 ? msg.slice(0, cut) : msg).toLowerCase()
    }

    // First-sentence strict-prefix dedup:
    //   For each pair, if A's first sentence is a strict prefix of B's first sentence,
    //   A is the summary form and B is the full prose.  Mark A as merged-into-B.
    const mergedInto = new Map()  // index → index of the richer entry
    const absorbedIds = new Map() // index-of-kept → Set of ids from absorbed entries

    for (let i = 0; i < rejections.length; i++) {
      if (mergedInto.has(i)) continue
      const fsI = firstSentence(rejections[i])
      for (let j = 0; j < rejections.length; j++) {
        if (i === j || mergedInto.has(j)) continue
        const fsJ = firstSentence(rejections[j])
        if (fsJ === fsI) continue  // exact — handled by seenLabels below
        // Determine which is the prefix (shorter first sentence = summary form)
        if (fsI.startsWith(fsJ + ' ') || fsI === fsJ) {
          // fsJ is prefix of fsI → rejections[i] is the longer (full prose), j is summary
          mergedInto.set(j, i)
          const jId = rejections[j].data?.id
          if (jId) {
            if (!absorbedIds.has(i)) absorbedIds.set(i, new Set())
            absorbedIds.get(i).add(jId)
          }
        } else if (fsJ.startsWith(fsI + ' ') || fsJ === fsI) {
          // fsI is prefix of fsJ → rejections[j] is the longer (full prose), i is summary
          mergedInto.set(i, j)
          const iId = rejections[i].data?.id
          if (iId) {
            if (!absorbedIds.has(j)) absorbedIds.set(j, new Set())
            absorbedIds.get(j).add(iId)
          }
          break  // i is now merged; skip remaining j comparisons
        }
      }
    }

    // Build labels for surviving (non-merged) events
    const seenLabels = new Set()
    const results = []
    for (let i = 0; i < rejections.length; i++) {
      if (mergedInto.has(i)) continue  // subsumed by a longer entry
      const ev   = rejections[i]
      const data = ev.data ?? {}
      let label  = data.id
        ? `[${data.id}] ${data.title ?? ev.msg}`
        : (data.title ?? ev.msg)

      // Append ids absorbed from shorter summary-form entries (P-E: keep prose, surface id)
      const extra = absorbedIds.get(i)
      if (extra?.size) {
        label += ` (${[...extra].join(', ')})`
      }

      const key = label.toLowerCase().trim()
      if (!seenLabels.has(key)) { seenLabels.add(key); results.push(label) }
    }
    return results
  } catch {
    return []
  }
}

/**
 * Return all journal events for a motive (all types, newest first).
 * Used to feed the ticket generator with related events.
 */
function _readAllMotiveEvents(projectDir, motive) {
  const journalDir = join(projectDir, '.groundwork', 'journal')
  if (!existsSync(journalDir)) return []
  try {
    const all            = readAllEvents(journalDir)
    const { shown = [] } = filterEvents(all, { motive })
    return shown.slice().reverse()  // newest first
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

function _renderMap({ motive, charter, slices, ledgerDoc = null, decisions, outOfScope, rejectionDecisions = [] }) {
  const parts = []

  parts.push(`# MAP: ${motive}`)
  parts.push('')

  // ── Destination ───────────────────────────────────────────────────────────
  parts.push('## Destination')
  parts.push('')
  const objective = charter?.objective?.trim()
  if (objective) {
    parts.push(objective)
  } else {
    parts.push('_No objective recorded yet._')
  }
  parts.push('')

  // ── Decisions so far ──────────────────────────────────────────────────────
  parts.push('## Decisions so far')
  parts.push('')
  if (decisions.length) {
    for (const d of decisions) {
      const ts  = (d.ts ?? '').slice(0, 10)
      const msg = d.msg ?? JSON.stringify(d.data ?? '')
      parts.push(`- ${ts ? `[${ts}] ` : ''}${msg}`)
    }
  } else {
    parts.push('_No decisions recorded yet._')
  }
  parts.push('')

  // ── Frontier ──────────────────────────────────────────────────────────────
  const completeIds    = new Set(slices.filter((s) => s.status === 'complete').map((s) => s.id))
  const inProgressList = slices.filter(
    (s) => s.status === 'in_progress' || (s.claimed_by && s.status !== 'complete'),
  )
  const blockedList = slices.filter((s) => {
    if (s.status === 'complete' || s.status === 'in_progress') return false
    if (s.claimed_by) return false
    const deps = _deps(s)
    return deps.length > 0 && deps.some((d) => !completeIds.has(d))
  })
  const frontierList = slices.filter((s) => {
    if (s.status === 'complete' || s.status === 'in_progress') return false
    if (s.claimed_by) return false
    const deps = _deps(s)
    return deps.every((d) => completeIds.has(d))
  })

  parts.push('## Frontier')
  parts.push('')
  parts.push('_Slices that can start now (no pending blockers):_')
  parts.push('')
  if (frontierList.length) {
    for (const s of frontierList) {
      parts.push(`- ${_sliceLink(s.id)} — ${s.desc ?? '(no description)'}`)
    }
  } else {
    parts.push(
      '_No frontier slices — everything is in progress, blocked, or complete._',
    )
  }
  parts.push('')

  // ── In progress / Blocked ─────────────────────────────────────────────────
  if (inProgressList.length || blockedList.length) {
    parts.push('## In progress / Blocked')
    parts.push('')
    if (inProgressList.length) {
      parts.push('**In progress:**')
      parts.push('')
      for (const s of inProgressList) {
        const claim = s.claimed_by ? ` _(claimed by ${s.claimed_by})_` : ''
        parts.push(`- ${_sliceLink(s.id)}${claim} — ${s.desc ?? '(no description)'}`)
      }
      parts.push('')
    }
    if (blockedList.length) {
      parts.push('**Blocked:**')
      parts.push('')
      for (const s of blockedList) {
        const pending = _deps(s).filter((d) => !completeIds.has(d))
        parts.push(
          `- ${_sliceLink(s.id)} — ${s.desc ?? '(no description)'} _(waiting on: ${pending.join(', ')})_`,
        )
      }
      parts.push('')
    }
  }

  // ── Open items ────────────────────────────────────────────────────────────
  parts.push('## Open items')
  parts.push('')
  const openItems = charter?.open_items ?? []
  if (openItems.length) {
    for (const item of openItems) {
      const owner   = item.owner      ? ` @${item.owner}`                    : ''
      const blocker = item.blocked_by ? ` _(blocked by ${item.blocked_by})_` : ''
      const statement = (item.statement ?? '').replace(/\s*\n\s*/g, ' ').trim()
      parts.push(`- ${_openItemLink(item.id)}: ${statement}${owner}${blocker}`)
    }
  } else {
    parts.push('_No open items._')
  }
  parts.push('')

  // ── Out of scope ──────────────────────────────────────────────────────────
  parts.push('## Out of scope')
  parts.push('')
  const charterOos = charter?.out_of_scope?.trim()
  // Ignore the boilerplate comment stub that the template inserts
  const hasCharterOos =
    charterOos &&
    !charterOos.startsWith('<!--') &&
    charterOos.length > 0
  if (hasCharterOos) {
    parts.push(charterOos)
    parts.push('')
  }

  // Merge dir entries and rejection decisions, deduplicated (case-insensitive)
  const seenOos = new Set()
  const allOos  = []
  for (const entry of [...outOfScope, ...rejectionDecisions]) {
    const key = entry.toLowerCase().trim()
    if (!seenOos.has(key)) { seenOos.add(key); allOos.push(entry) }
  }
  if (allOos.length) {
    for (const entry of allOos) {
      parts.push(`- ${entry}`)
    }
  } else if (!hasCharterOos) {
    parts.push('_Nothing explicitly ruled out yet._')
  }
  parts.push('')

  // ── Progress ──────────────────────────────────────────────────────────────
  if (slices.length > 0) {
    const doneSlices = slices.filter((s) => s.status === 'complete')
    parts.push('## Progress')
    parts.push('')
    parts.push(`${doneSlices.length} / ${slices.length} slices complete`)
    if (doneSlices.length > 0) {
      parts.push('')
      for (const s of doneSlices) {
        const desc = s.desc ? ` — ${s.desc}` : ''
        parts.push(`- ✓ ${_sliceLink(s.id)}${desc}`)
      }
    }
    parts.push('')
  }

  // ── Pacing ────────────────────────────────────────────────────────────────
  if (ledgerDoc?.pacing) {
    const pacing      = ledgerDoc.pacing
    const budget      = pacing.budget ?? 1
    const grant       = pacing.grant ?? null
    const grantRange  = grant?.range ?? 0
    const cap         = budget + grantRange
    const unitWord    = pacing.policy === 'wave' ? 'wave' : 'slice'
    const resolved    = resolvedUnits(ledgerDoc)
    const inflight    = inFlightUnit(ledgerDoc)
    const exhausted   = isExhausted(ledgerDoc)

    parts.push('## Pacing')
    parts.push('')

    const budgetLine = grantRange > 0
      ? `**Policy:** ${pacing.policy} · **Budget:** ${budget} ${unitWord}${budget === 1 ? '' : 's'} + ${grantRange} via autopilot (cap ${cap})`
      : `**Policy:** ${pacing.policy} · **Budget:** ${budget} ${unitWord}${budget === 1 ? '' : 's'}`
    parts.push(budgetLine)
    parts.push(`**Consumption:** ${resolved} of ${cap} ${unitWord}${cap === 1 ? '' : 's'} resolved — ${resolved < cap ? 'new unit may be started' : 'budget consumed'}`)

    if (inflight !== null) {
      const label = pacing.policy === 'wave' ? `wave ${inflight}` : `"${inflight}"`
      parts.push(`**In-flight ${unitWord}:** ${label}`)
    }

    if (grant) {
      const grantedBy  = grant.granted_by ? ` by ${grant.granted_by}` : ''
      const grantedAt  = grant.granted_at ? ` (${String(grant.granted_at).slice(0, 10)})` : ''
      const reason     = grant.reason     ? ` — ${grant.reason}`      : ''
      parts.push(`**Autopilot grant:** +${grant.range} ${unitWord}${grant.range === 1 ? '' : 's'}${grantedBy}${grantedAt}${reason}`)
    }

    if (exhausted) {
      const exemptKinds = pacing.exempt_kinds ?? []
      const remaining   = (ledgerDoc.slices ?? []).filter(
        (s) => !exemptKinds.includes(s.kind) && s.status !== 'complete',
      )
      const ids = remaining.map((s) => s.id).join(', ')
      parts.push(`**Session exhausted.** Run \`/groundwork:handoff\` and open a new session. Remaining work: ${ids || '(none listed)'}`)
    }

    parts.push('')
  }

  // Footer
  parts.push('---')
  parts.push(
    '_Auto-generated — refreshed automatically by ledger/journal CLIs. Do not edit by hand._',
  )

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

/**
 * Render a slice id as a Markdown link to its ticket, or bold text if unsanitizable.
 */
function _sliceLink(id) {
  const safe = sanitizeId(id)
  return safe ? `[${id}](tickets/${safe}.md)` : `**${id}**`
}

/**
 * Render an open-item id as a Markdown link to its ticket, or bold text if unsanitizable.
 */
function _openItemLink(id) {
  const safe = sanitizeId(id)
  return safe ? `[${id}](tickets/${safe}.md)` : `**${id}**`
}
