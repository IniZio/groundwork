/**
 * Regression guard: T17 — spec tree must render moc-typed concept nodes.
 *
 * ROOT CAUSE (verified): hooks/spec.mjs cmdTree line 675 filtered
 *   `n.type === 'concept'` only. Nodes with type: moc — including all 7
 *   child concepts under C-GROUNDWORK — were silently excluded from the
 *   tree walk and never printed.
 *
 * FIX: widened filter to `n.type === 'concept' || n.type === 'moc'`.
 *
 * RED→GREEN PROOF (from verification run):
 *   Before fix: `bin/spec tree` stdout contains only the root — C-MOC-CHILD absent → FAIL
 *   After fix:  `bin/spec tree` stdout contains both root and C-MOC-CHILD  → PASS
 *
 * ISOLATION: CLAUDE_PROJECT_DIR is overridden in the child process env to
 *   point at test/fixtures/spec/tree-fixture — the ambient CLAUDE_PROJECT_DIR
 *   and the real doc/specs/ are never consulted.
 */

import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(__dirname, '..')
const FIXTURE_PROJECT = join(__dirname, 'fixtures/spec/tree-fixture')
const BIN_SPEC = join(ROOT, 'bin/spec')

function runSpecTree(): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(BIN_SPEC, ['tree'], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: FIXTURE_PROJECT },
    cwd: ROOT,
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  }
}

describe('spec tree — moc-typed node rendering (T17)', () => {
  it('renders moc-typed child concepts in tree output', () => {
    const { stdout, stderr, status } = runSpecTree()
    expect(status, `spec tree exited non-zero\nstderr: ${stderr}`).toBe(0)
    // C-MOC-CHILD has type: moc — invisible before T17 fix, visible after
    expect(stdout, `full output:\n${stdout}`).toContain('C-MOC-CHILD')
  })

  it('renders the root concept node', () => {
    const { stdout } = runSpecTree()
    expect(stdout).toContain('C-TREE-ROOT')
  })
})
