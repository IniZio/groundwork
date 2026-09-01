import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const LINT = '/home/newman/.local/share/groundwork/hooks/spec-lint.mjs'

function runLint(cwd: string): { exit: number; stdout: string } {
  try {
    const stdout = execSync(`node ${LINT}`, { cwd, encoding: 'utf8' })
    return { exit: 0, stdout }
  } catch (e: any) {
    return { exit: e.status ?? 1, stdout: e.stdout ?? '' }
  }
}

function makeSpecTree(tmp: string): void {
  mkdirSync(join(tmp, 'doc', 'specs', 'test-concept', 'requirements'), { recursive: true })
  writeFileSync(join(tmp, 'doc', 'specs', 'test-concept', 'README.md'), `---
id: C-TEST-CONCEPT
type: concept
parent: null
title: Test Concept
summary: A test concept for lint verification.
---
`)
}

describe('spec-lint old-format-rejected rule', () => {
  it('rejects an individual requirement file with ## Statement format (red)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'spec-lint-old-'))
    try {
      makeSpecTree(tmp)
      writeFileSync(join(tmp, 'doc', 'specs', 'test-concept', 'requirements', 'test-concept-r-001.md'), `---
id: test-concept-r-001
type: requirement
concept: C-TEST-CONCEPT
criticality: must
verification: automated
---

## Statement

The system **shall** do something.

## Why

Without this, something breaks.

## Fit criterion

After doing it, the test passes.

## Verification procedure

**Automated** — unit tests.
`)
      const { exit, stdout } = runLint(tmp)
      expect(exit).toBe(1)
      expect(stdout).toMatch(/old-format-rejected/)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('accepts an individual requirement file with H2+bullets format (green)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'spec-lint-new-'))
    try {
      makeSpecTree(tmp)
      writeFileSync(join(tmp, 'doc', 'specs', 'test-concept', 'requirements', 'test-concept-r-001.md'), `---
id: test-concept-r-001
type: requirement
concept: C-TEST-CONCEPT
criticality: must
verification: automated
---

## TEST-CONCEPT-R-001 — A test requirement {#test-concept-r-001}

The system **shall** do something.

- **Why** — Without this, something breaks.
- **Fit criterion** — After doing it, the test passes.
- **Verification**: automated — unit tests.
- **Criticality**: must
`)
      const { exit, stdout } = runLint(tmp)
      // new-format file must not produce old-format-rejected or h3-heading-rejected
      expect(stdout).not.toMatch(/old-format-rejected/)
      expect(stdout).not.toMatch(/h3-heading-rejected/)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
