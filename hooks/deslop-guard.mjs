#!/usr/bin/env node
/**
 * Groundwork PreToolUse hook — advisory comment-slop tripwire (deslop-guard).
 *
 * Purpose: catches egregious AI comment slop at write time — restating comments,
 * AI-fingerprint openers ("// Let's …"), narrator/step markers ("// Step 1 …"),
 * commented-out code blocks, and AI emoji in comments. This is a TRIPWIRE, not a
 * linter: pure regex, no AST, no eslint, no formatter dependency. It belongs to
 * the bespoke hooks/*.mjs idiom (ledger-guard, orchestrator-impl-guard,
 * agent-model-guard) — hand-written regex gates, not wrappers around external
 * tools.
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
 */

import { readStdin, passthrough } from './lib/hook-io.mjs'

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
 * Best-effort restating-comment detection: a `// name` comment immediately
 * above a `function name`, `const name`, `class name`, etc. declaration that
 * merely restates the identifier. Conservative — requires the comment token to
 * be a single bare identifier and the next non-blank line to declare it.
 */
const DECL_RE = /^\s*(export\s+)?(async\s+)?(function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/
const IDENT_COMMENT_RE = /^\s*\/\/\s*([A-Za-z_$][\w$]*)\s*$/

function findRestatingComments(lines) {
  const findings = []
  for (let i = 0; i < lines.length - 1; i++) {
    const cm = IDENT_COMMENT_RE.exec(lines[i])
    if (!cm) continue
    // next non-blank line
    let j = i + 1
    while (j < lines.length && lines[j].trim() === '') j++
    if (j >= lines.length) break
    const decl = DECL_RE.exec(lines[j])
    if (decl && decl[4] === cm[1]) {
      findings.push({ line: i, name: cm[1] })
    }
  }
  return findings
}

/**
 * Split a camelCase or snake_case identifier into lowercase tokens.
 * e.g. "fetchUserById" → ["fetch","user","by","id"]
 *      "get_user_by_id" → ["get","user","by","id"]
 */
function splitIdentifier(name) {
  return name
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
}

/** Stop-words stripped from a prose comment before comparing to an identifier. */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'to', 'from', 'for', 'of', 'in', 'on', 'at', 'by',
  'and', 'or', 'with', 'that', 'this', 'it', 'is', 'are', 'be', 'as',
  'its', 'into', 'up',
])

/**
 * Multi-word restating comment: a prose comment whose content words (after
 * stop-word removal) are ALL present in the camelCase/snake_case tokens of the
 * identifier declared on the next non-blank line. Requires ≥2 content words
 * (single-identifier form is handled by findRestatingComments).
 * e.g. "// fetch the user"  above "function fetchUser()" → fires
 *      "// get user by id"  above "const getUserById"    → fires ("by" is a stop word)
 *      "// fetch the user with roles" above "function fetchUser()" → skips ("roles" absent)
 */
function findMultiWordRestatingComments(lines) {
  const findings = []
  const MULTI_COMMENT_RE = /^\s*\/\/\s+([a-z][a-zA-Z0-9 ]{0,80})\s*$/
  for (let i = 0; i < lines.length - 1; i++) {
    const cm = MULTI_COMMENT_RE.exec(lines[i])
    if (!cm) continue
    const commentText = cm[1].trim()
    const contentWords = commentText
      .split(/\s+/)
      .map((w) => w.toLowerCase())
      .filter((w) => !STOP_WORDS.has(w) && /^[a-z][a-z0-9]*$/.test(w))
    if (contentWords.length < 2) continue // single-word handled by findRestatingComments

    // next non-blank line
    let j = i + 1
    while (j < lines.length && lines[j].trim() === '') j++
    if (j >= lines.length) break
    const decl = DECL_RE.exec(lines[j])
    if (!decl) continue // must be a declaration

    const identName = decl[4]
    const identTokens = new Set(splitIdentifier(identName))
    if (contentWords.every((w) => identTokens.has(w))) {
      findings.push({ line: i, comment: commentText, identName })
    }
  }
  return findings
}

/**
 * High-confidence prose-paraphrase detection: a short imperative comment whose
 * key verb and primary noun appear verbatim as substrings of the very next code
 * line — e.g. `// increment the counter` above `count++` (verb "increment" not
 * in line, low-confidence, skip) vs `// return the result` above `return result`
 * (both tokens present, flag).
 *
 * Heuristics (all must pass to flag):
 *  1. Comment is ≤8 words and starts with an imperative verb (no capital letter
 *     mid-phrase, first word lowercased).
 *  2. The next non-blank, non-comment line is a real code line (not a
 *     declaration — those are handled by restating detectors).
 *  3. At least 2 of the comment's content words (after stop-word removal) appear
 *     as exact word-boundary matches in the code line.
 *
 * Precision over recall: a single unmatched content word is enough to skip.
 */
const IMPERATIVE_COMMENT_RE = /^\s*\/\/\s+([a-z][a-zA-Z0-9 ]{0,60})\s*$/
const CODE_LINE_RE = /^\s*(?!\/\/)[\w$.({\['"!`]/ // starts like code, not a comment
const COMMENT_WORD_RE = /^[a-z][a-z0-9]*$/i // plain words only; reject tokens with punctuation/symbols

function findProseParaphraseComments(lines) {
  const findings = []
  for (let i = 0; i < lines.length - 1; i++) {
    const cm = IMPERATIVE_COMMENT_RE.exec(lines[i])
    if (!cm) continue
    const commentText = cm[1].trim()
    const words = commentText.split(/\s+/)
    if (words.length < 2 || words.length > 8) continue

    // next non-blank line
    let j = i + 1
    while (j < lines.length && lines[j].trim() === '') j++
    if (j >= lines.length) break
    const codeLine = lines[j]

    // Skip if the next line is a declaration (restating detectors cover that).
    if (DECL_RE.test(codeLine)) continue
    // Next line must look like code, not another comment or blank.
    if (!CODE_LINE_RE.test(codeLine)) continue

    const codeLineLower = codeLine.toLowerCase()
    const contentWords = words
      .map((w) => w.toLowerCase())
      .filter((w) => !STOP_WORDS.has(w) && COMMENT_WORD_RE.test(w))
    if (contentWords.length < 2) continue

    // ALL content words must appear in the code line — either as a whole word
    // (word-boundary match) or as a component of a camelCase/snake_case token
    // (e.g. "authenticated" inside "isAuthenticated" splits to ["is","authenticated"]).
    // Raw-substring fallback is intentionally absent: "cat" must not match "concatenate".
    const codeIdentTokens = new Set(
      (codeLineLower.match(/[a-z_$][a-z0-9_$]*/g) ?? []).flatMap((tok) => splitIdentifier(tok))
    )
    const allInCode = contentWords.every((w) => {
      const wre = new RegExp(`\\b${w}\\b`)
      return wre.test(codeLineLower) || codeIdentTokens.has(w)
    })
    if (allInCode) {
      findings.push({ line: i, comment: commentText, codeLine: codeLine.trim() })
    }
  }
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
