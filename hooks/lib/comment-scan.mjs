// check-comments-exempt — hook lib; metric scanner with dense inline contracts
/**
 * comment-scan.mjs — shared comment-classification library.
 *
 * Single source of truth for comment metrics consumed by:
 *   - scripts/check-comments.mjs  (whole-file ratio + block-share scan)
 *   - (future) hooks that need per-file comment counts
 *
 * Classifies each line of a source string into one of four kinds:
 *   'block-comment' — inside or opening/closing a block comment (/* ... *\/)
 *   'line-comment'  — a // comment or shebang (#!)
 *   'code'          — any other non-blank line
 *   'blank'         — empty or whitespace-only
 *
 * Limitations:
 *   - No string-literal or regex-literal awareness. A `//` or `/*` that
 *     appears inside a string value will be miscounted. In practice this
 *     produces small miscounts on this repo — no file is grossly misclassified.
 *   - Mid-line block openers are not tracked. A line like `foo(); /* start`
 *     is classified 'code' and the in-block state is never set, so the body
 *     lines that follow are also misclassified as 'code' until the parser
 *     encounters a line whose trimmed form starts with `/*`. The shipped
 *     ratio/block-share thresholds were calibrated against this behaviour —
 *     do not change classifyLines to fix it without recalibrating.
 * The function is intentionally simple (pure line scanning, no AST) to match
 * the bespoke regex-only idiom of this hook suite.
 */

/**
 * Classify each line of a source string into block-comment, line-comment,
 * code, or blank.
 *
 * @param {string} src — full source file text
 * @returns {('block-comment'|'line-comment'|'code'|'blank')[]}
 */
export function classifyLines(src) {
  const lines = src.split('\n')
  /** @type {('block-comment'|'line-comment'|'code'|'blank')[]} */
  const kinds = []
  let inBlock = false

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed === '') {
      kinds.push('blank')
      continue
    }

    if (inBlock) {
      kinds.push('block-comment')
      if (trimmed.includes('*/')) inBlock = false
      continue
    }

    // Block comment open: /* or /**
    if (trimmed.startsWith('/*')) {
      kinds.push('block-comment')
      // Check whether the comment closes on the same line (after the opener).
      const afterOpen = trimmed.slice(2)
      if (!afterOpen.includes('*/')) inBlock = true
      continue
    }

    // Line comment or shebang
    if (trimmed.startsWith('//') || trimmed.startsWith('#!')) {
      kinds.push('line-comment')
      continue
    }

    // Everything else is code (including lines that contain /* mid-line after
    // leading code — we do not track inline block spans for simplicity).
    kinds.push('code')
  }

  return kinds
}

/**
 * Compute per-file comment metrics from a source string.
 *
 * @param {string} src — full source file text
 * @returns {{
 *   commentLines: number,
 *   codeLines: number,
 *   ratio: number,
 *   largestBlock: number,
 *   largestBlockStart: number,
 *   blockShare: number,
 * }}
 *
 * Fields:
 *   commentLines      — count of lines classified as block-comment or line-comment
 *   codeLines         — count of lines classified as code
 *   ratio             — commentLines / (commentLines + codeLines); 0 when both are 0
 *   largestBlock      — line count of the largest contiguous block-comment region
 *   largestBlockStart — 1-based line number where that largest block starts (0 when none)
 *   blockShare        — largestBlock / (commentLines + codeLines); 0 when nonBlankLines is 0
 */
export function fileMetrics(src) {
  const kinds = classifyLines(src)

  let commentLines = 0
  let codeLines = 0

  for (const k of kinds) {
    if (k === 'block-comment' || k === 'line-comment') commentLines++
    else if (k === 'code') codeLines++
  }

  const nonBlankLines = commentLines + codeLines
  const ratio = nonBlankLines === 0 ? 0 : commentLines / nonBlankLines

  // Find the largest contiguous run of block-comment lines.
  let largestBlock = 0
  let largestBlockStart = 0
  let runLen = 0
  let runStart = 0

  for (let i = 0; i < kinds.length; i++) {
    if (kinds[i] === 'block-comment') {
      if (runLen === 0) runStart = i + 1 // 1-based
      runLen++
      if (runLen > largestBlock) {
        largestBlock = runLen
        largestBlockStart = runStart
      }
    } else {
      runLen = 0
    }
  }

  const blockShare = nonBlankLines === 0 ? 0 : largestBlock / nonBlankLines

  return { commentLines, codeLines, ratio, largestBlock, largestBlockStart, blockShare }
}
