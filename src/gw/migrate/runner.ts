import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import {
  fromLegacyCharter,
  writeCharter,
  fromLegacyTicket,
  writeTicket,
  fromLegacyDecision,
  writeDecision,
  checkDecisionExtrasCollision,
  fromLegacyOpenItems,
  writeOpenItem,
} from '../store/motive/index.js'
import type { JournalDecisionEvent } from './journal-reader.js'

export interface MotiveMigrateReport {
  slug: string
  kind: 'active' | 'archived'
  charter: 'ok' | 'error'
  charter_error?: string
  tickets: number
  decisions: number
  /** Decisions that had no canonical data.id — preserved with synthetic D-LEGACY-NNN id using msg as decision text. */
  synthetic_decisions: number
  open_items: number
  skipped_ephemeral: number
  lossy: string[]
  errors: string[]
}


export async function migrateMotive(opts: {
  slug: string
  kind: 'active' | 'archived'
  sourceDir: string
  repoRoot: string
  nextTracker: string
  decisionEvents: JournalDecisionEvent[]
  dryRun: boolean
}): Promise<MotiveMigrateReport> {
  const { slug, kind, sourceDir, repoRoot, nextTracker, decisionEvents, dryRun } = opts

  const report: MotiveMigrateReport = {
    slug,
    kind,
    charter: 'ok',
    tickets: 0,
    decisions: 0,
    synthetic_decisions: 0,
    open_items: 0,
    skipped_ephemeral: 0,
    lossy: [],
    errors: [],
  }

  // 1. Charter + open items
  const charterFile = path.join(sourceDir, 'motive.md')
  let openItems: ReturnType<typeof fromLegacyOpenItems> = []

  try {
    const charterRaw = await readFile(charterFile, 'utf8')
    const parsed = fromLegacyCharter(charterRaw)
    if (kind === 'archived') {
      parsed.fm['status'] = 'archived'
    }
    openItems = fromLegacyOpenItems(charterRaw, slug)

    if (!dryRun) {
      await writeCharter({
        repoRoot,
        tracker: nextTracker,
        motive: slug,
        fm: parsed.fm,
        body: parsed.body,
      })
    }
  } catch (err) {
    report.charter = 'error'
    report.charter_error = String(err)
  }

  // 2. Tickets
  const ticketsDir = path.join(sourceDir, 'tickets')
  if (existsSync(ticketsDir)) {
    let ticketFiles: string[] = []
    try {
      ticketFiles = (await readdir(ticketsDir)).filter(f => f.endsWith('.md'))
    } catch {
      // ignore unreadable tickets dir
    }

    for (const filename of ticketFiles) {
      const raw = await readFile(path.join(ticketsDir, filename), 'utf8')
      let fm: Record<string, unknown>
      let body: string
      try {
        const parsed = fromLegacyTicket(raw)
        fm = parsed.fm
        body = parsed.body
      } catch {
        // fromLegacyTicket may reject legacy status values not in the current enum;
        // fall back to raw matter parse so the ticket is still migrated losslessly.
        const parsed = matter(raw)
        fm = parsed.data as Record<string, unknown>
        body = parsed.content
      }
      try {
        if (!dryRun) {
          await writeTicket({
            repoRoot,
            tracker: nextTracker,
            motive: slug,
            filename,
            fm,
            body,
          })
        }
        report.tickets++
      } catch (err) {
        report.errors.push(`ticket ${filename}: ${String(err)}`)
      }
    }
  }

  // 3. Decisions
  for (let i = 0; i < decisionEvents.length; i++) {
    const event = decisionEvents[i]
    const rawId = event.data?.['id']
    const hasId = rawId !== undefined && String(rawId).trim() !== ''

    try {
      if (hasId) {
        const noteData = fromLegacyDecision(event)

        if (dryRun) {
          const collision = checkDecisionExtrasCollision(noteData)
          if (collision) throw new Error(collision)
        } else {
          await writeDecision({ repoRoot, tracker: nextTracker, motive: slug, data: noteData })
        }
      } else {
        // Msg-only event: preserve with synthetic ID using msg as decision text.
        // Counted in synthetic_decisions (not lossy[] — the content IS preserved).
        const syntheticId = `D-LEGACY-${String(i + 1).padStart(3, '0')}`
        report.synthetic_decisions++

        if (!dryRun) {
          await writeDecision({
            repoRoot,
            tracker: nextTracker,
            motive: slug,
            data: {
              id: syntheticId,
              decision: event.msg ?? '',
              rationale: '',
              alternatives: [],
              date: event.ts ? event.ts.slice(0, 10) : undefined,
              motive: slug,
            },
          })
        }
      }
      report.decisions++
    } catch (err) {
      report.errors.push(`decision event ts=${event.ts}: ${String(err)}`)
    }
  }

  // 4. Open items
  for (const item of openItems) {
    try {
      if (!dryRun) {
        await writeOpenItem({
          repoRoot,
          tracker: nextTracker,
          motive: slug,
          fm: item.fm,
          body: item.body,
        })
      }
      report.open_items++
    } catch (err) {
      report.errors.push(`open-item ${item.fm.id}: ${String(err)}`)
    }
  }

  return report
}
