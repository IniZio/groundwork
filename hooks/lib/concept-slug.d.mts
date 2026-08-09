// Type declarations for concept-slug.mjs

/** Convert a free-form string to a URL-safe slug. */
export declare function toSlug(str: string): string

/** Normalize a shell command string for fingerprinting (strips flags, etc.). */
export declare function normalizeCommand(cmd: string): string

/** Compute a stable fingerprint for a command string. */
export declare function commandFingerprint(cmd: string): string
