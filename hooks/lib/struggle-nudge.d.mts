// Type declarations for struggle-nudge.mjs

/**
 * Build a struggle-nudge string summarizing recent struggle signals for the project.
 * Returns an empty string when no signals are present or the nudge threshold is not met.
 */
export declare function buildStruggleNudge(
  projectDir: string,
  opts?: { windowDays?: number; maxLines?: number }
): string
