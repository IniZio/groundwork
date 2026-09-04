import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

export interface JournalDecisionEvent {
  ts: string
  motive: string
  session: string
  data?: Record<string, unknown>
  msg?: string
  rfc?: string
}

interface ReadDecisionEventsResult {
  events: Map<string, JournalDecisionEvent[]>
  skippedEphemeral: number
}

export async function readDecisionEvents(opts: {
  repoRoot: string
  legacyTracker: string
}): Promise<ReadDecisionEventsResult> {
  const { repoRoot, legacyTracker } = opts

  const journalDirs: string[] = []
  const activeDir = path.join(repoRoot, legacyTracker, 'journal')
  const archiveDir = path.join(repoRoot, legacyTracker, 'archive', 'journal')
  if (existsSync(activeDir)) journalDirs.push(activeDir)
  if (existsSync(archiveDir)) journalDirs.push(archiveDir)

  const allEvents: JournalDecisionEvent[] = []
  let skippedEphemeral = 0

  for (const dir of journalDirs) {
    let files: string[]
    try {
      files = await readdir(dir)
    } catch {
      continue
    }

    for (const file of files.filter(f => f.endsWith('.jsonl'))) {
      let raw: string
      try {
        raw = await readFile(path.join(dir, file), 'utf8')
      } catch {
        continue
      }

      for (const line of raw.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue

        let parsed: Record<string, unknown>
        try {
          parsed = JSON.parse(trimmed) as Record<string, unknown>
        } catch {
          continue
        }

        if (parsed['type'] !== 'DECISION') continue

        const motive = parsed['motive'] as string | undefined
        if (!motive) continue

        if (motive.startsWith('session:')) {
          skippedEphemeral++
          continue
        }

        allEvents.push({
          ts: String(parsed['ts'] ?? ''),
          motive,
          session: String(parsed['session'] ?? ''),
          data: parsed['data'] !== undefined
            ? (parsed['data'] as Record<string, unknown>)
            : undefined,
          msg: parsed['msg'] !== undefined ? String(parsed['msg']) : undefined,
          rfc: parsed['rfc'] !== undefined ? String(parsed['rfc']) : undefined,
        })
      }
    }
  }

  // Sort by ts ascending
  allEvents.sort((a, b) => a.ts.localeCompare(b.ts))

  const events = new Map<string, JournalDecisionEvent[]>()
  for (const event of allEvents) {
    const arr = events.get(event.motive)
    if (arr) {
      arr.push(event)
    } else {
      events.set(event.motive, [event])
    }
  }

  return { events, skippedEphemeral }
}
