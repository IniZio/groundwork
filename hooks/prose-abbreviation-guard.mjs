#!/usr/bin/env node
/**
 * Groundwork PreToolUse hook — prose abbreviation guard (TOKEN-ECONOMY-R-006).
 *
 * Enforces two rules over prose surfaces:
 *
 *   CONTRACTION direction — new content must not introduce ad-hoc abbreviations
 *   as standalone words: cfg, fn, req. These save no tokens (the tokeniser
 *   splits them identically to the full form) while imposing a real decode cost.
 *   impl is NOT in this list — it is preserved domain vocabulary (D-4).
 *
 *   EXPANSION direction — new content must not expand groundwork domain
 *   vocabulary (AC, TBD, TBR, impl) to their full English forms when the short
 *   form was used in the original. These are defined terms-of-art in doc/specs/;
 *   expanding them breaks search recall and requirement tracing.
 *
 * SCOPING RULE (fires only when ALL conditions hold):
 *   1. Tool is Edit, Write, or MultiEdit.
 *   2. File path is a prose surface: .md files, or paths under agents/,
 *      agents-src/, agents-pi/, or skills/ directories.
 *   3. For contraction: the abbreviation appears as a standalone word (\b…\b)
 *      in new content but NOT in old content (newly introduced).
 *      Fenced code blocks and inline backtick spans are stripped before
 *      matching to avoid false positives on code examples embedded in prose.
 *   4. For expansion: old content contains the short domain term; new content
 *      contains the full English form AND does not also retain the short form
 *      (retaining both is a valid first-use parenthetical definition, e.g.
 *      "acceptance criteria (AC)", and does not trigger the guard).
 *
 * ADVISORY-ONLY — never blocks. permissionDecision is always "allow"; the
 * finding is surfaced via permissionDecisionReason so the model sees the
 * warning but the write proceeds.
 *
 * Escape hatch: GROUNDWORK_PROSE_ABBREVIATION_GUARD=0 → passthrough.
 *
 * FAIL-OPEN: any error / malformed stdin → emit nothing, exit 0.
 */

import fs from 'node:fs'
import { readStdin, passthrough } from './lib/hook-io.mjs'
import { isProse } from './lib/prose-helpers.mjs'

const GUARDED = new Set(['Edit', 'Write', 'MultiEdit'])

// ---------------------------------------------------------------------------
// Ad-hoc abbreviations — must NOT be newly introduced (contraction direction)
// Each pattern uses word boundaries; inline code is stripped before testing.
// ---------------------------------------------------------------------------
const PROHIBITED_ABBREVS = [
  { re: /\bcfg\b/, label: 'cfg', standsFor: 'configuration' },
  { re: /\bfn\b/, label: 'fn', standsFor: 'function' },
  { re: /\breq\b/, label: 'req', standsFor: 'requirement' },
]

// ---------------------------------------------------------------------------
// Domain vocabulary — must NOT be expanded to full English (expansion direction)
// D-4: AC, TBD, TBR, impl are defined terms-of-art; expanding them costs tokens
// and loses precision. impl is NOT a prohibited abbreviation — it is preserved.
// ---------------------------------------------------------------------------
const DOMAIN_VOCAB = [
  {
    label: 'AC',
    shortRe: /\bAC\b/,
    fullRe: /\bacceptance[\s-]+criteri(?:on|a)\b/i,
  },
  {
    label: 'TBD',
    shortRe: /\bTBD\b/,
    fullRe: /\bto[\s-]+be[\s-]+determined\b/i,
  },
  {
    label: 'TBR',
    shortRe: /\bTBR\b/,
    fullRe: /\bto[\s-]+be[\s-]+reviewed\b/i,
  },
  {
    label: 'impl',
    shortRe: /\bimpl\b/,
    fullRe: /\bimplementation\b/i,
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip fenced code blocks and inline backtick spans from text. */
function stripCode(text) {
  let s = text.replace(/```[\s\S]*?```/g, ' ')
  s = s.replace(/`[^`\n]+`/g, ' ')
  return s
}

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
 * Check contraction direction: abbreviations newly present in newText vs oldText.
 * Returns { label, standsFor }[] for any newly introduced abbreviations.
 */
function checkContraction(oldText, newText) {
  const oldStripped = stripCode(oldText)
  const newStripped = stripCode(newText)
  const violations = []
  for (const { re, label, standsFor } of PROHIBITED_ABBREVS) {
    const inOld = re.test(oldStripped)
    const inNew = re.test(newStripped)
    if (!inOld && inNew) {
      violations.push({ label, standsFor })
    }
  }
  return violations
}

/**
 * Check expansion direction: short domain term in old but full form in new
 * without retaining the short form (a pure replacement, not a definition).
 * Returns string[] of expanded labels.
 */
function checkExpansion(oldText, newText) {
  const oldStripped = stripCode(oldText)
  const newStripped = stripCode(newText)
  const violations = []
  for (const { label, shortRe, fullRe } of DOMAIN_VOCAB) {
    const oldHasShort = shortRe.test(oldStripped)
    const newHasFull = fullRe.test(newStripped)
    const newHasShort = shortRe.test(newStripped)
    // Fire only when: old used short form, new has full form, and new no longer
    // has the short form (i.e., a pure expansion rather than a first-use definition).
    if (oldHasShort && newHasFull && !newHasShort) {
      violations.push(label)
    }
  }
  return violations
}

function buildReason(contractions, expansions) {
  const parts = []
  if (contractions.length > 0) {
    const list = contractions.map((v) => `\`${v.label}\` (abbreviation for ${v.standsFor})`).join(', ')
    parts.push(
      `prose-abbreviation-guard: ad-hoc abbreviation(s) introduced in new content: ${list}. ` +
        `These save no tokens and impose a decode cost on the reader. TOKEN-ECONOMY-R-006.`,
    )
  }
  if (expansions.length > 0) {
    const list = expansions.map((l) => `\`${l}\``).join(', ')
    parts.push(
      `prose-abbreviation-guard: domain vocabulary expanded in new content: ${list}. ` +
        `These are defined terms-of-art; retain the short form. TOKEN-ECONOMY-R-006.`,
    )
  }
  return parts.join(' | ')
}

function maybeAdvise(oldStr, newStr) {
  const contractions = checkContraction(oldStr, newStr)
  const expansions = checkExpansion(oldStr, newStr)
  if (contractions.length > 0 || expansions.length > 0) {
    advise(buildReason(contractions, expansions))
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (process.env.GROUNDWORK_PROSE_ABBREVIATION_GUARD === '0') return passthrough()

  let input = {}
  try {
    const raw = await readStdin()
    if (raw.trim()) input = JSON.parse(raw)
  } catch {
    return passthrough()
  }

  const tool = typeof input?.tool_name === 'string' ? input.tool_name : ''
  if (!GUARDED.has(tool)) return passthrough()

  const toolInput = input?.tool_input ?? {}

  if (tool === 'Edit') {
    const filePath = typeof toolInput.file_path === 'string' ? toolInput.file_path : ''
    if (!isProse(filePath)) return passthrough()
    const oldStr = typeof toolInput.old_string === 'string' ? toolInput.old_string : ''
    const newStr = typeof toolInput.new_string === 'string' ? toolInput.new_string : ''
    maybeAdvise(oldStr, newStr)
    return passthrough()
  }

  if (tool === 'Write') {
    const filePath = typeof toolInput.file_path === 'string' ? toolInput.file_path : ''
    if (!isProse(filePath)) return passthrough()
    const newContent = typeof toolInput.content === 'string' ? toolInput.content : ''
    let oldContent = ''
    try {
      oldContent = fs.readFileSync(filePath, 'utf8')
    } catch {
      // New file — no prior content to protect
    }
    maybeAdvise(oldContent, newContent)
    return passthrough()
  }

  if (tool === 'MultiEdit') {
    const filePath = typeof toolInput.file_path === 'string' ? toolInput.file_path : ''
    if (!isProse(filePath)) return passthrough()
    const edits = Array.isArray(toolInput.edits) ? toolInput.edits : []
    const allContractions = []
    const allExpansions = []
    for (const edit of edits) {
      const oldStr = typeof edit?.old_string === 'string' ? edit.old_string : ''
      const newStr = typeof edit?.new_string === 'string' ? edit.new_string : ''
      const c = checkContraction(oldStr, newStr)
      const e = checkExpansion(oldStr, newStr)
      allContractions.push(...c)
      allExpansions.push(...e)
    }
    const uniqueContractions = [...new Map(allContractions.map((v) => [v.label, v])).values()]
    const uniqueExpansions = [...new Set(allExpansions)]
    if (uniqueContractions.length > 0 || uniqueExpansions.length > 0) {
      advise(buildReason(uniqueContractions, uniqueExpansions))
    }
    return passthrough()
  }

  return passthrough()
}

main().catch(() => passthrough())
