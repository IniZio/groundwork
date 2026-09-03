#!/usr/bin/env node
// check-comments-exempt — hook; opening block-comment is the tool doc
/**
 * Groundwork PostToolUse hook — doc-size-guard.
 *
 * Fires after Write, Edit, or MultiEdit. If the target is a doc-class file
 * that exceeds its class token budget AND is missing a summary header or a
 * section anchor, prints a violation message to stdout naming the path, class,
 * measured tokens, budget, and missing element.
 *
 * Design guarantees (RFC-0001 T20):
 *   AC 1 — violation printed for over-budget doc-class file missing structural
 *           elements (summary-header and/or section-anchor).
 *   AC 6 — FAIL-OPEN: any error → emit nothing, exit 0. A PostToolUse hook
 *           cannot block a tool anyway, but it must never crash or produce
 *           garbage output. The fail-open catch is at two levels:
 *           (a) the JSON parse try/catch exits via passthrough on failure;
 *           (b) the outer try/catch around all classification logic catches
 *           any downstream error (file read, classifyDoc, etc.).
 *   AC 7 — registered in hooks.json only after this file exists.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readStdin, passthrough, isEmbeddedAgent } from './lib/hook-io.mjs'
import { classifyDoc, estimateTokens, checkStructure } from './lib/doc-io.mjs'

const GUARDED = new Set(['write', 'edit', 'multiedit'])

async function main() {
  // SDK-embedded agents do not participate in the doc-size guard.
  if (isEmbeddedAgent()) return passthrough()

  let input = {}
  try {
    const raw = await readStdin()
    if (raw.trim()) input = JSON.parse(raw)
  } catch {
    return passthrough()
  }

  try {
    const rawTool = typeof input?.tool_name === 'string' ? input.tool_name : ''
    const toolNorm = rawTool.toLowerCase().replace(/^fast_/, '')
    if (!GUARDED.has(toolNorm)) return passthrough()

    const fp = input?.tool_input?.file_path
    if (typeof fp !== 'string' || !fp) return passthrough()

    const absPath = resolve(process.cwd(), fp)
    const cls = classifyDoc(absPath, process.cwd())
    if (!cls) return passthrough()

    let content
    try {
      content = readFileSync(absPath, 'utf8')
    } catch {
      // File unreadable (e.g. deleted) — fail-open.
      return passthrough()
    }

    const tokens = estimateTokens(content)
    if (tokens <= cls.budget) return passthrough()

    const { hasSummaryHeader, hasSectionAnchor } = checkStructure(content)
    // Over budget but structurally sound → doc lint will warn; guard is silent.
    if (hasSummaryHeader && hasSectionAnchor) return passthrough()

    const missing = []
    if (!hasSummaryHeader) missing.push('summary-header')
    if (!hasSectionAnchor) missing.push('section-anchor')

    process.stdout.write(
      `doc-size-guard: violation\n` +
        `  path:    ${absPath}\n` +
        `  class:   ${cls.name}\n` +
        `  tokens:  ~${tokens} (budget ${cls.budget})\n` +
        `  missing: ${missing.join(', ')}\n`,
    )
  } catch {
    // Fail-open: any classification or I/O error → proceed silently.
  }

  process.exit(0)
}

main()
