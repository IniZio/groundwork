import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import matter from 'gray-matter'
import { writeDecision } from '../../../../src/gw/store/motive/decision.js'

describe('writeDecision — motive wikilink (S23-MOTIVE-WIKILINK)', () => {
  it('AC-5: emits path-qualified wikilink for motive, not stem-only', async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'gw-decision-test-'))
    try {
      await writeDecision({
        repoRoot: tmp,
        tracker: '.groundwork',
        motive: 'my-project',
        data: {
          id: 'D-1',
          decision: 'Test decision',
          rationale: 'Test rationale',
          alternatives: [],
          motive: 'my-project',
        },
      })
      const dest = path.join(tmp, '.groundwork', 'motives', 'my-project', 'decisions', 'D-1.md')
      const raw = await readFile(dest, 'utf8')
      const { data: fm } = matter(raw)
      expect(fm.motive).toBe('[[motives/my-project/motive|my-project]]')
      expect(fm.motive).not.toBe('[[my-project]]')
    } finally {
      rmSync(tmp, { recursive: true })
    }
  })

  it('AC-5: already-wikilinked motive passes through unchanged', async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'gw-decision-test-'))
    try {
      const custom = '[[motives/custom/motive|custom]]'
      await writeDecision({
        repoRoot: tmp,
        tracker: '.groundwork',
        motive: 'custom',
        data: {
          id: 'D-2',
          decision: 'Another',
          rationale: 'Reason',
          alternatives: [],
          motive: custom,
        },
      })
      const dest = path.join(tmp, '.groundwork', 'motives', 'custom', 'decisions', 'D-2.md')
      const raw = await readFile(dest, 'utf8')
      const { data: fm } = matter(raw)
      expect(fm.motive).toBe(custom)
    } finally {
      rmSync(tmp, { recursive: true })
    }
  })
})
