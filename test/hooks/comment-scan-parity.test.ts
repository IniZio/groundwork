/**
 * Parity test: asserts that BOTH consumers of hooks/lib/comment-scan.mjs
 * classify block-comment body lines identically. Spans the seam between:
 *   - hooks/lib/comment-scan.mjs (classifyLines export)
 *   - hooks/deslop-guard.mjs (block-comment body scan — uses classifyLines)
 *
 * If deslop-guard drifts to a different predicate for "is this line a
 * block-comment body?", this test surfaces it: the same fixture line that
 * classifyLines calls 'block-comment' must also trigger a deslop-guard
 * finding when it contains known slop content.
 *
 * Does NOT import check-comments.mjs (a script, not a library); it is
 * covered via its exported path through fileMetrics, which both it and this
 * test import from the same shared module.
 */

import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { classifyLines, fileMetrics } from '../../hooks/lib/comment-scan.mjs'

const HOOK = path.resolve(import.meta.dirname, '..', '..', 'hooks', 'deslop-guard.mjs')

/** Run deslop-guard as a subprocess with a Write payload (mirrors deslop-guard.test.ts helper). */
function runDeslopWrite(content: string): { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } } {
  const out = execFileSync('node', [HOOK], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: '/p/src/fixture.ts', content },
    }),
    encoding: 'utf8',
  })
  return out.trim() ? JSON.parse(out) : {}
}

// Parity fixture: a block comment with a slop opener on line 2 (1-based).
//   line 1: /**              → block-comment (structural opener — exempt from slop)
//   line 2: " * Now we …"   → block-comment BODY containing slop: "Now we"
//   line 3: " * @param …"   → block-comment body, @-annotation (exempt)
//   line 4: " */"            → block-comment (structural closer — exempt)
//   line 5: "export …"       → code
const PARITY_FIXTURE = [
  '/**',
  ' * Now we initialize the system.',
  ' * @param config setup options',
  ' */',
  'export function init(config: unknown) {}',
].join('\n')

// False-positive fixture: a template literal whose body line starts with `*`
// and matches a SLOP_BLOCK pattern, but is classified as 'code' by
// classifyLines (because no /* block was open at that point).
//
//   line 1: "const docs = `"           → code
//   line 2: "* note: scale factor …"   → code (NOT block-comment — no /* open)
//                                         inline /^\s*\*/ would wrongly fire here
//   line 3: "`"                        → code
//   line 4: "export const result = …"  → code
//
// This fixture distinguishes the shared-library predicate from the inline regex
// fallback: classifyLines('code') → skip; /^\s*\*/ → SLOP_BLOCK fires.
const FALSE_POSITIVE_FIXTURE = 'const docs = `\n* note: scale factor applied here\n`\nexport const result = docs'

describe('comment-scan parity — shared library drives both consumers (seam test)', () => {
  // ── Seam: classifyLines vs. deslop-guard block-comment predicate ──────────

  it('classifyLines identifies line 2 of the parity fixture as block-comment', () => {
    const kinds = classifyLines(PARITY_FIXTURE)
    // Index 1 = line 2 (0-based).
    expect(kinds[1]).toBe('block-comment') // " * Now we …" — body line with slop
    // Sanity-check surrounding lines.
    expect(kinds[0]).toBe('block-comment') // /**
    expect(kinds[2]).toBe('block-comment') // " * @param …" — still block-comment
    expect(kinds[3]).toBe('block-comment') // */
    expect(kinds[4]).toBe('code')          // export function …
  })

  it('deslop-guard fires on the block-comment body line classifyLines identifies (seam parity)', () => {
    // If deslop-guard drifts to a different predicate (e.g., inline ^\s*# or
    // misses indented `*` lines), it would not fire on line 2 and this test
    // fails with a message naming the diverging line.
    const result = runDeslopWrite(PARITY_FIXTURE)
    const reason = result.hookSpecificOutput?.permissionDecisionReason
    // Use toBeDefined first so the custom message fires when the hook does not
    // warn at all (reason === undefined). A later toContain on undefined would
    // throw an internal vitest error rather than showing the descriptive message.
    expect(
      reason,
      'deslop-guard must fire on line 2 (" * Now we …") of the parity fixture. ' +
        `Got: ${JSON.stringify(reason)}. ` +
        'Seam drift: deslop-guard and comment-scan classify block-comment bodies differently.',
    ).toBeDefined()
    expect(result.hookSpecificOutput?.permissionDecision).toBe('allow')
    expect(reason).toContain('line 2')
    expect(reason).toMatch(/block comment/i)
  })

  it('deslop-guard does NOT fire on structural block-comment lines (ALLOW_BLOCK_BODY exempt)', () => {
    // Only @-annotation and structural lines — no slop body lines.
    const clean = ['/**', ' * @param foo a value', ' * @returns bar', ' */'].join('\n')
    const result = runDeslopWrite(clean)
    expect(result.hookSpecificOutput).toBeUndefined()
  })

  it('classifyLines classifies * note: line as code when NOT inside a block comment', () => {
    // Verifies the shared library's stateful block tracking: a line starting
    // with `*` that follows code (not a `/*` opener) is 'code', not
    // 'block-comment'. The inline predicate /^\s*\*/ cannot see this.
    const kinds = classifyLines(FALSE_POSITIVE_FIXTURE)
    const lines = FALSE_POSITIVE_FIXTURE.split('\n')
    expect(kinds[1]).toBe('code') // "* note: scale factor …" — NOT a block-comment body
    expect(lines[1]).toMatch(/^\* note:/) // confirm it starts with * note:
  })

  it('deslop-guard does NOT fire on a * note: line that is code, not a block-comment body (seam: shared predicate vs inline fallback)', () => {
    // The shared predicate (classifyLines[i] === 'block-comment') correctly
    // classifies line 2 of FALSE_POSITIVE_FIXTURE as 'code' — no firing.
    // The inline fallback (/^\s*\*/) would classify it as a block-comment
    // body and fire SLOP_BLOCK on "note: " — a false positive.
    //
    // If this test goes RED, it means deslop-guard switched from classifyLines
    // to the inline predicate — the seam drifted.
    const result = runDeslopWrite(FALSE_POSITIVE_FIXTURE)
    expect(
      result.hookSpecificOutput,
      'deslop-guard must NOT fire on "* note: scale factor" in a template literal (code line). ' +
        'If this fires, deslop-guard is using the inline /^\\s*\\*/ fallback instead of ' +
        'classifyLines — seam drift between deslop-guard and comment-scan.',
    ).toBeUndefined()
  })

  // ── Unit guards on the shared library (hand-computed constants) ───────────

  it('fileMetrics ratio: 5 line-comments + 3 code → ratio ≈ 0.625 (hand-computed)', () => {
    const src = ['// c1', '// c2', '// c3', '// c4', '// c5', 'a=1', 'b=2', 'c=3'].join('\n')
    const m = fileMetrics(src)
    expect(m.commentLines).toBe(5)
    expect(m.codeLines).toBe(3)
    expect(m.ratio).toBeCloseTo(5 / 8) // 0.625 — computed against hand-counted fixture
    expect(m.ratio).toBeGreaterThan(0.45)
  })

  it('fileMetrics blockShare: 4-line block in 8 non-blank → blockShare = 0.5 (hand-computed)', () => {
    // 4 code lines + 4-line block comment → nonBlankLines = 8, largestBlock = 4
    const src = ['a=1', 'b=2', 'c=3', 'd=4', '/*', ' * line 1', ' * line 2', ' */'].join('\n')
    const m = fileMetrics(src)
    expect(m.codeLines).toBe(4)
    expect(m.commentLines).toBe(4)
    expect(m.largestBlock).toBe(4)
    // 0.5 is a literal hand-computed constant — NOT derived from m.* (which would be tautological).
    expect(m.blockShare).toBeCloseTo(0.5)
    expect(m.blockShare).toBeGreaterThan(0.20)
  })
})
