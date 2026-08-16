#!/usr/bin/env node
/**
 * Groundwork PreToolUse hook — prose modality guard (TOKEN-ECONOMY-R-005).
 *
 * Compression shall not upgrade a modal hedge (may, could, sometimes,
 * is likely to, might, appears to) to a stronger claim (will, does, always)
 * in any prose output.
 *
 * ADVISORY-ONLY — NEVER blocks an edit. Always returns permissionDecision
 * "allow"; findings are surfaced via permissionDecisionReason.
 *
 * Escape hatches:
 *   - env var GROUNDWORK_PROSE_MODALITY_GUARD=0  → passthrough
 *   - content contains `// prose-modality-guard:disable`  → passthrough
 *
 * FAIL-OPEN: any error / malformed stdin → emit nothing, exit 0.
 */

import fs from 'node:fs'
import { readStdin, passthrough } from './lib/hook-io.mjs'

const GUARDED = new Set(['Edit', 'Write', 'MultiEdit'])

// Multi-word hedges checked via substring after word-boundary normalisation.
const MODAL_HEDGES = ['may', 'could', 'sometimes', 'might', 'appears to', 'is likely to']
const STRONG_ASSERTIONS = ['will', 'does', 'always', 'is']

/** Returns true if this file path is a prose surface that the guard should protect. */
function isProse(filePath) {
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
function splitSentences(text) {
  return text.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(s => s.length > 3)
}

/** Jaccard similarity of word sets (case-insensitive). */
function jaccard(a, b) {
  const wa = new Set(a.toLowerCase().match(/\w+/g) ?? [])
  const wb = new Set(b.toLowerCase().match(/\w+/g) ?? [])
  let isect = 0
  for (const w of wa) if (wb.has(w)) isect++
  const union = wa.size + wb.size - isect
  return union === 0 ? 0 : isect / union
}

/** Find best-matching sentence in newSents for oldSent. Returns null if below threshold. */
function matchSentence(oldSent, newSents, threshold = 0.4) {
  let best = null, bestScore = -1
  for (const ns of newSents) {
    const s = jaccard(oldSent, ns)
    if (s > bestScore) { bestScore = s; best = ns }
  }
  return bestScore >= threshold ? best : null
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

/** Test whether a term is present in text (word-boundary for single words; substring for phrases). */
function present(term, text) {
  if (term.includes(' ')) return text.toLowerCase().includes(term.toLowerCase())
  return new RegExp('\\b' + term + '\\b', 'i').test(text)
}

/**
 * Returns { removedHedges, addedAssertions } for aligned sentences only.
 * Only fires when a SURVIVING sentence loses a hedge AND gains an assertion.
 */
function detectUpgrade(oldStr, newStr) {
  const oldSents = splitSentences(oldStr)
  const newSents = splitSentences(newStr)
  const removedHedges = new Set()
  const addedAssertions = new Set()
  for (const os of oldSents) {
    const matched = matchSentence(os, newSents)
    if (matched === null) continue  // Sentence deleted wholesale — skip
    for (const h of MODAL_HEDGES) {
      if (!present(h, os) || present(h, matched)) continue  // hedge not removed
      for (const a of STRONG_ASSERTIONS) {
        if (!present(a, os) && present(a, matched)) {
          removedHedges.add(h)
          addedAssertions.add(a)
        }
      }
    }
  }
  return { removedHedges: [...removedHedges], addedAssertions: [...addedAssertions] }
}

function reportAdvise(removedHedges, addedAssertions) {
  advise(
    `prose-modality-guard: modal hedge(s) removed [${removedHedges.join(', ')}] while stronger assertion(s) added [${addedAssertions.join(', ')}]. ` +
      `TOKEN-ECONOMY-R-005 — hedges carry the author's confidence and must be preserved.`,
  )
}

async function main() {
  if (process.env.GROUNDWORK_PROSE_MODALITY_GUARD === '0') return passthrough()

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
  if (allContent.includes('// prose-modality-guard:disable')) return passthrough()

  if (tool === 'Edit') {
    const filePath = typeof toolInput.file_path === 'string' ? toolInput.file_path : ''
    if (!isProse(filePath)) return passthrough()
    const oldStr = typeof toolInput.old_string === 'string' ? toolInput.old_string : ''
    const newStr = typeof toolInput.new_string === 'string' ? toolInput.new_string : ''
    const { removedHedges, addedAssertions } = detectUpgrade(oldStr, newStr)
    if (removedHedges.length > 0 && addedAssertions.length > 0)
      reportAdvise(removedHedges, addedAssertions)
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
    const { removedHedges, addedAssertions } = detectUpgrade(current, newContent)
    if (removedHedges.length > 0 && addedAssertions.length > 0)
      reportAdvise(removedHedges, addedAssertions)
    return passthrough()
  }

  if (tool === 'MultiEdit') {
    const filePath = typeof toolInput.file_path === 'string' ? toolInput.file_path : ''
    if (!isProse(filePath)) return passthrough()
    const edits = Array.isArray(toolInput.edits) ? toolInput.edits : []
    const allRemovedHedges = new Set()
    const allAddedAssertions = new Set()
    for (const edit of edits) {
      const oldStr = typeof edit?.old_string === 'string' ? edit.old_string : ''
      const newStr = typeof edit?.new_string === 'string' ? edit.new_string : ''
      const { removedHedges, addedAssertions } = detectUpgrade(oldStr, newStr)
      for (const h of removedHedges) allRemovedHedges.add(h)
      for (const a of addedAssertions) allAddedAssertions.add(a)
    }
    if (allRemovedHedges.size > 0 && allAddedAssertions.size > 0)
      reportAdvise([...allRemovedHedges], [...allAddedAssertions])
    return passthrough()
  }

  return passthrough()
}

main().catch(() => passthrough())
