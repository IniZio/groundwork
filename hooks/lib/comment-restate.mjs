// hooks/lib/comment-restate.mjs
// Restating-comment heuristics shared between deslop-guard.mjs and the
// comment-density checker. Pure functions — no I/O, no side effects.

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
 * Public API: find all restating comments in a source string.
 *
 * @param {string} source  - File content as a string.
 * @param {object} [opts]
 * @param {number} [opts.overlapShare=0.6]  - Fraction of content words (after
 *   stop-word removal) that must appear as identifier tokens for a multi-word
 *   restating comment to fire. The prose-paraphrase detector always uses
 *   ALL-match (share=1.0). Min 2 content tokens required regardless.
 * @returns {Array<{line: number, comment: string, code: string, reason: string}>}
 */
export function findAllRestatingComments(source, opts = {}) {
  const { overlapShare = 0.6 } = opts
  if (typeof source !== 'string' || !source) return []
  const lines = source.split(/\r?\n/)
  const out = []

  // Single-identifier form
  for (const r of findRestatingComments(lines)) {
    out.push({
      line: r.line,
      comment: `// ${r.name}`,
      code: lines[r.line + 1]?.trim() ?? '',
      reason: `restating comment "// ${r.name}" merely restates the identifier declared below`,
    })
  }

  // Multi-word form with configurable overlapShare
  // Re-implement inline so we don't need to expose overlapShare on the internal function.
  {
    const MULTI_COMMENT_RE = /^\s*\/\/\s+([a-z][a-zA-Z0-9 ]{0,80})\s*$/
    for (let i = 0; i < lines.length - 1; i++) {
      const cm = MULTI_COMMENT_RE.exec(lines[i])
      if (!cm) continue
      const commentText = cm[1].trim()
      const contentWords = commentText
        .split(/\s+/)
        .map((w) => w.toLowerCase())
        .filter((w) => !STOP_WORDS.has(w) && /^[a-z][a-z0-9]*$/.test(w))
      if (contentWords.length < 2) continue
      let j = i + 1
      while (j < lines.length && lines[j].trim() === '') j++
      if (j >= lines.length) break
      const decl = DECL_RE.exec(lines[j])
      if (!decl) continue
      const identName = decl[4]
      const identTokens = new Set(splitIdentifier(identName))
      const matched = contentWords.filter((w) => identTokens.has(w))
      if (matched.length / contentWords.length >= overlapShare) {
        out.push({
          line: i,
          comment: `// ${commentText}`,
          code: lines[j].trim(),
          reason: `multi-word restating comment "// ${commentText}" above ${identName} — content words overlap identifier tokens`,
        })
      }
    }
  }

  // Prose-paraphrase form
  for (const r of findProseParaphraseComments(lines)) {
    out.push({
      line: r.line,
      comment: `// ${r.comment}`,
      code: r.codeLine,
      reason: `prose-paraphrase comment "// ${r.comment}" narrates the line below without adding info`,
    })
  }

  return out
}

export { splitIdentifier, STOP_WORDS, findRestatingComments, findMultiWordRestatingComments, findProseParaphraseComments }
export { DECL_RE, IDENT_COMMENT_RE, IMPERATIVE_COMMENT_RE, CODE_LINE_RE, COMMENT_WORD_RE }
