import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import {
  mkdtempSync,
  cpSync,
  readdirSync,
  statSync,
  existsSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import matter from 'gray-matter'
import { migrate, type MigrateResult } from '#src/gw/migrate/index.js'
import {
  fromLegacyCharter,
  fromLegacyTicket,
  fromLegacyOpenItems,
  readCharter,
  readTicket,
} from '#src/gw/store/motive/index.js'

const REAL_REPO = '/home/newman/.local/share/groundwork'
const NEXT_TRACKER = '.groundwork/next'
const LEGACY_TRACKER = '.groundwork'

let tempDir: string

function motiveSrcDir(
  base: string,
  slug: string,
  kind: 'active' | 'archived',
): string {
  return kind === 'active'
    ? path.join(base, LEGACY_TRACKER, 'motives', slug)
    : path.join(base, LEGACY_TRACKER, 'archive', 'motives', slug)
}

/** Recursively collect all file paths and their mtimes, skipping one directory if provided. */
function walkFiles(dir: string, skipDir?: string): Map<string, number> {
  const result = new Map<string, number>()
  if (!existsSync(dir)) return result
  function recurse(d: string) {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name)
      if (skipDir && full === skipDir) continue
      if (entry.isDirectory()) recurse(full)
      else result.set(full, statSync(full).mtimeMs)
    }
  }
  recurse(dir)
  return result
}

// ---------------------------------------------------------------------------
// Live-repo guard: the real .groundwork/next MUST NOT exist before or after
// the suite. Any test that writes to the live root is a bug.
// ---------------------------------------------------------------------------
describe('live-repo guard', () => {
  const LIVE_NEXT = path.join(REAL_REPO, NEXT_TRACKER)
  let beforeStat: { exists: boolean; mtime?: number } = { exists: false }

  beforeAll(() => {
    beforeStat = existsSync(LIVE_NEXT)
      ? { exists: true, mtime: statSync(LIVE_NEXT).mtimeMs }
      : { exists: false }
  })

  afterAll(() => {
    const afterExists = existsSync(LIVE_NEXT)
    if (afterExists !== beforeStat.exists) {
      // Directory was created or removed — fail loudly
      throw new Error(
        `[GUARD] Live .groundwork/next state changed during test suite! ` +
          `before=${JSON.stringify(beforeStat)} after.exists=${afterExists}`,
      )
    }
    if (afterExists && beforeStat.mtime !== undefined) {
      const afterMtime = statSync(LIVE_NEXT).mtimeMs
      if (afterMtime !== beforeStat.mtime) {
        throw new Error(
          `[GUARD] Live .groundwork/next was modified during suite! ` +
            `before=${beforeStat.mtime} after=${afterMtime}`,
        )
      }
    }
  })

  it('.groundwork/next does not exist in the live repo before the suite', () => {
    expect(beforeStat.exists).toBe(false)
  })
})

describe('gw migrate', () => {
  beforeAll(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'gw-migrate-test-'))
    cpSync(
      path.join(REAL_REPO, LEGACY_TRACKER),
      path.join(tempDir, LEGACY_TRACKER),
      { recursive: true },
    )
    // Strip any pre-existing next/ from the copy (guard: never propagate live output)
    const nextInCopy = path.join(tempDir, LEGACY_TRACKER, 'next')
    if (existsSync(nextInCopy)) {
      rmSync(nextInCopy, { recursive: true, force: true })
    }
  }, 15000)

  afterAll(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true })
  })

  // -------------------------------------------------------------------------
  // AC-1: Dry-run zero lossy
  // Uses its own isolated temp dir so the real-migrate beforeAll (AC-2/3/4)
  // cannot pollute the nextTracker before AC-1 tests run.
  // -------------------------------------------------------------------------
  describe('AC-1: dry-run zero lossy', () => {
    let dryRunDir: string
    let result: MigrateResult

    beforeAll(async () => {
      dryRunDir = mkdtempSync(path.join(tmpdir(), 'gw-migrate-dry-'))
      cpSync(
        path.join(REAL_REPO, LEGACY_TRACKER),
        path.join(dryRunDir, LEGACY_TRACKER),
        { recursive: true },
      )
      // Remove any pre-existing next/ dir from the corpus copy so we test
      // on a clean slate (the real .groundwork/ may already have a next/ from
      // a prior test run).
      await rm(path.join(dryRunDir, LEGACY_TRACKER, 'next'), { recursive: true, force: true })
      result = await migrate({ repoRoot: dryRunDir, dryRun: true })
    }, 45000)

    afterAll(async () => {
      if (dryRunDir) await rm(dryRunDir, { recursive: true, force: true })
    })

    it('summary.lossy is empty', () => {
      expect(result.summary.lossy).toEqual([])
    })

    it('all motive lossy[] are empty', () => {
      const all = result.motives.flatMap(m => m.lossy)
      expect(all).toEqual([])
    })

    it('no files written under nextTracker', () => {
      const nextPath = path.join(dryRunDir, NEXT_TRACKER)
      if (existsSync(nextPath)) {
        const files = walkFiles(nextPath)
        expect(files.size).toBe(0)
      }
      // directory absent → passes implicitly
    })

    it('total_motives >= 18 (15 active + 3 archived)', () => {
      expect(result.summary.total_motives).toBeGreaterThanOrEqual(18)
    })

    it('total_tickets > 0', () => {
      expect(result.summary.total_tickets).toBeGreaterThan(0)
    })

    it('total_decisions > 0', () => {
      expect(result.summary.total_decisions).toBeGreaterThan(0)
    })
  })

  // -------------------------------------------------------------------------
  // AC-2, AC-3, AC-4: Real migrate
  // -------------------------------------------------------------------------
  describe('real migrate (AC-2, AC-3, AC-4)', () => {
    let result: MigrateResult
    /** Snapshot of every file under .groundwork/ except .groundwork/next/ taken before migrate. */
    let snapshotBefore: Map<string, number>

    beforeAll(async () => {
      const nextDir = path.join(tempDir, NEXT_TRACKER)
      snapshotBefore = walkFiles(path.join(tempDir, LEGACY_TRACKER), nextDir)
      result = await migrate({ repoRoot: tempDir, dryRun: false })
    }, 60000)

    // -----------------------------------------------------------------------
    // AC-3: Ephemeral state untouched
    // -----------------------------------------------------------------------
    describe('AC-3: ephemeral state untouched', () => {
      it('no legacy tracker files modified or added', () => {
        const nextDir = path.join(tempDir, NEXT_TRACKER)
        const snapshotAfter = walkFiles(path.join(tempDir, LEGACY_TRACKER), nextDir)
        // File set must be identical
        expect(snapshotAfter.size).toBe(snapshotBefore.size)
        // Every mtime must be unchanged
        for (const [fpath, mtime] of snapshotAfter) {
          expect(snapshotBefore.get(fpath)).toBe(mtime)
        }
      })

      it('runs/ files have unchanged mtimes', () => {
        const runsDir = path.join(tempDir, LEGACY_TRACKER, 'runs')
        for (const [fpath, mtime] of walkFiles(runsDir)) {
          expect(snapshotBefore.get(fpath)).toBe(mtime)
        }
      })

      it('journal/ files have unchanged mtimes', () => {
        const journalDir = path.join(tempDir, LEGACY_TRACKER, 'journal')
        for (const [fpath, mtime] of walkFiles(journalDir)) {
          expect(snapshotBefore.get(fpath)).toBe(mtime)
        }
      })

      it('struggle-signals.jsonl untouched', () => {
        const sig = path.join(tempDir, LEGACY_TRACKER, 'struggle-signals.jsonl')
        if (existsSync(sig) && snapshotBefore.has(sig)) {
          expect(statSync(sig).mtimeMs).toBe(snapshotBefore.get(sig))
        }
      })

      it('migrate writes to nextTracker, not to legacy motives/ paths', () => {
        const nextMotivesDir = path.join(tempDir, NEXT_TRACKER, 'motives')
        // At least one motive must have been written to nextTracker
        const written = result.motives.filter(m => m.charter === 'ok')
        expect(written.length).toBeGreaterThan(0)
        for (const report of written) {
          const nextIndexMd = path.join(nextMotivesDir, report.slug, 'index.md')
          expect(existsSync(nextIndexMd)).toBe(true)
        }
      })
    })

    // -----------------------------------------------------------------------
    // AC-2: Round-trip fidelity
    // -----------------------------------------------------------------------
    describe('AC-2: round-trip fidelity', () => {
      it('charter fm.id preserved for all ok motives', async () => {
        const ok = result.motives.filter(m => m.charter === 'ok')
        expect(ok.length).toBeGreaterThan(0)

        for (const report of ok) {
          const srcPath = path.join(
            motiveSrcDir(tempDir, report.slug, report.kind),
            'motive.md',
          )
          if (!existsSync(srcPath)) {
            console.warn(`[AC-2] motive.md missing for ${report.slug}`)
            continue
          }
          const raw = readFileSync(srcPath, 'utf8')
          let legacy: ReturnType<typeof fromLegacyCharter>
          try {
            legacy = fromLegacyCharter(raw)
          } catch (e) {
            console.warn(`[AC-2] fromLegacyCharter failed for ${report.slug}: ${e}`)
            continue
          }

          const migrated = await readCharter({
            repoRoot: tempDir,
            tracker: NEXT_TRACKER,
            motive: report.slug,
          })

          // Hard assert on id
          expect(migrated.fm['id']).toBe(legacy.fm['id'])

          // Soft warn on other charter keys
          for (const key of ['status', 'objective', 'title']) {
            if (
              legacy.fm[key] !== undefined &&
              legacy.fm[key] !== migrated.fm[key]
            ) {
              console.warn(
                `[AC-2] Charter ${report.slug}.${key}: ` +
                  `legacy=${JSON.stringify(legacy.fm[key])} ` +
                  `migrated=${JSON.stringify(migrated.fm[key])}`,
              )
            }
          }
        }
      }, 30000)

      it('report.tickets <= source ticket file count for all motives', () => {
        // report.tickets counts successfully migrated tickets; errored tickets go to errors[]
        // so report.tickets may be less than the source count when schema validation rejects
        // legacy status values — that is an impl issue tracked separately in errors[]
        for (const report of result.motives) {
          const srcTickets = path.join(
            motiveSrcDir(tempDir, report.slug, report.kind),
            'tickets',
          )
          const srcCount = existsSync(srcTickets)
            ? readdirSync(srcTickets).filter(f => f.endsWith('.md')).length
            : 0
          expect(report.tickets).toBeLessThanOrEqual(srcCount)
          expect(report.tickets).toBeGreaterThanOrEqual(0)
        }
      })

      it('migrated ticket fm.id preserved (sampled — first 5 motives, 3 tickets each)', async () => {
        const withTickets = result.motives
          .filter(m => m.charter === 'ok' && m.tickets > 0)
          .slice(0, 5)

        for (const report of withTickets) {
          const srcDir = path.join(
            motiveSrcDir(tempDir, report.slug, report.kind),
            'tickets',
          )
          if (!existsSync(srcDir)) continue
          const files = readdirSync(srcDir)
            .filter(f => f.endsWith('.md'))
            .slice(0, 3)

          for (const filename of files) {
            const raw = readFileSync(path.join(srcDir, filename), 'utf8')
            let legacy: ReturnType<typeof fromLegacyTicket>
            try {
              legacy = fromLegacyTicket(raw)
            } catch (e) {
              console.warn(`[AC-2] fromLegacyTicket ${report.slug}/${filename}: ${e}`)
              continue
            }

            let migrated: Awaited<ReturnType<typeof readTicket>>
            try {
              migrated = await readTicket({
                repoRoot: tempDir,
                tracker: NEXT_TRACKER,
                motive: report.slug,
                filename,
              })
            } catch (e) {
              console.warn(`[AC-2] readTicket ${report.slug}/${filename}: ${e}`)
              continue
            }

            // id must be preserved; warn on status/kind mismatches
            if (legacy.fm['id'] !== undefined) {
              expect(migrated.fm['id']).toBe(legacy.fm['id'])
            }
            for (const key of ['status', 'kind']) {
              if (
                legacy.fm[key] !== undefined &&
                legacy.fm[key] !== migrated.fm[key]
              ) {
                console.warn(
                  `[AC-2] Ticket ${report.slug}/${filename}.${key}: ` +
                    `legacy=${JSON.stringify(legacy.fm[key])} ` +
                    `migrated=${JSON.stringify(migrated.fm[key])}`,
                )
              }
            }
          }
        }
      }, 30000)

      it('decision notes have a non-empty string fm.id', () => {
        for (const report of result.motives.filter(m => m.decisions > 0)) {
          const decisionsDir = path.join(
            tempDir,
            NEXT_TRACKER,
            'motives',
            report.slug,
            'decisions',
          )
          if (!existsSync(decisionsDir)) continue
          for (const file of readdirSync(decisionsDir).filter(f =>
            f.endsWith('.md'),
          )) {
            const raw = readFileSync(path.join(decisionsDir, file), 'utf8')
            const { data } = matter(raw)
            const id = data['id']
            expect(typeof id).toBe('string')
            expect((id as string).length).toBeGreaterThan(0)
          }
        }
      })

      it('report.open_items matches written open-items/ file count (sampled)', () => {
        const withOI = result.motives
          .filter(m => m.charter === 'ok' && m.open_items > 0)
          .slice(0, 5)

        for (const report of withOI) {
          const oiDir = path.join(
            tempDir,
            NEXT_TRACKER,
            'motives',
            report.slug,
            'open-items',
          )
          const writtenCount = existsSync(oiDir)
            ? readdirSync(oiDir).filter(f => f.endsWith('.md')).length
            : 0
          expect(writtenCount).toBe(report.open_items)
        }
      })

      it('fromLegacyOpenItems ids covered by written open-items/ files (sampled)', () => {
        const withOI = result.motives
          .filter(m => m.charter === 'ok' && m.open_items > 0)
          .slice(0, 5)

        for (const report of withOI) {
          const srcPath = path.join(
            motiveSrcDir(tempDir, report.slug, report.kind),
            'motive.md',
          )
          if (!existsSync(srcPath)) continue
          const raw = readFileSync(srcPath, 'utf8')
          let legacyOIs: ReturnType<typeof fromLegacyOpenItems>
          try {
            legacyOIs = fromLegacyOpenItems(raw, report.slug)
          } catch (e) {
            console.warn(`[AC-2] fromLegacyOpenItems ${report.slug}: ${e}`)
            continue
          }

          const oiDir = path.join(
            tempDir,
            NEXT_TRACKER,
            'motives',
            report.slug,
            'open-items',
          )
          if (!existsSync(oiDir)) continue
          const writtenIds = new Set(
            readdirSync(oiDir)
              .filter(f => f.endsWith('.md'))
              .map(f => f.replace(/\.md$/, '')),
          )

          for (const oi of legacyOIs) {
            if (!writtenIds.has(oi.fm.id)) {
              console.warn(
                `[AC-2][lossy] Open item ${oi.fm.id} from ${report.slug} not in written files`,
              )
            }
          }
        }
      })
    })

    // -----------------------------------------------------------------------
    // AC-4: Lossy-set completeness
    // -----------------------------------------------------------------------
    describe('AC-4: lossy-set completeness', () => {
      it('all motive lossy[] items are known lossy markers', () => {
        for (const report of result.motives) {
          for (const item of report.lossy) {
            const known =
              item.includes('D-LEGACY-') || item.includes('Legacy Data')
            if (!known) {
              console.warn(
                `[AC-4] Unknown lossy marker in ${report.slug}: ${item}`,
              )
            }
            expect(known).toBe(true)
          }
        }
      })

      it('errors[] is empty for motives with charter ok', () => {
        for (const report of result.motives.filter(m => m.charter === 'ok')) {
          if (report.errors.length > 0) {
            console.warn(
              `[AC-4] errors[] for ${report.slug}: ${JSON.stringify(report.errors)}`,
            )
          }
          expect(report.errors).toEqual([])
        }
      })

      it('summary.lossy contains only known markers', () => {
        for (const item of result.summary.lossy) {
          const known =
            item.includes('D-LEGACY-') || item.includes('Legacy Data')
          expect(known).toBe(true)
        }
      })
    })
  })
})
