/** Marker string embedded in every groundwork-managed commit-msg hook. */
export declare const HOOK_MARKER: string

/** Returns true if the hook content was written by groundwork. */
export declare function isGroundworkHook(content: string): boolean

/**
 * Render a complete commit-msg hook script.
 * The script detects bun/node at runtime; if neither is on PATH it prints
 * one diagnostic line to stderr and exits 0 so the commit proceeds.
 */
export declare function renderCommitMsgHook(opts: {
  hooksLibPath: string
  version: string
}): string
