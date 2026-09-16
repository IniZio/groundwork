/**
 * test/gw/comment-density-aggregate-cap.test.ts
 *
 * Verifies that a file at 3/100 density (below FILE_CAP=5) is NOT flagged,
 * and that aggregatePer100 is still reported as a measurement (S47-AGGREGATE-REMOVE).
 *
 * cap.aggregate and aggregateEnforced were removed in S47; this test confirms
 * the manifest no longer carries those fields and that file-level behaviour is unchanged.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { buildManifest } from '#src/gw/cli/commands/comment-density.js'

describe('comment-density aggregate fields removed (S47-AGGREGATE-REMOVE)', () => {
  let tmpDir: string

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  it('file at 3/100 density is not flagged and aggregatePer100 is measured', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cd-agg-'))

    const lines: string[] = []
    for (let i = 1; i <= 97; i++) lines.push(`const v${i} = ${i}`)
    lines.push('// comment 1')
    lines.push('// comment 2')
    lines.push('// comment 3')
    writeFileSync(join(tmpDir, 'agg.ts'), lines.join('\n'))

    const manifest = await buildManifest(['agg.ts'], tmpDir)

    expect(manifest.files.length).toBe(0)
    expect(manifest.aggregatePer100).toBeCloseTo(3, 0)
    expect((manifest as unknown as Record<string, unknown>)['cap']).not.toHaveProperty('aggregate')
    expect((manifest as unknown as Record<string, unknown>)['aggregateEnforced']).toBeUndefined()
  })
})
