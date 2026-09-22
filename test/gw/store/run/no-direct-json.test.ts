/**
 * D-110 guard: no direct JSON reads of the run-ledger outside src/gw/store/run/ (S84).
 *
 * ALLOWLIST — files that still read the ledger directly in wave 32:
 *   src/gw/cli/commands/ledger.ts           — wave-33 S93
 *   src/gw/hook/stop-gate.ts                — wave-33 S94
 *   src/gw/cli/commands/comment-density.ts  — will port with S93
 *   src/gw/cli/commands/commit-lint.ts      — will port with S93
 *
 * Excluded from the scan:
 *   src/gw/store/run/**               — blessed owner
 *   src/gw/lib/resolve-ledger-path*   — path helper, not a reader
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..')

const ALLOWLIST = new Set([
  'src/gw/cli/commands/ledger.ts',
  'src/gw/hook/stop-gate.ts',
  'src/gw/cli/commands/comment-density.ts',
  'src/gw/cli/commands/commit-lint.ts',
])

function isExcluded(relPath: string): boolean {
  return (
    relPath.startsWith('src/gw/store/run/') ||
    relPath.startsWith('src/gw/lib/resolve-ledger-path')
  )
}

/**
 * Returns true when a file directly reads run-ledger JSON.
 *
 * Pattern A: imports resolveLedgerPath AND calls readFileSync.
 * Pattern B: builds a .groundwork/runs or run.json path inline AND reads it.
 */
export function isDirectLedgerReader(content: string): boolean {
  if (content.includes('resolveLedgerPath') && /\breadFileSync\b/.test(content)) return true

  const buildsRunsPath =
    /['"`]\.groundwork['"`]\s*,\s*['"`]runs['"`]/.test(content) ||
    /['"`]\.groundwork['"`]\s*,\s*['"`]run\.json['"`]/.test(content) ||
    /\.groundwork\/runs/.test(content) ||
    /\.groundwork\/run\.json/.test(content)

  const readsJson =
    /JSON\.parse\s*\(\s*readFileSync/.test(content) ||
    /readdirSync\s*\([^)]*runs/.test(content)

  return buildsRunsPath && readsJson
}

function* walkDir(dir: string): Generator<string> {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return }
  for (const entry of entries) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) yield* walkDir(full)
    else if (entry.endsWith('.ts')) yield full
  }
}

function scanViolations(): string[] {
  const violations: string[] = []
  for (const root of [join(REPO_ROOT, 'src', 'gw', 'cli'), join(REPO_ROOT, 'src', 'gw', 'hook')]) {
    for (const absPath of walkDir(root)) {
      const relPath = relative(REPO_ROOT, absPath)
      if (isExcluded(relPath)) continue
      const content = readFileSync(absPath, 'utf8')
      if (isDirectLedgerReader(content) && !ALLOWLIST.has(relPath)) {
        violations.push(relPath)
      }
    }
  }
  return violations
}

describe('no-direct-json guard (D-110)', () => {
  it('RED PROOF — detector catches resolveLedgerPath + readFileSync pattern', () => {
    const seededContent = `
      import { resolveLedgerPath } from '../../lib/resolve-ledger-path.js'
      import { readFileSync } from 'node:fs'
      export function hackLedger(dir: string) {
        const p = resolveLedgerPath({ projectDir: dir })
        return JSON.parse(readFileSync(p, 'utf8'))
      }
    `
    expect(isDirectLedgerReader(seededContent)).toBe(true)
  })

  it('RED PROOF — inline path construction variant is also caught', () => {
    const seededContent = `
      import { join } from 'node:path'
      import { readFileSync } from 'node:fs'
      const p = join(dir, '.groundwork', 'runs', sessionId + '.json')
      return JSON.parse(readFileSync(p, 'utf8'))
    `
    expect(isDirectLedgerReader(seededContent)).toBe(true)
  })

  it('GREEN PROOF — non-ledger JSON reads are NOT flagged', () => {
    const okContent = `
      import { readFileSync } from 'node:fs'
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    `
    expect(isDirectLedgerReader(okContent)).toBe(false)
  })

  it('GREEN PROOF — regex string patterns are NOT flagged', () => {
    const okContent = `
      const LEDGER_RE = /\\.groundwork\\/(?:run\\.json|runs\\/[^/]+\\.json)/
      function checkPath(p: string): boolean { return LEDGER_RE.test(p) }
    `
    expect(isDirectLedgerReader(okContent)).toBe(false)
  })

  it('HEAD is green — no new violations outside allowlist', () => {
    const violations = scanViolations()
    expect(violations).toEqual([])
  })
})
