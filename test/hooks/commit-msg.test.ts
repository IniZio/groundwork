import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const HOOKS_DIR = join(REPO_ROOT, 'hooks')

let tempDir: string
let fileCounter = 0

function nextFile(): [string, string] {
  const name = `file${++fileCounter}.txt`
  return [name, join(tempDir, name)]
}

function tryCommit(
  msg: string,
  extraEnv: Record<string, string> = {},
): ReturnType<typeof spawnSync> {
  const [name, path] = nextFile()
  writeFileSync(path, String(fileCounter))
  execSync(`git add ${name}`, { cwd: tempDir })
  return spawnSync('git', ['commit', '-m', msg], {
    cwd: tempDir,
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
  })
}

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'gw-commit-msg-test-'))
  execSync('git init', { cwd: tempDir })
  execSync('git config user.email "test@example.com"', { cwd: tempDir })
  execSync('git config user.name "Test Runner"', { cwd: tempDir })
  // Point hooksPath at the real repo's tracked hooks/ directory.
  execSync(`git config core.hooksPath "${HOOKS_DIR}"`, { cwd: tempDir })
  // Create an initial commit bypassing the hook so tests start on a non-empty repo.
  writeFileSync(join(tempDir, 'README.md'), 'init')
  execSync('git add README.md', { cwd: tempDir })
  execSync('git commit --no-verify -m "init"', { cwd: tempDir })
})

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('commit-msg hook — deployed via real git commit', () => {
  it('positive control: invalid type is rejected (proves hook is not silently inert)', () => {
    const result = tryCommit('notavalidtype: this should be rejected by the hook')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('commit-msg')
  })

  it('valid subject-only message is accepted', () => {
    const result = tryCommit('feat: add initial implementation')
    expect(result.status).toBe(0)
  })

  it('valid message with scope is accepted', () => {
    const result = tryCommit('fix(hooks): correct subject line check')
    expect(result.status).toBe(0)
  })

  it('body content is rejected (BODY_MAX_LINES=0 — subject only policy)', () => {
    const result = tryCommit('feat: add something\n\nThis body line should be rejected')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('commit-msg')
  })

  it('GROUNDWORK_COMMIT_LINT=0 bypasses a message that would otherwise be rejected', () => {
    const result = tryCommit('notavalidtype: bypassed by kill-switch', {
      GROUNDWORK_COMMIT_LINT: '0',
    })
    expect(result.status).toBe(0)
  })

  it('attribution trailers stripped in place by real commit — Claude-Session removed from committed log', () => {
    const result = tryCommit('chore: update config\n\nClaude-Session: https://claude.ai/code/session_test')
    expect(result.status).toBe(0)
    const log = execSync('git log -1 --pretty=%B', {
      cwd: tempDir,
      encoding: 'utf8',
    })
    expect(log).toContain('chore: update config')
    expect(log).not.toContain('Claude-Session')
  })

  it('Co-Authored-By Claude trailer stripped — committed log clean', () => {
    const result = tryCommit('docs: update readme\n\nCo-Authored-By: Claude <noreply@anthropic.com>')
    expect(result.status).toBe(0)
    const log = execSync('git log -1 --pretty=%B', {
      cwd: tempDir,
      encoding: 'utf8',
    })
    expect(log).toContain('docs: update readme')
    expect(log).not.toContain('Co-Authored-By')
  })

  it('process vocabulary in subject is rejected', () => {
    const result = tryCommit('chore: third gate cycle pass')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('gate cycle')
  })

  it('subject over 72 characters is rejected', () => {
    const long = 'feat: ' + 'a'.repeat(73)
    const result = tryCommit(long)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('commit-msg')
  })

  it('AC-3 proof: exec bit is set on hooks/commit-msg (hooks/commit-msg deployed path assertion)', () => {
    const result = spawnSync('test', ['-x', join(HOOKS_DIR, 'commit-msg')], { encoding: 'utf8' })
    expect(result.status).toBe(0)
  })
})

describe('commit-msg hook — editor path (comment-line stripping)', () => {
  let editorTempDir: string
  let editorCounter = 0

  function makeEditor(content: string): string {
    const msgFile = join(editorTempDir, `msg-${++editorCounter}.txt`)
    const scriptFile = join(editorTempDir, `editor-${editorCounter}.sh`)
    writeFileSync(msgFile, content)
    writeFileSync(scriptFile, `#!/bin/sh\ncp '${msgFile}' "$1"\n`)
    chmodSync(scriptFile, 0o755)
    return scriptFile
  }

  function editorCommit(
    content: string,
    extraArgs: string[] = [],
    extraEnv: Record<string, string> = {},
  ): ReturnType<typeof spawnSync> {
    const name = `efile${editorCounter + 1}.txt`
    const path = join(tempDir, name)
    writeFileSync(path, String(editorCounter))
    execSync(`git add ${name}`, { cwd: tempDir })
    const editor = makeEditor(content)
    return spawnSync('git', ['commit', ...extraArgs], {
      cwd: tempDir,
      env: { ...process.env, ...extraEnv, GIT_EDITOR: editor, GIT_TERMINAL_PROMPT: '0' },
      encoding: 'utf8',
    })
  }

  beforeAll(() => {
    editorTempDir = mkdtempSync(join(tmpdir(), 'gw-commit-msg-editor-'))
  })

  afterAll(() => {
    rmSync(editorTempDir, { recursive: true, force: true })
  })

  it('case 1: editor commit with commit.template comment block is accepted', () => {
    const content =
      'feat: implement editor path fix\n\n# Please enter the commit message for your changes.\n# Lines starting with \'#\' will be ignored, and an empty message aborts\n# the commit.\n#\n# On branch main\n# Changes to be committed:\n#   modified:   hooks/commit-msg\n#\n'
    const result = editorCommit(content)
    expect(result.status).toBe(0)
  })

  it('case 2: editor commit with only git-generated comment block is accepted', () => {
    const content =
      'fix: another valid subject\n\n# On branch main\n# Changes to be committed:\n#\tnew file: efile2.txt\n#\n# Changes not staged for commit:\n#\t(use "git add <file>..." to update what will be committed)\n#\n'
    const result = editorCommit(content)
    expect(result.status).toBe(0)
  })

  it('case 3: git commit --amend reword via editor is accepted', () => {
    const content =
      'chore: amended subject via editor\n\n# Please enter the commit message for your changes.\n# Lines starting with \'#\' will be ignored\n#\n# On branch main\n#\n'
    const result = editorCommit(content, ['--amend'])
    expect(result.status).toBe(0)
  })

  it('case 4: real body content with comment lines is REJECTED (policy not weakened)', () => {
    const content =
      'feat: subject with real body\n\nThis is a real body line that must be rejected.\n\n# Please enter the commit message for your changes.\n# Lines starting with \'#\' will be ignored\n#\n'
    const result = editorCommit(content)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('body has')
  })

  it('case 5: attribution trailers stripped on editor path', () => {
    const content =
      'chore: editor commit with trailer\n\nClaude-Session: https://claude.ai/code/session_test\n\n# On branch main\n#\n'
    const result = editorCommit(content)
    expect(result.status).toBe(0)
    const log = execSync('git log -1 --pretty=%B', { cwd: tempDir, encoding: 'utf8' })
    expect(log).toContain('chore: editor commit with trailer')
    expect(log).not.toContain('Claude-Session')
  })

  it('case 6: custom core.commentChar (semicolon) is handled', () => {
    execSync('git config core.commentChar ";"', { cwd: tempDir })
    try {
      const content =
        'feat: custom comment char subject\n\n; On branch main\n; Changes to be committed:\n;   new file: efile6.txt\n;\n'
      const result = editorCommit(content)
      expect(result.status).toBe(0)
    } finally {
      execSync('git config --unset core.commentChar', { cwd: tempDir })
    }
  })

  // AC-3: scissors truncation must honour core.commentChar
  it('case 7: scissors mode with commentChar=";" — diff below scissors line is truncated, subject accepted', () => {
    execSync('git config core.commentChar ";"', { cwd: tempDir })
    execSync('git config commit.cleanup scissors', { cwd: tempDir })
    try {
      const scissorsLine = '; ------------------------ >8 ------------------------'
      const content =
        'feat: scissors semicolon subject\n' +
        scissorsLine + '\n' +
        'diff --git a/foo b/foo\n' +
        'index 000000..111111 100644\n' +
        '--- a/foo\n' +
        '+++ b/foo\n' +
        '@@ -0,0 +1 @@\n' +
        '+hello\n'
      const result = editorCommit(content)
      expect(result.status).toBe(0)
    } finally {
      execSync('git config --unset core.commentChar', { cwd: tempDir })
      execSync('git config --unset commit.cleanup', { cwd: tempDir })
    }
  })

  it('case 8 (control): scissors mode with default commentChar="#" — diff below scissors line is truncated, subject accepted', () => {
    execSync('git config commit.cleanup scissors', { cwd: tempDir })
    try {
      const scissorsLine = '# ------------------------ >8 ------------------------'
      const content =
        'fix: scissors hash control subject\n' +
        scissorsLine + '\n' +
        'diff --git a/foo b/foo\n' +
        'index 000000..111111 100644\n' +
        '--- a/foo\n' +
        '+++ b/foo\n' +
        '@@ -0,0 +1 @@\n' +
        '+hello\n'
      const result = editorCommit(content)
      expect(result.status).toBe(0)
    } finally {
      execSync('git config --unset commit.cleanup', { cwd: tempDir })
    }
  })

  it('case 9: real body content is still REJECTED even with scissors mode active (policy not weakened)', () => {
    execSync('git config commit.cleanup scissors', { cwd: tempDir })
    try {
      const scissorsLine = '# ------------------------ >8 ------------------------'
      // Real body content BEFORE the scissors line — must still be caught
      const content =
        'feat: subject with real body\n\nThis is a real body line that must be rejected.\n' +
        scissorsLine + '\n' +
        'diff --git a/foo b/foo\n'
      const result = editorCommit(content)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('body has')
    } finally {
      execSync('git config --unset commit.cleanup', { cwd: tempDir })
    }
  })
})
