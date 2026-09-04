/**
 * test/fixtures/parity-corpus/capture-shim-guard.test.ts
 *
 * Verifies that per-hook capture scripts refuse to run when the target hook is a
 * gw shim (hooks/<name>.mjs contains 'src/gw/cli/main.ts').
 *
 * Seven guards were DELETED (not converted) in wave 2 of groundwork-hardening; their
 * hooks/*.mjs shims no longer exist. Running any capture script against them exits
 * non-zero via an ENOENT branch — the file is gone, so capture is impossible and
 * the frozen parity corpus cannot be accidentally overwritten.
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
