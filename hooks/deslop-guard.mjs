#!/usr/bin/env node
/**
 * Groundwork PreToolUse hook — advisory comment-slop tripwire (deslop-guard).
 *
 * Purpose: catches egregious AI comment slop at write time — restating comments,
 * AI-fingerprint openers ("// Let's …"), narrator/step markers ("// Step 1 …"),
 * commented-out code blocks, and AI emoji in comments. This is a TRIPWIRE, not a
 * linter: pure regex, no AST, no eslint, no formatter dependency. It belongs to
 * the same hand-written regex gate pattern as the sibling guards (nesting-guard,
 * orchestrator-impl-guard, agent-model-guard — now in src/gw/hook/*.ts, dispatched
 * via bin/gw-hook), not wrappers around external tools.
 *
 * ADVISORY-ONLY — NEVER blocks an edit. The hook always returns
 * permissionDecision "allow"; slop findings are surfaced only via the
 * permissionDecisionReason field so the model sees the warning but the write
 * proceeds. It is future-insurance: the repo is currently clean, but agents
 * write most of the code here, so this catches the regression at write time.
 *
 * Escape hatches (either skips detection entirely → clean passthrough):
 *   - a `// deslop:disable` marker anywhere in the target content, OR
 *   - the env var GROUNDWORK_DESLOP_GUARD=0
 *
 * Design guarantees (identical contract to the sibling guards):
 *  - FAIL-OPEN. Any error, malformed stdin, or unexpected shape → emit nothing
 *    and exit 0, i.e. let the call proceed unchanged. A hook must never wedge
 *    real work.
 *  - ADVISORY. Always continues; never denies, never rewrites input.
 *  - SCOPED. Acts only on Edit/Write/MultiEdit; everything else is a no-op.
 *  - CONSERVATIVE. Patterns favor false negatives — only egregious AI
 *    fingerprints fire. JSDoc/TSDoc, shebangs, license headers, and
 *    annotation comments (@ts-ignore etc.) are allow-listed before detection.
 *  - INLINE-REGEX FALLBACK RISK. The block-comment body scan uses classifyLines
 *    from comment-scan.mjs (stateful) to skip non-block lines. The inline
 *    fallback regex (^\s*[*]) cannot distinguish a block-comment body from a
 *    multiplication continuation (`  * note: …`) or template-literal content —
 *    it would produce false positives on those lines. The shared library is the
 *    authoritative classifier; the fallback is last-resort only.
 */

import { readStdin, passthrough } from './lib/hook-io.mjs'
import { classifyLines } from './lib/comment-scan.mjs'
import { findRestatingComments, findMultiWordRestatingComments, findProseParaphraseComments, splitIdentifier, STOP_WORDS, DECL_RE, IDENT_COMMENT_RE, IMPERATIVE_COMMENT_RE, CODE_LINE_RE, COMMENT_WORD_RE } from './lib/comment-restate.mjs'

const GUARDED = new Set(['Edit', 'Write', 'MultiEdit'])

/**
 * Advisory allow: the call proceeds, but the reason surfaces the slop findings
 * to the model. Mirrors agent-model-guard's allow+reason contract, minus the
 * updatedInput rewrite (we never rewrite — advisory only).
 */
function advise(reason) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: reason,
      },
    }),
  )
  process.exit(0)
}

/**
 * Allow-list line tests. A line matching ANY of these is skipped before the
 * slop patterns run — JSDoc/docblock content, shebangs, license headers, and
 * line-comment annotations (@ts-ignore, @eslint-disable, etc.).
 */
const ALLOW_LINE = [
  /^\s*\*/, // JSDoc/TSDoc continuation lines (" * …")
  /^\s*\/\*\*/, // JSDoc open ("/**")
  /^\s*\/\*/, // block comment open ("/*")
  /^\s*\*\//, // block comment close ("*/")
  /^\s*\/\/\s*@/, // line-comment annotations: @ts-ignore, @eslint-disable, etc.
  /^#!/, // shebang ("#!")
]

/** License-header keywords (checked in the first ~5 lines only). */
const LICENSE_LINE = /\b(Copyright|Licensed|MIT|Apache|BSD|ISC|GPL|MPL)\b/i

/**
 * Slop patterns. Each is a {re, label} pair. A line-comment line (`// …`)
 * matching re (after the allow-list and the license-window check) is a finding.
 * Tuned for HIGH CONFIDENCE — egcgregious fingerprints only.
 */
const SLOP = [
  {
    label: 'AI-fingerprint opener ("Let\'s/Let us/Now we/Here we/Next we/Now I/I\'ll")',
    re: /^\s*\/\/\s*(let's|let us|now we|here we|next we|first,?\s+let's|now i|i'll|i will)\b/i,
  },
  {
    label: 'narrator/step marker ("Step N", "Phase N", "Firstly/Secondly/Finally")',
    re: /^\s*\/\/\s*(step\s+\d+|phase\s+\d+|firstly,?|secondly,?|finally,?|step\s+\d+:)\b/i,
  },
  {
    label: 'apologetic/hedging filler ("Note: ", "Disclaimer: ", "Just ", "Simply ")',
    re: /^\s*\/\/\s*(note:\s|disclaimer:\s|just\s+|simply\s+)/i,
  },
  {
    label: 'AI emoji in a comment',
    re: /^\s*\/\/.*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/u,
  },
]

/**
 * Lines that are structural within a block comment (opener, closer, or
 * @-annotation). These are skipped in the block-comment body scan even though
 * classifyLines() classifies them as 'block-comment' — they carry no slop risk.
 */
const ALLOW_BLOCK_BODY = [
  /^\s*\/\*\*?/, // /** or /* open
  /^\s*\*\//, // */ close
  /^\s*\*\s*@/, // @param, @returns, @ts-ignore, etc.
]

/**
 * Block-comment-body variants of the SLOP patterns. Applied to lines that
 * match ^\s*\* and are not caught by ALLOW_BLOCK_BODY or LICENSE_LINE.
 * These are structurally identical to SLOP but anchored to the `* ` prefix
 * instead of `// `.
 */
const SLOP_BLOCK = [
  {
    label: 'AI-fingerprint opener in block comment ("Let\'s/Let us/Now we/Here we/Next we/Now I/I\'ll")',
    re: /^\s*\*\s*(let's|let us|now we|here we|next we|first,?\s+let's|now i|i'll|i will)\b/i,
  },
  {
    label: 'narrator/step marker in block comment ("Step N", "Phase N", "Firstly/Secondly/Finally")',
    re: /^\s*\*\s*(step\s+\d+|phase\s+\d+|firstly,?|secondly,?|finally,?|step\s+\d+:)\b/i,
  },
  {
    label: 'apologetic/hedging filler in block comment ("Just ", "Simply ")',
    // NOTE: and Disclaimer: are standard design-annotation conventions in block-comment
    // bodies and produced 12/12 false positives on legitimate load-bearing notes in this
    // codebase (e.g. hooks/lib/hook-io.mjs "* NOTE: do NOT use process.stdin.isTTY").
    // Those keywords are kept in the SLOP line-comment patterns where the signal is
    // stronger. Only 'just ' and 'simply ' remain here as reliable block-comment filler.
    // KNOWN FALSE NEGATIVE (deliberate): "* Note: this function loops over the array"
    // will NOT fire because 'note:' was dropped to eliminate the false-positive flood.
    // The // SLOP line-comment patterns still catch note:/disclaimer: in single-line
    // comments. The two uses are not separable by regex in block-comment context.
    re: /^\s*\*\s*(just\s+|simply\s+)/i,
  },
  {
    label: 'AI emoji in block comment',
    // An explicit symbol set is used here rather than a broad range because the enclosing
    // Unicode blocks (\u{2600}-\u{27BF} Misc Symbols + Dingbats) contain ordinary annotation
    // marks — ⚠ (U+26A0), ✓ (U+2713), ✔ (U+2714), ➜ (U+279C) — that appear legitimately
    // in test fixtures, spec prose, and doc bodies of this codebase (6 confirmed false
    // positives on the full tracked file sweep). The three retained ranges plus the six
    // explicit code points below are reliable AI-decoration fingerprints and produced
    // 0 findings across all 329 tracked .ts/.mjs/.js files while still catching ✨/✅/❌/⚡.
    re: /^\s*\*.*[\u{1F300}-\u{1FAFF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2728}\u{2705}\u{274C}\u{26A1}\u{2B50}\u{2757}]/u,
  },
]

/**
 * Detect a run of 3+ consecutive code-like commented lines (commented-out code
 * block, not prose). A "code-like" comment line starts with `// ` followed by a
 * token that looks like code rather than a sentence: an identifier char,
 * `$`, `.`, `(`, `{`, `[`, `;`, `=`, `"`, `'`, or a keyword opener. Prose lines
 * (starting with a capital letter + space + word, or `// ` then a lowercase
 * word with a space after) break the run.
 */
const CODE_LIKE_COMMENT = /^\s*\/\/\s*[\w$.({\[;"']/

function findCommentedCodeBlocks(lines) {
  const findings = []
  let runStart = -1
  let runLen = 0
  for (let i = 0; i < lines.length; i++) {
    if (CODE_LIKE_COMMENT.test(lines[i])) {
      if (runStart < 0) runStart = i
      runLen++
    } else {
      if (runLen >= 3) {
        findings.push({ start: runStart, len: runLen })
      }
      runStart = -1
      runLen = 0
    }
  }
  if (runLen >= 3) findings.push({ start: runStart, len: runLen })
  return findings
}

/**
 * Is this line allow-listed (skip slop detection for it)?
 * License-header check only applies in the first ~5 lines.
 */
function isAllowed(line, idx) {
  for (const re of ALLOW_LINE) if (re.test(line)) return true
  if (idx < 5 && LICENSE_LINE.test(line)) return true
  return false
}

/**
 * Run all slop detectors against the target content. Returns a list of
 * human-readable finding strings (empty list = clean).
 */
function detectSlop(content) {
  if (typeof content !== 'string' || !content) return []
  if (process.env.GROUNDWORK_DESLOP_GUARD === '0') return []
  if (/deslop:disable/.test(content)) return []

  const lines = content.split(/\r?\n/)
  const findings = []

  // Classify all lines using the shared library so this hook and
  // scripts/check-comments.mjs share one notion of "block-comment body line".
  // Wrapped in try/catch so a library error does not break fail-open behaviour.
  let lineKinds = null
  try {
    lineKinds = classifyLines(content)
  } catch {
    // Falls back to inline predicate in the block-comment scan below.
  }

  // Per-line pattern scan (after allow-list).
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (isAllowed(line, i)) continue
    // Only inspect line comments for per-line patterns; block-comment bodies
    // are already allow-listed above.
    for (const { label, re } of SLOP) {
      if (re.test(line)) {
        findings.push(`line ${i + 1}: ${label} — ${line.trim().slice(0, 120)}`)
        break // one finding per line is enough
      }
    }
  }

  // Block-comment body scan: apply SLOP_BLOCK patterns to block-comment body
  // lines that were exempt from the per-line scan above. Uses classifyLines
  // from comment-scan.mjs (shared library) — BOTH surfaces share one notion
  // of "this line is a block-comment body". Falls back to the inline predicate
  // if classifyLines is unavailable. Structural lines (/**  /*  */) and
  // @-annotation lines are still skipped via ALLOW_BLOCK_BODY.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Prefer shared-library classification; fall back to inline regex.
    const isBlockComment = lineKinds ? lineKinds[i] === 'block-comment' : /^\s*\*/.test(line)
    if (!isBlockComment) continue
    if (ALLOW_BLOCK_BODY.some((re) => re.test(line))) continue
    if (i < 5 && LICENSE_LINE.test(line)) continue
    for (const { label, re } of SLOP_BLOCK) {
      if (re.test(line)) {
        findings.push(`line ${i + 1}: ${label} — ${line.trim().slice(0, 120)}`)
        break
      }
    }
  }

  // Multi-line: commented-out code blocks.
  for (const blk of findCommentedCodeBlocks(lines)) {
    const sample = lines[blk.start].trim().slice(0, 80)
    findings.push(`line ${blk.start + 1}: commented-out code block (${blk.len} consecutive // lines that look like code) — ${sample}…`)
  }

  // Multi-line: restating comments (single-identifier form).
  for (const r of findRestatingComments(lines)) {
    findings.push(`line ${r.line + 1}: restating comment "// ${r.name}" immediately above its declaration — drop it`)
  }

  // Multi-line: multi-word restating comments (prose form where all content words are in the identifier).
  for (const r of findMultiWordRestatingComments(lines)) {
    findings.push(`line ${r.line + 1}: multi-word restating comment "// ${r.comment}" above ${r.identName} — all content words are in the identifier, drop it`)
  }

  // Multi-line: high-confidence prose-paraphrase comments (e.g. "// return the result" above "return result").
  for (const r of findProseParaphraseComments(lines)) {
    findings.push(`line ${r.line + 1}: prose-paraphrase comment "// ${r.comment}" narrates the line below without adding info — drop it`)
  }

  return findings
}

/** Extract the target file content from a parsed PreToolUse input. */
function targetContent(_toolName, toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return ''
  // Write: the full content. Edit/MultiEdit: best-effort — use new_string
  // (Edit) or one of newStrings (MultiEdit) as the writable surface.
  if (typeof toolInput.content === 'string') return toolInput.content
  if (typeof toolInput.new_string === 'string') return toolInput.new_string
  if (Array.isArray(toolInput.edits)) {
    return toolInput.edits
      .map((e) => (e && typeof e.new_string === 'string' ? e.new_string : ''))
      .join('\n')
  }
  return ''
}

async function main() {
  let input = {}
  try {
    const raw = await readStdin()
    if (raw.trim()) input = JSON.parse(raw)
  } catch {
    return passthrough()
  }

  const tool = typeof input?.tool_name === 'string' ? input.tool_name : ''
  if (!GUARDED.has(tool)) return passthrough()

  const content = targetContent(tool, input?.tool_input)
  const findings = detectSlop(content)
  if (findings.length === 0) return passthrough()

  const fileList =
    typeof input?.tool_input?.file_path === 'string' ? input.tool_input.file_path : '(unknown file)'
  const body =
    `groundwork deslop-guard: ${findings.length} comment-slop finding(s) in ${tool} of ${fileList}. ` +
    `This is advisory only — the write proceeds. These look like AI comment slop ` +
    `(narrator openers, restating comments, commented-out code blocks, or AI emoji). ` +
    `Prefer self-documenting code; drop comments that restate the code below them. ` +
    `To silence for a region, add "// deslop:disable" or set GROUNDWORK_DESLOP_GUARD=0.\n\n` +
    findings.join('\n')
  return advise(body)
}

main().catch(() => passthrough())
