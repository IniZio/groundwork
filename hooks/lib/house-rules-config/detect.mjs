import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

export const PRESET_HANDBOOK = 'handbook'
export const PRESET_CONVENTIONAL = 'conventional'
export const PRESET_SUBJECT_ONLY = 'subject-only'

// Type allowlist (not \w+) avoids false positives from WIP:/Fix: history.
export const CONVENTIONAL_SUBJECT_RE =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?: \S/

const COMMITLINT_CONFIG_FILES = [
  'commitlint.config.js', 'commitlint.config.cjs', 'commitlint.config.mjs',
  'commitlint.config.ts', 'commitlint.config.mts', 'commitlint.config.cts',
  'commitlint.config.json', 'commitlint.config.yaml', 'commitlint.config.yml',
  '.commitlintrc', '.commitlintrc.js', '.commitlintrc.cjs', '.commitlintrc.mjs',
  '.commitlintrc.ts', '.commitlintrc.json', '.commitlintrc.yaml', '.commitlintrc.yml',
]

export function hasGitMessage(repoRoot) {
  if (typeof repoRoot !== 'string' || repoRoot === '') return false
  return existsSync(join(repoRoot, '.gitmessage'))
}

export function hasCommitlintConfig(repoRoot) {
  for (const f of COMMITLINT_CONFIG_FILES) {
    if (existsSync(join(repoRoot, f))) return true
  }
  const pkgPath = join(repoRoot, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      if (pkg?.commitlint != null) return true
    } catch {
      return false
    }
  }
  return false
}

export function readLastSubjects(repoRoot, n = 20) {
  try {
    const out = execFileSync(
      'git',
      ['log', '--first-parent', '--no-merges', `-${n}`, '--format=%s'],
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
    return out.split('\n').filter(l => l.trim() !== '')
  } catch {
    return []
  }
}

export function detectPreset(repoRoot) {
  if (!repoRoot) return { value: PRESET_HANDBOOK, source: 'default' }
  if (hasGitMessage(repoRoot)) return { value: PRESET_SUBJECT_ONLY, source: 'gitmessage' }
  if (hasCommitlintConfig(repoRoot)) return { value: PRESET_CONVENTIONAL, source: 'commitlint' }
  const subjects = readLastSubjects(repoRoot, 20)
  if (subjects.length > 0) {
    const matched = subjects.filter(s => CONVENTIONAL_SUBJECT_RE.test(s)).length
    if (matched / subjects.length >= 0.5) return { value: PRESET_CONVENTIONAL, source: 'history' }
  }
  return { value: PRESET_HANDBOOK, source: 'default' }
}
