/**
 * motive-ref.mjs — Canonical form helper for ledger.motive_ref.
 *
 * CANONICAL FORM: SLUG (e.g. "my-feature").
 *
 * Historical prose documentation described motive_ref as a PATH
 * (`.groundwork/motives/<slug>/motive.md`), but all machine readers require a
 * slug. Passing a path silently produced wrong answers — the stop-gate
 * charter check failed to find a file that existed on disk, and motive-graph
 * silently skipped ledgers whose slug matched.
 *
 * This helper normalises both forms to a slug so callers are not sensitive to
 * which form an existing ledger on disk happens to carry.
 *
 * @param {unknown} motiveRef  The raw ledger.motive_ref value.
 * @returns {string|null}  The slug, or null if the value is empty/not a string.
 */
export function resolveMotiveSlug(motiveRef) {
  if (typeof motiveRef !== 'string' || motiveRef.length === 0) return null
  // Path form: extract slug as the segment after the last "motives/" component.
  // Handles relative (.groundwork/motives/my-feature/motive.md) and absolute
  // (/home/user/project/.groundwork/motives/my-feature/motive.md) paths.
  const match = motiveRef.match(/(?:^|[/\\])motives[/\\]([^/\\]+)/)
  if (match) return match[1]
  // Slug form: no path separators — return as-is.
  return motiveRef
}
