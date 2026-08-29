/**
 * test/fixtures/parity-corpus/capture-shim-guard.test.ts
 *
 * Verifies that per-hook capture scripts refuse to run when the target hook is a
 * gw shim (hooks/<name>.mjs contains 'src/gw/cli/main.ts').
 *
 * Because all hooks are now shims (D-10 conversion), running any capture script
 * must exit non-zero and print a REFUSED/shim message — ensuring the frozen
 * parity corpus cannot be accidentally overwritten.
 */

import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const CORPUS_DIR = new URL('.', import.meta.url).pathname

describe('capture shim guard', () => {
  it('nesting-guard capture exits non-zero with REFUSED message when hook is a shim', () => {
    const script = join(CORPUS_DIR, 'nesting-guard', 'capture.mjs')
    const result = spawnSync('node', [script], { encoding: 'utf8' })

    expect(result.status, 'exit code should be non-zero (shim detected)').not.toBe(0)
    const stderrLower = (result.stderr ?? '').toLowerCase()
    const hasRefusedOrShim = stderrLower.includes('refused') || stderrLower.includes('shim')
    expect(hasRefusedOrShim, `stderr should contain "REFUSED" or "shim" — got: ${result.stderr}`).toBe(true)
  })
})
