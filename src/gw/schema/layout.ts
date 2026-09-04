/**
 * layout.ts — On-disk path contract for every note kind.
 *
 * All functions are PURE (no disk access). Every consumer of this module
 * derives paths from these functions — never from ad-hoc string concatenation.
 *
 * tracker_path config indirection: callers pass `tracker` (default ".groundwork")
 * resolved relative to the repo root. This lets the vault live outside the repo
 * if configured differently (D7).
 */
import path from 'node:path'

export const DEFAULT_TRACKER_PATH = '.groundwork'

// ---------------------------------------------------------------------------
// Motive-level paths
// ---------------------------------------------------------------------------

/** Absolute path to a motive's directory */
export function motiveDir(repoRoot: string, tracker: string, slug: string): string {
  return path.join(repoRoot, tracker, 'motives', slug)
}

/**
 * Slice note: mudissue-style `<label>-<slug>.md` under the motive dir.
 * `label` is the slice id (e.g. "S1-SCHEMA"), `slug` is a human label slug.
 * When slug is omitted, filename is just `<label>.md`.
 */
export function sliceNotePath(
  repoRoot: string,
  tracker: string,
  motive: string,
  label: string,
  slug?: string,
): string {
  const filename = slug ? `${label}-${slug}.md` : `${label}.md`
  return path.join(repoRoot, tracker, 'motives', motive, filename)
}

/** Gate note for one session: `gate-<sessionId>.md` under the motive dir */
export function gateNotePath(
  repoRoot: string,
  tracker: string,
  motive: string,
  sessionId: string,
): string {
  return path.join(repoRoot, tracker, 'motives', motive, `gate-${sessionId}.md`)
}

/** Ticket file: `tickets/<filename>.md` (filename without .md suffix) */
export function ticketPath(
  repoRoot: string,
  tracker: string,
  motive: string,
  filename: string,
): string {
  const base = filename.endsWith('.md') ? filename : `${filename}.md`
  return path.join(repoRoot, tracker, 'motives', motive, 'tickets', base)
}

/** Motive-level decision file (MADR): `decisions/<decisionId>.md` */
export function motiveDecisionPath(
  repoRoot: string,
  tracker: string,
  motive: string,
  decisionId: string,
): string {
  const base = decisionId.endsWith('.md') ? decisionId : `${decisionId}.md`
  return path.join(repoRoot, tracker, 'motives', motive, 'decisions', base)
}

// ---------------------------------------------------------------------------
// Spec concept paths (doc/specs/<concept>/)
// ---------------------------------------------------------------------------

/** Root of a spec concept folder */
export function conceptDir(repoRoot: string, conceptSlug: string): string {
  return path.join(repoRoot, 'doc', 'specs', conceptSlug)
}

/** Concept index.md */
export function conceptIndexPath(repoRoot: string, conceptSlug: string): string {
  return path.join(repoRoot, 'doc', 'specs', conceptSlug, 'index.md')
}

/** Requirement file (D-13 Shape A: one file per requirement) */
export function requirementPath(
  repoRoot: string,
  conceptSlug: string,
  reqId: string,
): string {
  const base = reqId.endsWith('.md') ? reqId : `${reqId}.md`
  return path.join(repoRoot, 'doc', 'specs', conceptSlug, 'requirements', base)
}

/** Design folder root */
export function designDir(repoRoot: string, conceptSlug: string): string {
  return path.join(repoRoot, 'doc', 'specs', conceptSlug, 'design')
}

/** MOC (_MOC.md) — the curated reading map for a concept's design folder */
export function designMocPath(repoRoot: string, conceptSlug: string): string {
  return path.join(repoRoot, 'doc', 'specs', conceptSlug, 'design', '_MOC.md')
}

/** Spec-level decision file (MADR under concept): decisions/<decisionId>.md */
export function specDecisionPath(
  repoRoot: string,
  conceptSlug: string,
  decisionId: string,
): string {
  const base = decisionId.endsWith('.md') ? decisionId : `${decisionId}.md`
  return path.join(repoRoot, 'doc', 'specs', conceptSlug, 'decisions', base)
}

/** Glossary file per concept: glossary.md (adjacent to design/ at concept root) */
export function glossaryPath(repoRoot: string, conceptSlug: string): string {
  return path.join(repoRoot, 'doc', 'specs', conceptSlug, 'glossary.md')
}

// ---------------------------------------------------------------------------
// Vault / tracker config
// ---------------------------------------------------------------------------

/**
 * Resolve the tracker directory from the configured path (may be absolute or
 * relative to repoRoot). Defaults to DEFAULT_TRACKER_PATH if not provided.
 */
export function resolveTracker(repoRoot: string, configured?: string): string {
  const t = configured ?? DEFAULT_TRACKER_PATH
  return path.isAbsolute(t) ? t : path.join(repoRoot, t)
}
