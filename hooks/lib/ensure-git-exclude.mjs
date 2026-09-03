// check-comments-exempt — hook lib; gitignore semantics documented inline
/**
 * Side-effect-free helper: ensure `.groundwork/` is excluded from git status
 * in the host project by writing to `.git/info/exclude` (never `.gitignore`).
 *
 * Importing this module is instant and safe — no top-level I/O, no stdin reads.
 * session-reminder.mjs calls ensureGroundworkExcluded at runtime; tests import
 * this module directly to avoid the hook's stdin execution path.
 */

import { existsSync, readFileSync, mkdirSync, appendFileSync, statSync } from 'node:fs'
import path from 'node:path'

/** Sentinel line we add to `.git/info/exclude`. */
const EXCLUDE_ENTRY = '.groundwork/'

/**
 * Normalise a raw gitignore/exclude line for comparison:
 * trim surrounding whitespace, strip a single leading `/` and trailing `/`.
 *
 * @param {string} line
 * @returns {string}
 */
function normaliseLine(line) {
  return line.trim().replace(/^\//, '').replace(/\/$/, '')
}

/**
 * Return true when `content` (from a gitignore-style file) already contains a
 * line that, normalised, equals `.groundwork`.
 *
 * @param {string} content
 * @returns {boolean}
 */
function alreadyContains(content) {
  return content.split('\n').some((l) => normaliseLine(l) === '.groundwork')
}

/**
 * Ensure `.groundwork/` is listed in `<projectDir>/.git/info/exclude` so
 * groundwork's runtime dir doesn't clutter the host repo's git status.
 *
 * Rules:
 * - If `<projectDir>/.git` does not exist → skip (not a git repo).
 * - If `<projectDir>/.git` is a FILE (worktree / submodule pointer) → skip.
 * - If `.groundwork` is already covered by `.gitignore` or `exclude` → no-op.
 * - Otherwise append `.groundwork/` to `exclude`, creating it if missing.
 * - All filesystem errors are swallowed — this helper always fails open.
 *
 * @param {string} projectDir  Absolute path to the project root.
 * @returns {void}
 */
export function ensureGroundworkExcluded(projectDir) {
  try {
    const gitPath = path.join(projectDir, '.git')

    // Not a git repo at all.
    if (!existsSync(gitPath)) return

    // Worktree / submodule: .git is a file, not a directory — skip.
    let stat
    try { stat = statSync(gitPath) } catch { return }
    if (!stat.isDirectory()) return

    // Already-ignored guard: check .gitignore first.
    const gitignorePath = path.join(projectDir, '.gitignore')
    if (existsSync(gitignorePath)) {
      try {
        const content = readFileSync(gitignorePath, 'utf8')
        if (alreadyContains(content)) return
      } catch { /* unreadable — fall through */ }
    }

    // Already-ignored guard: check .git/info/exclude.
    const excludePath = path.join(gitPath, 'info', 'exclude')
    if (existsSync(excludePath)) {
      try {
        const content = readFileSync(excludePath, 'utf8')
        if (alreadyContains(content)) return
        // Append, ensuring a preceding newline when the file doesn't end with one.
        const needsNewline = content.length > 0 && !content.endsWith('\n')
        appendFileSync(excludePath, (needsNewline ? '\n' : '') + EXCLUDE_ENTRY + '\n')
        return
      } catch { return }
    }

    // exclude doesn't exist yet — create it (the info/ dir should already exist
    // in any normal repo, but mkdirSync is cheap insurance).
    try {
      mkdirSync(path.join(gitPath, 'info'), { recursive: true })
      appendFileSync(excludePath, EXCLUDE_ENTRY + '\n')
    } catch { /* fail open */ }
  } catch { /* top-level guard — never throw */ }
}
