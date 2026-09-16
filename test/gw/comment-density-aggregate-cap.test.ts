/**
 * test/gw/comment-density-aggregate-cap.test.ts
 *
 * Verifies that an aggregate density breach does NOT appear in `files` and
 * that the manifest labels the aggregate cap as unenforced (S39-DENSITY-AGGREGATE).
 *
 * This test uses a constructed fixture — 97 code lines + 3 plain comment lines
 * (3.0/100) — that is intentionally above AGGREGATE_CAP (2) but below FILE_CAP (5).
 * It will fail if aggregate enforcement is ever wired up, making the gap visible.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { buildManifest } from '#src/gw/cli/commands/comment-density.js'

describe('comment-density aggregate cap (S39-DENSITY-AGGREGATE)', () => {
  let tmpDir: string

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  it('aggregate breach does not appear in files and aggregateEnforced is false', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cd-agg-'))

    const lines: string[] = []
    for (let i = 1; i <= 97; i++) lines.push(`const v${i} = ${i}`)
    lines.push('// aggregate-breach 1')
    lines.push('// aggregate-breach 2')
    lines.push('// aggregate-breach 3')
    writeFileSync(join(tmpDir, 'agg.ts'), lines.join('\n'))

    const manifest = await buildManifest(['agg.ts'], tmpDir)

    expect(manifest.aggregatePer100).toBeGreaterThan(manifest.cap.aggregate)
    expect(manifest.files.length).toBe(0)
    expect(manifest.aggregateEnforced).toBe(false)
  })
})
