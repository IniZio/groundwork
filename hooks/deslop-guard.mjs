#!/usr/bin/env node
// PreToolUse advisory comment-slop tripwire (kill-switch: GROUNDWORK_DESLOP_GUARD=0).

import { readStdin, passthrough } from './lib/hook-io.mjs'
import { classifyLines } from './lib/comment-scan.mjs'
import { findRestatingComments, findMultiWordRestatingComments, findProseParaphraseComments } from './lib/comment-restate.mjs'

const GUARDED = new Set(['Edit', 'Write', 'MultiEdit'])

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

const ALLOW_LINE = [
  /^\s*\*/,
  /^\s*\/\*\*/,
  /^\s*\/\*/,
  /^\s*\*\//,
  /^\s*\/\/\s*@/,
  /^#!/,
]

const LICENSE_LINE = /\b(Copyright|Licensed|MIT|Apache|BSD|ISC|GPL|MPL)\b/i

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

const ALLOW_BLOCK_BODY = [
  /^\s*\/\*\*?/,
  /^\s*\*\//,
  /^\s*\*\s*@/,
]

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
    // note:/disclaimer: omitted here — false-positive flood on block-body annotations; still caught by SLOP in single-line // comments.
    re: /^\s*\*\s*(just\s+|simply\s+)/i,
  },
  {
    label: 'AI emoji in block comment',
    re: /^\s*\*.*[\u{1F300}-\u{1FAFF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2728}\u{2705}\u{274C}\u{26A1}\u{2B50}\u{2757}]/u,
  },
]

// Detect 3+ code-like commented lines (identifier/symbol start).
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

function isAllowed(line, idx) {
  for (const re of ALLOW_LINE) if (re.test(line)) return true
  if (idx < 5 && LICENSE_LINE.test(line)) return true
  return false
}

function detectSlop(content) {
  if (typeof content !== 'string' || !content) return []
  if (process.env.GROUNDWORK_DESLOP_GUARD === '0') return []
  if (/deslop:disable/.test(content)) return []

  const lines = content.split(/\r?\n/)
  const findings = []

  let lineKinds = null
  try {
    lineKinds = classifyLines(content)
  } catch {
    // Falls back to inline predicate below.
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (isAllowed(line, i)) continue
    for (const { label, re } of SLOP) {
      if (re.test(line)) {
        findings.push(`line ${i + 1}: ${label} — ${line.trim().slice(0, 120)}`)
        break
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
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

  for (const blk of findCommentedCodeBlocks(lines)) {
    const sample = lines[blk.start].trim().slice(0, 80)
    findings.push(`line ${blk.start + 1}: commented-out code block (${blk.len} consecutive // lines that look like code) — ${sample}…`)
  }

  for (const r of findRestatingComments(lines)) {
    findings.push(`line ${r.line + 1}: restating comment "// ${r.name}" immediately above its declaration — drop it`)
  }

  for (const r of findMultiWordRestatingComments(lines)) {
    findings.push(`line ${r.line + 1}: multi-word restating comment "// ${r.comment}" above ${r.identName} — all content words are in the identifier, drop it`)
  }

  for (const r of findProseParaphraseComments(lines)) {
    findings.push(`line ${r.line + 1}: prose-paraphrase comment "// ${r.comment}" narrates the line below without adding info — drop it`)
  }

  return findings
}

function targetContent(_toolName, toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return ''
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
