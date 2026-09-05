/**
 * Regression test: emitAcCoverageEvent must guard against an empty sessionId
 * and emit a diagnostic to stderr rather than silently writing a malformed event.
 */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emitAcCoverageEvent } from '../../src/gw/lib/journal-emit.js'

describe('emitAcCoverageEvent — sessionId guard', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stderrSpy: ReturnType<typeof vi.spyOn<any, any>>

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    stderrSpy.mockRestore()
  })

  it('writes diagnostic to stderr when sessionId is empty and does not throw', () => {
    expect(() => {
      emitAcCoverageEvent({
        projectDir: '/nonexistent/project',
        sessionId: '',
        motive: 'test-motive',
        sliceId: 'S1',
        coversAc: ['AC-1'],
      })
    }).not.toThrow()

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('AC_COVERAGE skipped'),
    )
  })

  it('writes the event to a shard file and emits no diagnostic when sessionId is valid', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'journal-emit-test-'))
    try {
      emitAcCoverageEvent({
        projectDir: tmpDir,
        sessionId: 'sess-valid-001',
        motive: 'test-motive',
        sliceId: 'S2',
        coversAc: ['AC-2', 'AC-3'],
      })

      // No diagnostic should have been written
      const diagnosticCalls = (stderrSpy.mock.calls as string[][]).filter(
        (args) =>
          typeof args[0] === 'string' && args[0].includes('AC_COVERAGE skipped'),
      )
      expect(diagnosticCalls).toHaveLength(0)

      // Shard file must exist under .groundwork/journal/
      const journalDir = join(tmpDir, '.groundwork', 'journal')
      const shards = readdirSync(journalDir)
      expect(shards.length).toBeGreaterThan(0)
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
