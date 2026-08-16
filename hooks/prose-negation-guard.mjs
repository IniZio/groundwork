#!/usr/bin/env node
/**
 * Groundwork PreToolUse hook — prose negation guard (TOKEN-ECONOMY-R-004).
 *
 * Compression shall never remove `not`, `never`, `no`, `only`, or `except`
 * from any prose, regardless of intensity level.
 *
 * ADVISORY-ONLY — NEVER blocks an edit. Always returns permissionDecision
 * "allow"; findings are surfaced via permissionDecisionReason so the model
 * sees the warning but the write proceeds.
 *
 * Detection cliff: the guard detects negation loss only when roughly 40% or
 * more of a sentence's vocabulary survives the edit. Wholesale rewrites pass
 * silently BY DESIGN — see hooks/lib/prose-helpers.mjs for the measurement.
 *
 * Escape hatches:
 *   - env var GROUNDWORK_PROSE_NEGATION_GUARD=0  → passthrough
 *   - content contains `// prose-negation-guard:disable`  → passthrough
 *
 * FAIL-OPEN: any error / malformed stdin → emit nothing, exit 0.
 */

import fs from 'node:fs'
import { readStdin, passthrough } from './lib/hook-io.mjs'
import { isProse, splitSentences, matchSentence } from './lib/prose-helpers.mjs'

const GUARDED = new Set(['Edit', 'Write', 'MultiEdit'])

const NEGATION_WORDS = ['not', 'never', 'no', 'only', 'except']

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

/** Find negation words present in a surviving old sentence but absent from its matched new sentence. */
function removedNegations(from, to) {
  const oldSents = splitSentences(from)
  const newSents = splitSentences(to)
  const removed = new Set()
  for (const os of oldSents) {
    const matched = matchSentence(os, newSents)
    if (matched === null) continue  // Sentence deleted wholesale — not inviolable
    for (const word of NEGATION_WORDS) {
      const re = new RegExp('\\b' + word + '\\b', 'i')
      if (re.test(os) && !re.test(matched)) removed.add(word)
    }
  }
  return [...removed]
}

function reportAdvise(removed) {
  advise(
    `prose-negation-guard: negation word(s) removed without restoration in replacement: ${removed.join(', ')}. ` +
      `TOKEN-ECONOMY-R-004 — existing negations are inviolable.`,
  )
}

async function main() {
  if (process.env.GROUNDWORK_PROSE_NEGATION_GUARD === '0') return passthrough()

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

  // Escape hatch: disable marker in any writable content
  const allContent = [
    toolInput.content ?? '',
    toolInput.new_string ?? '',
    ...(Array.isArray(toolInput.edits) ? toolInput.edits.map((e) => e?.new_string ?? '') : []),
  ].join('\n')
  if (allContent.includes('// prose-negation-guard:disable')) return passthrough()

  if (tool === 'Edit') {
    const filePath = typeof toolInput.file_path === 'string' ? toolInput.file_path : ''
    if (!isProse(filePath)) return passthrough()
    const oldStr = typeof toolInput.old_string === 'string' ? toolInput.old_string : ''
    const newStr = typeof toolInput.new_string === 'string' ? toolInput.new_string : ''
    const removed = removedNegations(oldStr, newStr)
    if (removed.length > 0) reportAdvise(removed)
    return passthrough()
  }

  if (tool === 'Write') {
    const filePath = typeof toolInput.file_path === 'string' ? toolInput.file_path : ''
    if (!isProse(filePath)) return passthrough()
    const newContent = typeof toolInput.content === 'string' ? toolInput.content : ''
    let current = ''
    try {
      current = fs.readFileSync(filePath, 'utf8')
    } catch {
      // New file — no prior content to protect
      return passthrough()
    }
    const removed = removedNegations(current, newContent)
    if (removed.length > 0) reportAdvise(removed)
    return passthrough()
  }

  if (tool === 'MultiEdit') {
    const filePath = typeof toolInput.file_path === 'string' ? toolInput.file_path : ''
    if (!isProse(filePath)) return passthrough()
    const edits = Array.isArray(toolInput.edits) ? toolInput.edits : []
    const allRemoved = new Set()
    for (const edit of edits) {
      const oldStr = typeof edit?.old_string === 'string' ? edit.old_string : ''
      const newStr = typeof edit?.new_string === 'string' ? edit.new_string : ''
      for (const w of removedNegations(oldStr, newStr)) allRemoved.add(w)
    }
    if (allRemoved.size > 0) reportAdvise([...allRemoved])
    return passthrough()
  }

  return passthrough()
}

main().catch(() => passthrough())
