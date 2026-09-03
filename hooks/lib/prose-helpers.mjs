// check-comments-exempt — hook lib; opening block-comment is the interface contract
/**
 * Shared sentence-similarity helpers used by prose-negation-guard.mjs and
 * prose-modality-guard.mjs (TOKEN-ECONOMY-R-004 / R-005).
 *
 * Detection cliff — intrinsic, not a sloppy constant:
 *   The guards detect negation/hedge loss only when roughly 40% or more of a
 *   sentence's vocabulary survives the edit. Wholesale rewrites pass silently
 *   BY DESIGN — a sentence dropping below the Jaccard threshold is treated as
 *   a deletion, not an in-place rewrite, so the guard leaves it alone.
 *
 *   Measured over 179 negation-bearing sentences drawn from real repo prose
 *   (CLAUDE.md, agents-src/orchestrator.md, agents-src/junior-orchestrator.md,
 *   two SKILL.md files), dropping the negation and retaining a fraction of the
 *   remaining words:
 *
 *     retain 100% -> detected 179/179 (100%)
 *     retain  80% -> detected 179/179 (100%)
 *     retain  60% -> detected 163/179 ( 91%)
 *     retain  50% -> detected 163/179 ( 91%)
 *     retain  40% -> detected  25/179 ( 14%)  <- cliff
 *     retain  30% -> detected  25/179 ( 14%)
 *
 *   The obvious rescue (measuring what fraction of the old sentence's content
 *   words survive anywhere in the new text) scores an aggressively-rewritten
 *   sentence at 0.14–0.22 — indistinguishable from a wholesale deletion (0.00).
 *   Closing the gap needs semantic comparison, which is out of scope for a hook
 *   and self-defeating in a token-reduction motive.
 */

/** Jaccard similarity threshold. Sentences below this score are treated as deletions. */
export const MATCH_THRESHOLD = 0.4

/** Returns true if this file path is a prose surface that the guard should protect. */
export function isProse(filePath) {
  if (typeof filePath !== 'string' || filePath === '') return false
  // Code and config: never guard
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  if (['ts', 'js', 'mjs', 'cjs', 'json', 'yaml', 'yml', 'toml', 'sh', 'bash'].includes(ext)) return false
  // Prose surfaces: .md files and agent/skill definition directories
  if (filePath.endsWith('.md')) return true
  if (/\/(agents|agents-src|agents-pi|skills)\//.test(filePath)) return true
  return false
}

/** Split text into sentences (boundaries: .!? followed by whitespace, or newlines). */
export function splitSentences(text) {
  return text.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(s => s.length > 3)
}

/** Jaccard similarity of word sets (case-insensitive). */
export function jaccard(a, b) {
  const wa = new Set(a.toLowerCase().match(/\w+/g) ?? [])
  const wb = new Set(b.toLowerCase().match(/\w+/g) ?? [])
  let isect = 0
  for (const w of wa) if (wb.has(w)) isect++
  const union = wa.size + wb.size - isect
  return union === 0 ? 0 : isect / union
}

/** Find best-matching sentence in newSents for oldSent. Returns null if below MATCH_THRESHOLD. */
export function matchSentence(oldSent, newSents, threshold = MATCH_THRESHOLD) {
  let best = null, bestScore = -1
  for (const ns of newSents) {
    const s = jaccard(oldSent, ns)
    if (s > bestScore) { bestScore = s; best = ns }
  }
  return bestScore >= threshold ? best : null
}
