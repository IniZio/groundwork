// Type declarations for motive-ref.mjs

/**
 * Normalises a raw ledger.motive_ref value to a motive slug.
 *
 * Canonical form for `motive_ref` is a SLUG (e.g. `"my-feature"`).
 * Path-form values (`.groundwork/motives/my-feature/motive.md`) are accepted
 * and normalised — the slug is extracted from the path segment after `motives/`.
 *
 * Returns `null` for empty strings and non-string values.
 */
export declare function resolveMotiveSlug(motiveRef: unknown): string | null
