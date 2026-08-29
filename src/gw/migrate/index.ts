import { readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { readDecisionEvents } from './journal-reader.js'
import { migrateMotive } from './runner.js'

export type { MotiveMigrateReport } from './runner.js'

export interface MigrateResult {
  motives: import('./runner.js').MotiveMigrateReport[]
  summary: {
    total_motives: number
    total_tickets: number
    total_decisions: number
    total_synthetic_decisions: number
    total_open_items: number
    total_skipped_ephemeral: number
    lossy: string[]
  }
}

export async function migrate(opts: {
  repoRoot: string
  legacyTracker?: string
  nextTracker?: string
  motive?: string
  dryRun: boolean
}): Promise<MigrateResult> {
  const {
    repoRoot,
    legacyTracker = '.groundwork',
    nextTracker = '.groundwork/next',
    motive: motiveFilter,
    dryRun,
  } = opts

  // 1. Discover active motives
  const activeSlugs: string[] = []
  const activeMotivesDir = path.join(repoRoot, legacyTracker, 'motives')
  if (existsSync(activeMotivesDir)) {
    try {
      const entries = await readdir(activeMotivesDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (entry.name.startsWith('.')) continue
        if (entry.name === 'archive') continue
        activeSlugs.push(entry.name)
      }
    } catch {
      // ignore
    }
  }

  // 2. Discover archived motives
  const archivedSlugs: string[] = []
  const archiveMotivesDir = path.join(repoRoot, legacyTracker, 'archive', 'motives')
  if (existsSync(archiveMotivesDir)) {
    try {
      const entries = await readdir(archiveMotivesDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (entry.name.startsWith('.')) continue
        archivedSlugs.push(entry.name)
      }
    } catch {
      // ignore
    }
  }

  // 3. Filter by motive if specified
  const activeFiltered = motiveFilter
    ? activeSlugs.filter(s => s === motiveFilter)
    : activeSlugs
  const archivedFiltered = motiveFilter
    ? archivedSlugs.filter(s => s === motiveFilter)
    : archivedSlugs

  // 4. Read all journal DECISION events
  const { events: decisionEventsByMotive, skippedEphemeral } = await readDecisionEvents({
    repoRoot,
    legacyTracker,
  })

  // 5. Fan out migrateMotive in parallel
  const tasks: Promise<import('./runner.js').MotiveMigrateReport>[] = []

  for (const slug of activeFiltered) {
    tasks.push(migrateMotive({
      slug,
      kind: 'active',
      sourceDir: path.join(repoRoot, legacyTracker, 'motives', slug),
      repoRoot,
      nextTracker,
      decisionEvents: decisionEventsByMotive.get(slug) ?? [],
      dryRun,
    }))
  }

  for (const slug of archivedFiltered) {
    tasks.push(migrateMotive({
      slug,
      kind: 'archived',
      sourceDir: path.join(repoRoot, legacyTracker, 'archive', 'motives', slug),
      repoRoot,
      nextTracker,
      decisionEvents: decisionEventsByMotive.get(slug) ?? [],
      dryRun,
    }))
  }

  const motives = await Promise.all(tasks)

  // 6. Aggregate summary
  const summary = {
    total_motives: motives.length,
    total_tickets: motives.reduce((sum, m) => sum + m.tickets, 0),
    total_decisions: motives.reduce((sum, m) => sum + m.decisions, 0),
    total_synthetic_decisions: motives.reduce((sum, m) => sum + m.synthetic_decisions, 0),
    total_open_items: motives.reduce((sum, m) => sum + m.open_items, 0),
    total_skipped_ephemeral: skippedEphemeral,
    lossy: motives.flatMap(m => m.lossy),
  }

  return { motives, summary }
}
