// Type declarations for ensure-git-exclude.mjs

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
 * @param projectDir  Absolute path to the project root.
 */
export declare function ensureGroundworkExcluded(projectDir: string): void
