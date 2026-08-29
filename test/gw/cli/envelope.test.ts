import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

const REPO_ROOT = '/home/newman/.local/share/groundwork'
const CLI_PATH = path.join(REPO_ROOT, 'src/gw/cli/main.ts')

function runCli(args: string[], opts?: { cwd?: string }): {
  stdout: string
  stderr: string
  status: number | null
} {
  const result = spawnSync('bun', [CLI_PATH, ...args], {
    cwd: opts?.cwd ?? REPO_ROOT,
    encoding: 'utf8',
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
  }
}

function runJson(args: string[], opts?: { cwd?: string }) {
  const r = runCli([...args, '--json'], opts)
  return { ...r, envelope: JSON.parse(r.stdout) }
}

// Track temp files to clean up
const tmpFiles: string[] = []

function makeTmpFile(content: string, ext = '.md'): string {
  const p = path.join(os.tmpdir(), `gw-test-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`)
  fs.writeFileSync(p, content, 'utf8')
  tmpFiles.push(p)
  return p
}

afterEach(() => {
  for (const p of tmpFiles.splice(0)) {
    try { fs.rmSync(p, { force: true }) } catch { /* ignore */ }
  }
})

// ============================================================
// Group 1: envelope shape — success
// ============================================================
describe('Group 1 — envelope shape: success', () => {
  it('locate motive:test-slug → ok=true, exit=0, command=locate, data.path ends with test-slug', () => {
    const { envelope, status } = runJson(['locate', 'motive:test-slug'])
    expect(status).toBe(0)
    expect(envelope.ok).toBe(true)
    expect(envelope.exit).toBe(0)
    expect(envelope.command).toBe('locate')
    expect(typeof envelope.data.path).toBe('string')
    expect(envelope.data.path).toMatch(/test-slug/)
  })
})

// ============================================================
// Group 2: envelope shape — operational failure (exit 1)
// ============================================================
describe('Group 2 — envelope shape: operational failure (exit 1)', () => {
  it('cat /nonexistent/path/file.md → ok=false, exit=1, error.code=READ_ERROR', () => {
    const { envelope, status } = runJson(['cat', '/nonexistent/path/file.md'])
    expect(status).toBe(1)
    expect(envelope.ok).toBe(false)
    expect(envelope.exit).toBe(1)
    expect(envelope.error.code).toBe('READ_ERROR')
  })

  it('hook my-hook → exit=1 (hook command rejects unknown hook names without JSON output)', () => {
    // hook command does not emit JSON envelope — use runCli, not runJson
    const { stdout, stderr, status } = runCli(['hook', 'my-hook', '--json'])
    expect(status).toBe(1)
    const combined = stdout + stderr
    expect(combined).toMatch(/unknown hook|my-hook/)
  })

  it('migrate → ok=true, exit=0, data.dry_run=false', () => {
    // Run migrate in an isolated tmpdir so it doesn't write to the live store
    const migrateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-migrate-test-'))
    spawnSync('git', ['init', '-q'], { cwd: migrateDir, encoding: 'utf8' })
    const { envelope, status } = runJson(['migrate'], { cwd: migrateDir })
    try { fs.rmSync(migrateDir, { recursive: true, force: true }) } catch { /* ignore */ }
    expect(status).toBe(0)
    expect(envelope.ok).toBe(true)
    expect(envelope.exit).toBe(0)
    expect((envelope.data as { dry_run?: boolean }).dry_run).toBe(false)
  })
})

// ============================================================
// Group 3: envelope shape — usage error (exit 2)
// ============================================================
describe('Group 3 — envelope shape: usage error (exit 2)', () => {
  it('unknown-command → ok=false, exit=2, error.code=UNKNOWN_COMMAND', () => {
    const { envelope, status } = runJson(['unknown-command'])
    expect(status).toBe(2)
    expect(envelope.ok).toBe(false)
    expect(envelope.exit).toBe(2)
    expect(envelope.error.code).toBe('UNKNOWN_COMMAND')
  })

  it('cat (no path arg) → ok=false, exit=2, error.code=USAGE_ERROR', () => {
    const { envelope, status } = runJson(['cat'])
    expect(status).toBe(2)
    expect(envelope.ok).toBe(false)
    expect(envelope.exit).toBe(2)
    expect(envelope.error.code).toBe('USAGE_ERROR')
  })

  it('set-property (no args) → ok=false, exit=2, error.code=USAGE_ERROR', () => {
    const { envelope, status } = runJson(['set-property'])
    expect(status).toBe(2)
    expect(envelope.ok).toBe(false)
    expect(envelope.exit).toBe(2)
    expect(envelope.error.code).toBe('USAGE_ERROR')
  })
})

// ============================================================
// Group 4: exit codes without --json
// ============================================================
describe('Group 4 — exit codes without --json', () => {
  it('locate motive:x (no --json) → exits 0', () => {
    const { status } = runCli(['locate', 'motive:x'])
    expect(status).toBe(0)
  })

  it('cat /nonexistent/path.md (no --json) → exits 1', () => {
    const { status } = runCli(['cat', '/nonexistent/path.md'])
    expect(status).toBe(1)
  })

  it('cat (no path, no --json) → exits 2', () => {
    const { status } = runCli(['cat'])
    expect(status).toBe(2)
  })
})

// ============================================================
// Group 5: cat command
// ============================================================
describe('Group 5 — cat command', () => {
  it('cat <path> → ok=true, data.content equals file content', () => {
    const content = 'hello groundwork\n'
    const p = makeTmpFile(content)
    const { envelope, status } = runJson(['cat', p])
    expect(status).toBe(0)
    expect(envelope.ok).toBe(true)
    expect(envelope.data.content).toBe(content)
    expect(typeof envelope.data.path).toBe('string')
  })
})

// ============================================================
// Group 6: get-property and set-property
// ============================================================
describe('Group 6 — get-property and set-property', () => {
  it('get-property reads frontmatter title', () => {
    const p = makeTmpFile('---\ntitle: hello\n---\n')
    const { envelope, status } = runJson(['get-property', p, 'title'])
    expect(status).toBe(0)
    expect(envelope.ok).toBe(true)
    expect(envelope.data.value).toBe('hello')
    expect(envelope.data.key).toBe('title')
  })

  it('set-property updates frontmatter and reports new value', () => {
    const p = makeTmpFile('---\ntitle: hello\n---\n')
    const { envelope, status } = runJson(['set-property', p, 'title', 'world'])
    expect(status).toBe(0)
    expect(envelope.ok).toBe(true)
    expect(envelope.data.value).toBe('world')
    // Verify file was actually updated
    const updated = fs.readFileSync(p, 'utf8')
    expect(updated).toMatch(/title:\s*world/)
  })
})

// ============================================================
// Group 7: append
// ============================================================
describe('Group 7 — append', () => {
  it('append adds text to file and reports appended value', () => {
    const p = makeTmpFile('line1\n')
    const { envelope, status } = runJson(['append', p, 'line2'])
    expect(status).toBe(0)
    expect(envelope.ok).toBe(true)
    expect(envelope.data.appended).toBe('line2')
    const updated = fs.readFileSync(p, 'utf8')
    expect(updated).toContain('line1\n')
    expect(updated).toContain('line2')
  })
})

// ============================================================
// Group 8: help output
// ============================================================
describe('Group 8 — help output', () => {
  it('--help exits 0 and lists all command names', () => {
    const { stdout, status } = runCli(['--help'])
    expect(status).toBe(0)
    const commands = [
      'cat', 'locate', 'get-property', 'set-property', 'append', 'link',
      'hook', 'migrate', 'ledger', 'journal',
    ]
    for (const cmd of commands) {
      expect(stdout).toContain(cmd)
    }
  })

  it('no args exits 0 and prints help', () => {
    const { stdout, status } = runCli([])
    expect(status).toBe(0)
    expect(stdout.length).toBeGreaterThan(0)
  })
})

// ============================================================
// Group 9: ledger and journal — implemented commands, missing required flags
// ============================================================
describe('Group 9 — ledger and journal: missing required flags → USAGE_ERROR', () => {
  // All ledger subcommands require --motive → exit 2, USAGE_ERROR when omitted
  const ledgerCmds = ['status', 'add', 'complete', 'view', 'gate', 'abandon',
    'fog', 'frontier', 'claim', 'await-human', 'autopilot', 'scope-token', 'milestone-signoff']

  for (const subcmd of ledgerCmds) {
    it(`gw ledger ${subcmd} (no --motive) → exit 2, USAGE_ERROR`, () => {
      const { envelope, status } = runJson(['ledger', subcmd])
      expect(status).toBe(2)
      expect(envelope.ok).toBe(false)
      expect(envelope.exit).toBe(2)
      expect(envelope.error.code).toBe('USAGE_ERROR')
    })
  }

  // journal append and compile require flags → exit 2, USAGE_ERROR
  for (const subcmd of ['append', 'compile']) {
    it(`gw journal ${subcmd} (no required flags) → exit 2, USAGE_ERROR`, () => {
      const { envelope, status } = runJson(['journal', subcmd])
      expect(status).toBe(2)
      expect(envelope.ok).toBe(false)
      expect(envelope.exit).toBe(2)
      expect(envelope.error.code).toBe('USAGE_ERROR')
    })
  }

  // journal show without --motive is valid (returns empty event list)
  it('gw journal show (no --motive) → exit 0, ok=true', () => {
    const { envelope, status } = runJson(['journal', 'show'])
    expect(status).toBe(0)
    expect(envelope.ok).toBe(true)
    expect(envelope.exit).toBe(0)
  })

  // Missing subcommand → usage error (exit 2)
  it('gw ledger (no subcmd) → exit 2, USAGE_ERROR', () => {
    const { envelope, status } = runJson(['ledger'])
    expect(status).toBe(2)
    expect(envelope.ok).toBe(false)
    expect(envelope.exit).toBe(2)
    expect(envelope.error.code).toBe('USAGE_ERROR')
  })

  it('gw journal (no subcmd) → exit 2, USAGE_ERROR', () => {
    const { envelope, status } = runJson(['journal'])
    expect(status).toBe(2)
    expect(envelope.ok).toBe(false)
    expect(envelope.exit).toBe(2)
    expect(envelope.error.code).toBe('USAGE_ERROR')
  })
})
