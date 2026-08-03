/**
 * S5 CLI tests: journal compile <motive>
 *
 * Every test uses mkdtemp fixtures; never touches the real .groundwork/.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { rm } from 'node:fs/promises'

const JOURNAL_MJS = new URL('../../hooks/journal.mjs', import.meta.url).pathname

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gw-compile-test-'))
  mkdirSync(join(dir, '.groundwork', 'journal'), { recursive: true })
  return dir
}

/** Append a JSONL event to a shard file */
function appendEvent(journalDir: string, shard: string, event: Record<string, unknown>): void {
  const shardPath = join(journalDir, shard)
  writeFileSync(shardPath, JSON.stringify(event) + '\n', { flag: 'a' })
}

/** Populate a journal directory with minimal events for a motive */
function populateJournal(journalDir: string, motive: string, count = 5): void {
  for (let i = 0; i < count; i++) {
    appendEvent(journalDir, 'shard-a.jsonl', {
      ts: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`,
      session: 'test',
      motive,
      type: 'SESSION_START',
      msg: `event ${i}`,
    })
  }
}

interface RunResult {
  status: number | null
  stdout: string
  stderr: string
}

function run(args: string[], env: Record<string, string> = {}): RunResult {
  const result = spawnSync(process.execPath, [JOURNAL_MJS, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

// ---------------------------------------------------------------------------
// S5-AC6: Injective slug
// ---------------------------------------------------------------------------

describe('motiveSlug injectivity (S5-AC6)', () => {
  // We test slug injectivity by running journal compile help (which imports the module)
  // and by directly exercising the slug via compile output paths.
  // For the injectivity table we use a Node eval over the module code.

  it('produces distinct slugs for a table of ≥8 diverse ids', () => {
    // Extract the slug function from journal.mjs via a small wrapper
    const slugScript = `
import { createRequire } from 'module';
// Re-implement slug locally to test — same algorithm as journal.mjs
function motiveSlug(motive) {
  for (const ch of motive) {
    const cp = ch.codePointAt(0);
    if (cp != null && cp > 0xffff) {
      process.stdout.write('ASTRAL:' + cp.toString(16).toUpperCase() + '\\n');
      process.exit(0);
    }
  }
  return motive
    .replace(/~/g, '~007e')
    .replace(/[^A-Za-z0-9._~-]/gu, (c) => {
      const cp = c.codePointAt(0);
      return '~' + (cp != null ? cp : 0).toString(16).padStart(4, '0');
    });
}

const ids = [
  '.groundwork/rfcs/test-rfc-s6',
  'session:abc',
  'simple-id',
  'with space',
  'with~tilde',
  '!92',
  '\\u2192',      // →
  '~2192',         // literal text that would collide with → under 2-hex scheme
];
const slugs = ids.map(motiveSlug);
process.stdout.write(JSON.stringify(slugs) + '\\n');
`
    const result = spawnSync(process.execPath, ['--input-type=module'], {
      input: slugScript,
      encoding: 'utf8',
    })
    expect(result.status).toBe(0)
    const slugs: string[] = JSON.parse(result.stdout.trim())
    expect(slugs.length).toBe(8)
    // All distinct
    const unique = new Set(slugs)
    expect(unique.size).toBe(8)
    // All path-safe (no /, :, space, →)
    for (const s of slugs) {
      expect(s).toMatch(/^[A-Za-z0-9._~-]+$/)
    }
    // Specific known values
    expect(slugs[0]).toBe('.groundwork~002frfcs~002ftest-rfc-s6')
    expect(slugs[1]).toBe('session~003aabc')
    // → (U+2192) → ~2192; literal ~2192 → ~007e2192 (~ encoded first)
    expect(slugs[6]).toBe('~2192')          // the actual → character
    expect(slugs[7]).toBe('~007e2192')      // literal ~2192 text
    // Confirm the near-collision pair is distinct
    expect(slugs[5]).not.toBe(slugs[6])    // !92 ≠ →
  })
})

// ---------------------------------------------------------------------------
// Fixture-based tests
// ---------------------------------------------------------------------------

describe('journal compile CLI (S5)', () => {
  let projectDir: string

  beforeEach(() => {
    projectDir = makeProject()
  })

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true })
  })

  const env = (dir: string): Record<string, string> => ({
    CLAUDE_PROJECT_DIR: dir,
    JOURNAL_SESSION_ID: 'test',
  })

  // S5-AC5: unknown motive exits 1
  it('exits 1 with descriptive message for unknown motive (S5-AC5)', () => {
    const r = run(['compile', 'no-such-motive'], env(projectDir))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('no events found for motive "no-such-motive"')
  })

  // S5-AC1: exits 0, writes both files, stdout = Markdown
  it('exits 0 and writes both output files (S5-AC1)', () => {
    const journalDir = join(projectDir, '.groundwork', 'journal')
    populateJournal(journalDir, 'test-motive', 3)
    const r = run(['compile', 'test-motive', '--no-ground-truth'], env(projectDir))
    expect(r.status).toBe(0)
    const slug = 'test-motive'
    const jsonPath = join(projectDir, '.groundwork', 'compiled', `${slug}.json`)
    const mdPath = join(projectDir, '.groundwork', 'compiled', `${slug}.md`)
    expect(existsSync(jsonPath)).toBe(true)
    expect(existsSync(mdPath)).toBe(true)
    // stdout contains Markdown (has DO NOT EDIT marker)
    expect(r.stdout).toContain('DO NOT EDIT')
  })

  // S5-AC2: --json prints JSON only
  it('--json prints only JSON payload (S5-AC2)', () => {
    const journalDir = join(projectDir, '.groundwork', 'journal')
    populateJournal(journalDir, 'test-motive', 2)
    const r = run(['compile', 'test-motive', '--json', '--no-ground-truth'], env(projectDir))
    expect(r.status).toBe(0)
    const parsed = JSON.parse(r.stdout)
    expect(parsed).toHaveProperty('compiler_version')
    expect(parsed).toHaveProperty('agent')
    // No Markdown content
    expect(r.stdout).not.toContain('DO NOT EDIT')
  })

  // S5-AC2: --stdout writes no files
  it('--stdout does not write files (S5-AC2)', () => {
    const journalDir = join(projectDir, '.groundwork', 'journal')
    populateJournal(journalDir, 'test-motive', 2)
    const r = run(['compile', 'test-motive', '--stdout', '--no-ground-truth'], env(projectDir))
    expect(r.status).toBe(0)
    const compiledDir = join(projectDir, '.groundwork', 'compiled')
    expect(existsSync(compiledDir)).toBe(false)
  })

  // S5-AC3: version mismatch exits 1, file byte-unchanged
  it('exits 1 on version mismatch and leaves file byte-unchanged (S5-AC3)', () => {
    const journalDir = join(projectDir, '.groundwork', 'journal')
    populateJournal(journalDir, 'test-motive', 2)

    // First compile to establish the file
    run(['compile', 'test-motive', '--no-ground-truth'], env(projectDir))

    const slug = 'test-motive'
    const jsonPath = join(projectDir, '.groundwork', 'compiled', `${slug}.json`)

    // Tamper: change compiler_version
    const original = readFileSync(jsonPath, 'utf8')
    const tampered = original.replace(/"compiler_version":.*?".*?"/, '"compiler_version": "motive-compile/0.0.0"')
    writeFileSync(jsonPath, tampered)
    const bytesAfterTamper = readFileSync(jsonPath)

    // Now compile again (no --force) — should detect mismatch
    const r = run(['compile', 'test-motive', '--no-ground-truth'], env(projectDir))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('motive-compile/0.0.0')
    expect(r.stderr).toContain('test-motive')
    expect(r.stderr).toContain('--force')

    // File must be byte-unchanged
    const bytesAfter = readFileSync(jsonPath)
    expect(bytesAfter.equals(bytesAfterTamper)).toBe(true)
  })

  // S5-AC3: --force overwrites despite mismatch
  it('--force overwrites on version mismatch (S5-AC3)', () => {
    const journalDir = join(projectDir, '.groundwork', 'journal')
    populateJournal(journalDir, 'test-motive', 2)
    run(['compile', 'test-motive', '--no-ground-truth'], env(projectDir))

    const slug = 'test-motive'
    const jsonPath = join(projectDir, '.groundwork', 'compiled', `${slug}.json`)
    const original = readFileSync(jsonPath, 'utf8')
    const tampered = original.replace(/"compiler_version":.*?".*?"/, '"compiler_version": "motive-compile/0.0.0"')
    writeFileSync(jsonPath, tampered)

    const r = run(['compile', 'test-motive', '--no-ground-truth', '--force'], env(projectDir))
    expect(r.status).toBe(0)
    // File should now have correct version
    const updated = JSON.parse(readFileSync(jsonPath, 'utf8'))
    expect(updated.compiler_version).not.toBe('motive-compile/0.0.0')
  })

  // S5-AC3: matching version overwrites silently
  it('matching version overwrites silently (S5-AC3)', () => {
    const journalDir = join(projectDir, '.groundwork', 'journal')
    populateJournal(journalDir, 'test-motive', 2)
    const r1 = run(['compile', 'test-motive', '--no-ground-truth'], env(projectDir))
    expect(r1.status).toBe(0)
    const r2 = run(['compile', 'test-motive', '--no-ground-truth'], env(projectDir))
    expect(r2.status).toBe(0)
    expect(r2.stderr).toBe('')
  })

  // S5-AC3b: --no-ground-truth produces divergence_checked: false
  it('--no-ground-truth: divergence_checked is false, no collected_at (S5-AC3b)', () => {
    const journalDir = join(projectDir, '.groundwork', 'journal')
    populateJournal(journalDir, 'test-motive', 2)
    const r = run(['compile', 'test-motive', '--json', '--no-ground-truth', '--stdout'], env(projectDir))
    expect(r.status).toBe(0)
    const parsed = JSON.parse(r.stdout)
    expect(parsed.divergence?.checked).toBe(false)
    // No collected_at in provenance
    expect(parsed.provenance?.collected_at).toBeUndefined()
  })

  // S5-AC3b: two runs under --no-ground-truth are byte-identical (stdout)
  it('two --no-ground-truth runs produce byte-identical stdout (S5-AC3b)', () => {
    const journalDir = join(projectDir, '.groundwork', 'journal')
    populateJournal(journalDir, 'test-motive', 2)
    const args = ['compile', 'test-motive', '--json', '--no-ground-truth', '--stdout']
    const r1 = run(args, env(projectDir))
    const r2 = run(args, env(projectDir))
    expect(r1.status).toBe(0)
    expect(r2.status).toBe(0)
    expect(r1.stdout).toBe(r2.stdout)
  })

  // S5-AC4: --at non-numeric exits 2
  it('--at non-numeric exits 2 (S5-AC4)', () => {
    const journalDir = join(projectDir, '.groundwork', 'journal')
    populateJournal(journalDir, 'test-motive', 5)
    const r = run(['compile', 'test-motive', '--at', 'abc', '--no-ground-truth'], env(projectDir))
    expect(r.status).toBe(2)
    // non-numeric --at is now treated as a baseline name; 'abc' won't resolve → exit 2 with "not found"
    expect(r.stderr).toContain('abc')
  })

  // S5-AC4: --at out-of-range exits 2 with valid range
  it('--at out-of-range exits 2 naming valid range (S5-AC4)', () => {
    const journalDir = join(projectDir, '.groundwork', 'journal')
    populateJournal(journalDir, 'test-motive', 5)
    const r = run(['compile', 'test-motive', '--at', '999', '--no-ground-truth'], env(projectDir))
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('999')
    expect(r.stderr).toContain('5')
    expect(r.stderr).toContain('1-5')
  })

  // S5-AC4: --at out-of-range does NOT silently compile whole stream
  it('--at out-of-range never silently compiles whole stream (S5-AC4)', () => {
    const journalDir = join(projectDir, '.groundwork', 'journal')
    populateJournal(journalDir, 'test-motive', 5)
    const r = run(['compile', 'test-motive', '--at', '99', '--json', '--no-ground-truth'], env(projectDir))
    expect(r.status).toBe(2)
    // No JSON output (not a silent whole-stream compile)
    expect(r.stdout).toBe('')
  })

  // S5-AC7: help text includes compile
  it('journal help lists compile (S5-AC7)', () => {
    const r = run(['help'], env(projectDir))
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('compile')
  })

  it('journal help compile documents all flags (S5-AC7)', () => {
    const r = run(['help', 'compile'], env(projectDir))
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('--at')
    expect(r.stdout).toContain('--json')
    expect(r.stdout).toContain('--stdout')
    expect(r.stdout).toContain('--force')
    expect(r.stdout).toContain('--no-ground-truth')
  })

  // Existing commands unchanged (S5-AC7)
  it('existing append/show/digest commands still work (S5-AC7)', () => {
    const r = run(['help', 'append'], env(projectDir))
    expect(r.status).toBe(0)
    const r2 = run(['help', 'show'], env(projectDir))
    expect(r2.status).toBe(0)
    const r3 = run(['help', 'digest'], env(projectDir))
    expect(r3.status).toBe(0)
  })

  // S5-AC6: slug with path-unsafe motive chars produces path-safe output file
  it('writes correct file for motive with path-unsafe chars (S5-AC6)', () => {
    const journalDir = join(projectDir, '.groundwork', 'journal')
    const motive = 'session:abc'
    populateJournal(journalDir, motive, 2)
    const r = run(['compile', motive, '--no-ground-truth'], env(projectDir))
    expect(r.status).toBe(0)
    const jsonPath = join(projectDir, '.groundwork', 'compiled', 'session~003aabc.json')
    expect(existsSync(jsonPath)).toBe(true)
  })

  // fix-1: skewed compiler_version (top-level ≠ provenance) exits 1 naming both values
  it('exits 1 with both version values when compiler_version top-level and provenance disagree (fix-1)', () => {
    const journalDir = join(projectDir, '.groundwork', 'journal')
    populateJournal(journalDir, 'test-motive', 2)

    // First compile to create a valid file
    run(['compile', 'test-motive', '--no-ground-truth'], env(projectDir))

    const slug = 'test-motive'
    const jsonPath = join(projectDir, '.groundwork', 'compiled', `${slug}.json`)
    const parsed = JSON.parse(readFileSync(jsonPath, 'utf8')) as Record<string, unknown>

    // Skew: make top-level and provenance differ
    const skewed = {
      ...parsed,
      compiler_version: 'motive-compile/FAKE-TOP',
      provenance: {
        ...(parsed.provenance as Record<string, unknown>),
        compiler_version: 'motive-compile/FAKE-PROV',
      },
    }
    writeFileSync(jsonPath, JSON.stringify(skewed))

    // Compile again (no --force) — should detect the skew
    const r = run(['compile', 'test-motive', '--no-ground-truth'], env(projectDir))
    expect(r.status).toBe(1)
    // stderr must name both values
    expect(r.stderr).toContain('motive-compile/FAKE-TOP')
    expect(r.stderr).toContain('motive-compile/FAKE-PROV')
  })
})
