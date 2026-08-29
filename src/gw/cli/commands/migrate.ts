import { type GwEnvelope, okEnvelope, errEnvelope } from '../envelope.js'
import { migrate } from '../../migrate/index.js'

export async function run(args: string[], cwd: string): Promise<GwEnvelope> {
  let dryRun = false
  let motiveFilter: string | undefined
  let legacyTracker: string | undefined

  const remaining = [...args]
  while (remaining.length > 0) {
    const flag = remaining.shift()!
    if (flag === '--dry-run') { dryRun = true }
    else if (flag === '--motive') { motiveFilter = remaining.shift() }
    else if (flag === '--root') { legacyTracker = remaining.shift() }
    else {
      return errEnvelope('migrate', 'USAGE_ERROR',
        `Unknown flag: ${flag}. Usage: gw migrate [--dry-run] [--motive <slug>] [--root <tracker>]`, 2)
    }
  }

  try {
    const result = await migrate({
      repoRoot: cwd,
      legacyTracker,
      motive: motiveFilter,
      dryRun,
    })
    return okEnvelope('migrate', { dry_run: dryRun, ...result })
  } catch (err) {
    return errEnvelope('migrate', 'MIGRATE_ERROR',
      err instanceof Error ? err.message : String(err), 1)
  }
}
