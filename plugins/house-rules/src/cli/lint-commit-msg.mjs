// Plain .mjs with node: imports only, so the commit-msg git hook can run it under node as well as bun.
import { readFileSync, realpathSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { resolveConfig, pointer } from '../config/resolve.mjs'
import { lintCommitMessage } from '../../rules/commit-message/lint.mjs'

function gitOut(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function cleanMessage(raw, { commentChar, cleanup, editorUsed }) {
  const mode = cleanup === 'default' ? (editorUsed ? 'strip' : 'whitespace') : cleanup
  if (mode === 'verbatim') return raw
  const char = commentChar === '' || commentChar === 'auto' ? '#' : commentChar
  let text = raw
  if (mode === 'scissors') {
    const cut = text.search(new RegExp(`^${escapeRe(char)} -+ >8 -+$`, 'm'))
    if (cut !== -1) text = text.slice(0, cut)
  }
  let lines = text.split('\n').map((l) => l.replace(/\s+$/, ''))
  if (mode === 'strip') lines = lines.filter((l) => !l.startsWith(char))
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '')
}

/** Returns the lint report, or null when the message passes or the repo does not configure house-rules. */
export function checkCommitMessage(cwd, raw, { editorUsed }) {
  const repoRoot = gitOut(cwd, ['rev-parse', '--show-toplevel'])
  if (repoRoot === '') return null
  let resolved
  try {
    resolved = resolveConfig(repoRoot)
  } catch {
    return null
  }
  if (resolved.file === null) return null

  const message = cleanMessage(raw, {
    commentChar: gitOut(repoRoot, ['config', '--get', 'core.commentChar']),
    cleanup: gitOut(repoRoot, ['config', '--get', 'commit.cleanup']) || 'default',
    editorUsed,
  })
  const { violations } = lintCommitMessage(message, { preset: resolved.rules['commit-message'].options.preset })
  if (violations.length === 0) return null
  const lines = [...violations].sort((a, b) => a.line - b.line).map((v) => `  line ${v.line}: ${v.reason}`)
  lines.push(`  set by ${resolved.file}: ${pointer(resolved, 'commit-message', 'preset')}`)
  return lines.join('\n')
}

export function runLintCommitMsg(file, cwd) {
  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch (err) {
    process.stderr.write(`house-rules lint-commit-msg: cannot read ${file}: ${err.message}\n`)
    return 2
  }
  // git sets GIT_EDITOR=: for the commit-msg hook when no editor ran, which selects whitespace cleanup.
  const report = checkCommitMessage(cwd, raw, { editorUsed: process.env.GIT_EDITOR !== ':' })
  if (report === null) return 0
  process.stderr.write(`house-rules: commit message rejected:\n${report}\n`)
  return 1
}

const invoked = process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : ''
if (invoked === import.meta.url) {
  if (!process.argv[2]) {
    process.stderr.write('usage: lint-commit-msg.mjs <commit-message-file>\n')
    process.exit(2)
  }
  process.exit(runLintCommitMsg(process.argv[2], process.cwd()))
}
