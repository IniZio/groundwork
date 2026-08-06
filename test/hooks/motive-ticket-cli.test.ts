// @ts-nocheck
/**
 * motive-ticket CLI tests — slice G8 (D-77/D-87)
 *
 * Covers:
 *   - create: scaffolds stub when absent; exits 0
 *   - create: idempotent — second call does NOT overwrite; prints "already exists"
 *   - create: auto-ordinal increments across distinct slugs
 *   - list: enumerates created tickets with their Type: fields (tab-separated)
 *   - list: reports "no tickets found" when motive has no tickets subdirectory
 *   - lint: research ticket with URL in Evidence → exit 0
 *   - lint: research ticket with requirement id (e.g. ARTIFACT-R-012) in Evidence → exit 0
 *   - lint: research ticket with ZERO resolvable refs → exit 1
 *   - lint: non-research (build) ticket with all sections filled → exit 0
 *
 * Env discipline: CLAUDE_PROJECT_DIR is always suppressed and then explicitly
 * injected per-test so no ambient project-dir leaks into fixtures
 * (see memory: ambient-project-dir-vacuous-tests).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')
const CLI = join(ROOT, 'hooks', 'motive-ticket.mjs')

/**
 * Run the motive-ticket CLI.
 * Ambient CLAUDE_PROJECT_DIR is always deleted first, then opts.env is applied.
 */
function run(
  args: string[],
  opts: { env?: Record<string, string> } = {},
): { stdout: string; stderr: string; status: number } {
  const env: Record<string, string> = { ...process.env }
  delete env.CLAUDE_PROJECT_DIR // suppress ambient to prevent vacuous assertions
  Object.assign(env, opts.env ?? {})

  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env,
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  }
}

function projectEnv(dir: string): Record<string, string> {
  return { CLAUDE_PROJECT_DIR: dir }
}

function mkProject(): string {
  return mkdtempSync(join(tmpdir(), 'motive-ticket-cli-test-'))
}

function makeMotiveDir(projectDir: string, slug: string): string {
  const motiveDir = join(projectDir, '.groundwork', 'motives', slug)
  mkdirSync(motiveDir, { recursive: true })
  return motiveDir
}

/**
 * Build a syntactically-complete ticket where all REQUIRED_SECTIONS
 * (Question, Context, Evidence, Decision, Ruled out, Revisions, Links)
 * have non-empty bodies.
 *
 * @param type        - ticket type string (controls Type: field)
 * @param evidenceBody - content for the Evidence section
 */
function filledTicket(type: string, evidenceBody = 'Some evidence here.'): string {
  return [
    `# test ticket`,
    ``,
    `Type: ${type}`,
    `Status: open`,
    `Blocked by: —`,
    ``,
    `## Question`,
    ``,
    `What is the right approach?`,
    ``,
    `## Context`,
    ``,
    `Relevant background information.`,
    ``,
    `## Evidence`,
    ``,
    evidenceBody,
    ``,
    `## Decision`,
    ``,
    `Use approach A.`,
    ``,
    `## Ruled out`,
    ``,
    `Approach B was discarded.`,
    ``,
    `## Revisions`,
    ``,
    `None yet.`,
    ``,
    `## Links`,
    ``,
    `No links.`,
    ``,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// create — idempotency
// ---------------------------------------------------------------------------

describe('motive-ticket create — idempotency', () => {
  let dir: string

  beforeEach(() => {
    dir = mkProject()
    makeMotiveDir(dir, 'my-motive')
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('scaffolds a stub on first call and exits 0', () => {
    const { status, stdout } = run(
      ['create', '--type', 'research', '--slug', 'my-topic', '--motive', 'my-motive'],
      { env: projectEnv(dir) },
    )
    expect(status).toBe(0)
    expect(stdout).toContain('created')
    expect(
      existsSync(
        join(dir, '.groundwork', 'motives', 'my-motive', 'tickets', '01-research-my-topic.md'),
      ),
    ).toBe(true)
  })

  it('does NOT overwrite on a second call — byte content is identical', () => {
    const createArgs = ['create', '--type', 'research', '--slug', 'idempotent', '--motive', 'my-motive']
    const env = { env: projectEnv(dir) }
    const ticketPath = join(
      dir, '.groundwork', 'motives', 'my-motive', 'tickets', '01-research-idempotent.md',
    )

    // First create — creates the file
    run(createArgs, env)
    const contentAfterFirst = readFileSync(ticketPath, 'utf8')

    // Second create — must not overwrite
    const { status, stdout } = run(createArgs, env)
    expect(status).toBe(0)
    expect(stdout).toContain('already exists, not overwritten')
    expect(readFileSync(ticketPath, 'utf8')).toBe(contentAfterFirst)
  })

  it('auto-ordinal increments for a second distinct slug', () => {
    const env = { env: projectEnv(dir) }
    run(['create', '--type', 'build', '--slug', 'first', '--motive', 'my-motive'], env)
    run(['create', '--type', 'build', '--slug', 'second', '--motive', 'my-motive'], env)
    const ticketsDir = join(dir, '.groundwork', 'motives', 'my-motive', 'tickets')
    expect(existsSync(join(ticketsDir, '01-build-first.md'))).toBe(true)
    expect(existsSync(join(ticketsDir, '02-build-second.md'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe('motive-ticket list', () => {
  let dir: string

  beforeEach(() => {
    dir = mkProject()
    makeMotiveDir(dir, 'my-motive')
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('enumerates all created tickets with their type fields in tab-separated output', () => {
    const env = { env: projectEnv(dir) }
    run(['create', '--type', 'research', '--slug', 'alpha', '--motive', 'my-motive'], env)
    run(['create', '--type', 'build', '--slug', 'beta', '--motive', 'my-motive'], env)

    const { status, stdout } = run(['list', '--motive', 'my-motive'], env)
    expect(status).toBe(0)

    // Output format per line: <relative/path>\t<type>\t<status>\t<title>
    const lines = stdout.trim().split('\n').filter((l) => l.includes('\t'))
    expect(lines).toHaveLength(2)
    const types = lines.map((l) => l.split('\t')[1])
    expect(types).toContain('research')
    expect(types).toContain('build')
  })

  it('reports "no tickets found" when the motive has no tickets subdirectory', () => {
    const { status, stdout } = run(
      ['list', '--motive', 'my-motive'],
      { env: projectEnv(dir) },
    )
    expect(status).toBe(0)
    expect(stdout).toContain('no tickets found')
  })
})

// ---------------------------------------------------------------------------
// lint — exit codes
// ---------------------------------------------------------------------------

describe('motive-ticket lint — exit codes', () => {
  let dir: string

  beforeEach(() => {
    dir = mkProject()
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function writeTicketFile(name: string, content: string): string {
    const p = join(dir, name)
    writeFileSync(p, content, 'utf8')
    return p
  }

  it('research ticket with URL in Evidence → exit 0', () => {
    const p = writeTicketFile(
      'r-url.md',
      filledTicket('research', 'See https://example.com/docs for details.'),
    )
    const { status, stdout } = run(['lint', p])
    expect(stdout).toContain('OK')
    expect(status).toBe(0)
  })

  it('research ticket with doc/specs requirement id in Evidence → exit 0', () => {
    const p = writeTicketFile(
      'r-req.md',
      filledTicket('research', 'Governed by ARTIFACT-R-012.'),
    )
    const { status, stdout } = run(['lint', p])
    expect(stdout).toContain('OK')
    expect(status).toBe(0)
  })

  it('research ticket with ZERO resolvable refs → exit 1', () => {
    const p = writeTicketFile(
      'r-no-ref.md',
      filledTicket(
        'research',
        'This section contains no URL, file path, or requirement identifier.',
      ),
    )
    const { status, stdout } = run(['lint', p])
    expect(stdout).toContain('FAIL')
    expect(status).not.toBe(0)
  })

  it('non-research (build) ticket with all sections filled → exit 0 (citation rule is skipped)', () => {
    // The citation rule only applies to "research" type; build tickets skip it.
    const p = writeTicketFile(
      'build-full.md',
      filledTicket('build', 'Concrete implementation plan using existing patterns.'),
    )
    const { status, stdout } = run(['lint', p])
    expect(stdout).toContain('OK')
    expect(status).toBe(0)
  })
})
