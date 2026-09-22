/**
 * src/gw/store/motive/journal-event.ts — Shared journal-event note writer.
 *
 * Writes one Markdown note per event under:
 *   <projectDir>/<tracker>/motives/<motive>/journal/<ISO-ts>-<TYPE>.md
 *
 * Frontmatter follows JournalEventSchema (ts, session, type, source, data).
 * Body = event.msg (empty string when absent).
 *
 * Replaces the inline note writer previously duplicated in journal.ts.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import matter from 'gray-matter'
import type { JournalEvent } from '../../schema/journal.js'
import { DEFAULT_TRACKER_PATH } from '../../schema/layout.js'

/** Sanitize ISO timestamp for use in a filename (replace : and . with -). */
function sanitizeTs(ts: string): string {
  return ts.replace(/:/g, '-').replace(/\./g, '-')
}

/**
 * Write a journal event as a Markdown note.
 *
 * @param opts.projectDir  Absolute project root (CLAUDE_PROJECT_DIR or cwd).
 * @param opts.motive      Motive slug.
 * @param opts.tracker     Tracker subdirectory (default: DEFAULT_TRACKER_PATH).
 * @param opts.event       Journal event to persist.
 * @returns                Absolute path of written note.
 */
export function writeJournalEvent(opts: {
  projectDir: string
  motive: string
  event: JournalEvent
  tracker?: string
}): string {
  const { projectDir, motive, event } = opts
  const tracker = opts.tracker ?? DEFAULT_TRACKER_PATH

  const ts = event.ts ?? new Date().toISOString()
  const sanitizedTs = sanitizeTs(ts)
  const noteFilename = `${sanitizedTs}-${event.type}.md`
  const journalDir = join(projectDir, tracker, 'motives', motive, 'journal')
  mkdirSync(journalDir, { recursive: true })
  const notePath = join(journalDir, noteFilename)

  const fm: Record<string, unknown> = {
    ts,
    session: event.session,
    type: event.type,
    source: event.source ?? 'cli:journal',
    data: event.data ?? {},
  }

  writeFileSync(notePath, matter.stringify(event.msg ?? '', fm), 'utf8')
  return notePath
}
