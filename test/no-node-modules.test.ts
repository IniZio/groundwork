/**
 * Regression test: bin/ledger and bin/spec must exit 0 without node_modules.
 *
 * The repo ships committed bundles (dist/hooks-ledger.mjs, dist/hooks-spec.mjs)
 * so remote plugin installs with no node_modules can run. This test rsync-copies
 * the repo (excluding node_modules) to a temp dir and asserts both CLIs exit 0.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../')

let tmpDir: string

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'gw-no-nm-test-'))
  const result = spawnSync(
    'rsync',
    ['-a', '--exclude=node_modules', '--exclude=.git', `${repoRoot}/`, `${tmpDir}/`],
    { encoding: 'utf8' },
  )
  if (result.status !== 0) {
    throw new Error(`rsync failed (exit ${result.status}): ${result.stderr}`)
  }
})

afterAll(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
})

describe('bin CLIs without node_modules', () => {
  test('bin/ledger exits 0', () => {
    const result = spawnSync(`${tmpDir}/bin/ledger`, ['help'], {
      env: { PATH: process.env.PATH ?? '' },
      encoding: 'utf8',
    })
    expect(
      result.status,
      `bin/ledger exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    ).toBe(0)
  })

  test('bin/spec exits 0', () => {
    const result = spawnSync(`${tmpDir}/bin/spec`, ['help'], {
      env: { PATH: process.env.PATH ?? '' },
      encoding: 'utf8',
    })
    expect(
      result.status,
      `bin/spec exited ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    ).toBe(0)
  })
})
