// check-comments-exempt — test; opening block documents the seam
/**
 * test/gw/cli/journal-compile-parity.test.ts
 *
 * AC-12 parity: gw journal compile (TypeScript, src/gw/cli/commands/journal.ts)
 * vs bin/journal compile (hooks/journal.mjs) must agree on decision IDs for every
 * slug in the committed fixture corpus.
 *
 * Store paths:
 *   gw reads:         .groundwork/motives/<slug>/decisions/*.md  (Obsidian-native)
 *   bin/journal reads: .groundwork/journal/*.jsonl                (legacy JSONL)
 *
 * gw invocation: bin/gw-hook journal compile <slug> --json --json
 *   main.ts strips the first --json (sets useJson=true for envelope output);
 *   journal.ts receives the second --json (sets useJson=true for JSON content).
 *   Parse: JSON.parse(JSON.parse(stdout).data.content).decisions[].id
 *
 * bin/journal invocation: node hooks/journal.mjs compile <slug> --stdout --json --no-ground-truth
 *   Parse: JSON.parse(stdout).agent.decision_log[].id
 *
 * Fixture: test/fixtures/journal-compile-parity/
 *   Both stores: alpha (D-1, D-2), beta (D-10, D-11), gamma (D-20)
 *   JSONL-only:  delta (D-30) — no decisions/*.md exists for this slug
 *
 * Bite proof (manual, not committed): seeding D-99 into parity.jsonl only causes
 * test 1 to fail: `slug "alpha": gw IDs=["D-1","D-2"] bin IDs=["D-1","D-2","D-99"]`
 *
 * delta (JSONL-only) FINDING: gw compile exits 0 with decisions=[] for delta;
 * bin/journal compile exits 0 with decision_log=[{id:"D-30"}]. gw does NOT detect
 * or report the divergence at compile time — no STORE_DIVERGENCE, no non-zero exit.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const REPO_ROOT = new URL('../../../', import.meta.url).pathname.replace(/\/$/, '')
const GW_HOOK = path.join(REPO_ROOT, 'bin/gw-hook')
const JOURNAL_MJS = path.join(REPO_ROOT, 'hooks/journal.mjs')
const FIXTURE = path.join(REPO_ROOT, 'test/fixtures/journal-compile-parity')

const cleanups: string[] = []
afterEach(() => {
  for (const d of cleanups.splice(0)) {
    try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

function tempDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-parity-'))
  cleanups.push(d)
  return d
}

function makeEnv(projectDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env['CLAUDE_PROJECT_DIR']
  delete env['CLAUDE_PLUGIN_ROOT']
  env['CLAUDE_PROJECT_DIR'] = projectDir
  env['CLAUDE_CODE_SESSION_ID'] = 'parity-test'
  env['JOURNAL_SESSION_ID'] = 'parity-test'
  return env
}

function runGw(slug: string, projectDir: string) {
  return spawnSync(GW_HOOK, ['journal', 'compile', slug, '--json', '--json'], {
    encoding: 'utf8',
    env: makeEnv(projectDir),
  })
}

function runBin(slug: string, projectDir: string) {
  return spawnSync(process.execPath, [
    JOURNAL_MJS, 'compile', slug, '--stdout', '--json', '--no-ground-truth',
  ], {
    encoding: 'utf8',
    env: makeEnv(projectDir),
  })
}

function gwIds(r: ReturnType<typeof spawnSync>): string[] {
  if (r.status !== 0) return []
  const env = JSON.parse(r.stdout as string) as { data: { content: string } }
  const s = JSON.parse(env.data.content) as { decisions: Array<{ id: string }> }
  return s.decisions.map(d => d.id).sort()
}

function binIds(r: ReturnType<typeof spawnSync>): string[] {
  if (r.status !== 0) return []
  const v = JSON.parse(r.stdout as string) as { agent?: { decision_log?: Array<{ id: string }> } }
  return (v.agent?.decision_log ?? []).map(d => d.id).sort()
}

function newStoreSlugs(projectDir: string): string[] {
  const dir = path.join(projectDir, '.groundwork', 'motives')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(f => fs.statSync(path.join(dir, f)).isDirectory()).sort()
}

function jsonlSlugs(projectDir: string): string[] {
  const dir = path.join(projectDir, '.groundwork', 'journal')
  if (!fs.existsSync(dir)) return []
  const seen = new Set<string>()
  for (const shard of fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'))) {
    for (const line of fs.readFileSync(path.join(dir, shard), 'utf8').split('\n').filter(Boolean)) {
      try { const e = JSON.parse(line); if (e.motive) seen.add(e.motive) } catch { /* skip */ }
    }
  }
  return Array.from(seen).sort()
}

describe('S76-AC12-COMPILE-PARITY — gw journal compile vs bin/journal compile', () => {

  describe('both-store slugs: decision IDs must agree', () => {
    it('each slug present in both stores yields equal decision ID sets', () => {
      const proj = tempDir()
      fs.cpSync(FIXTURE, proj, { recursive: true })

      const inNewStore = new Set(newStoreSlugs(proj))
      const inJsonl = new Set(jsonlSlugs(proj))
      const both = [...inNewStore].filter(s => inJsonl.has(s)).sort()

      expect(both.length, 'fixture must have ≥3 slugs in both stores').toBeGreaterThanOrEqual(3)

      for (const slug of both) {
        const gw = runGw(slug, proj)
        const bin = runBin(slug, proj)

        expect(gw.status, `gw compile exit for "${slug}": ${gw.stderr}`).toBe(0)
        expect(bin.status, `bin/journal compile exit for "${slug}": ${bin.stderr}`).toBe(0)

        const gIds = gwIds(gw)
        const bIds = binIds(bin)

        expect(gIds, `slug "${slug}": gw IDs=${JSON.stringify(gIds)} bin IDs=${JSON.stringify(bIds)}`).toEqual(bIds)
      }
    })
  })

  describe('JSONL-only slug: gw journal show must report STORE_DIVERGENCE', () => {
    it('gw exits 1 with STORE_DIVERGENCE when new store is empty but JSONL has shards', () => {
      const proj = tempDir()
      const journalDir = path.join(proj, '.groundwork', 'journal')
      fs.mkdirSync(journalDir, { recursive: true })
      fs.mkdirSync(path.join(proj, '.groundwork', 'motives'), { recursive: true })

      const fixtureShard = path.join(FIXTURE, '.groundwork', 'journal', 'parity.jsonl')
      const deltaLines = fs.readFileSync(fixtureShard, 'utf8')
        .split('\n').filter(l => {
          try { return JSON.parse(l).motive === 'delta' } catch { return false }
        })
      expect(deltaLines.length, 'fixture must have delta JSONL events').toBeGreaterThan(0)
      fs.writeFileSync(path.join(journalDir, 'parity-delta.jsonl'), deltaLines.join('\n') + '\n')

      const r = spawnSync(GW_HOOK, ['journal', 'show', '--json'], {
        cwd: proj,
        encoding: 'utf8',
        env: makeEnv(proj),
      })

      expect(r.status, 'must exit 1').toBe(1)
      const combined = (r.stdout ?? '') + (r.stderr ?? '')
      expect(combined).toMatch(/STORE_DIVERGENCE|diverge/i)
    })
  })

  describe('JSONL-only slug (delta): gw compile silently returns empty — FINDING', () => {
    it('gw exits 0 with decisions=[] for delta; bin/journal exits 0 with [D-30] — stores diverge undetected', () => {
      const proj = tempDir()
      fs.cpSync(FIXTURE, proj, { recursive: true })

      const inJsonl = new Set(jsonlSlugs(proj))
      const inNewStore = new Set(newStoreSlugs(proj))
      const jsonlOnly = [...inJsonl].filter(s => !inNewStore.has(s)).sort()
      expect(jsonlOnly, 'fixture must have ≥1 JSONL-only slug').not.toHaveLength(0)

      for (const slug of jsonlOnly) {
        const gw = runGw(slug, proj)
        const bin = runBin(slug, proj)

        expect(gw.status, `gw compile for JSONL-only "${slug}" must exit 0 (no STORE_DIVERGENCE at compile)`).toBe(0)
        expect(bin.status, `bin/journal compile for "${slug}" must exit 0`).toBe(0)

        const gIds = gwIds(gw)
        const bIds = binIds(bin)

        expect(gIds, `FINDING: gw sees no decisions for "${slug}" (reads decisions/*.md — dir absent)`).toEqual([])
        expect(bIds, `bin/journal must see decisions for "${slug}" from JSONL`).not.toHaveLength(0)
      }
    })
  })
})
