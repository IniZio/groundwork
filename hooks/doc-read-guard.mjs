#!/usr/bin/env node
/**
 * Groundwork PreToolUse hook — doc-read-guard.
 *
 * Intercepts Read, Bash, and Grep tool uses to enforce progressive disclosure
 * of large doc-class files.
 *
 * Rules (RFC-0001 T20):
 *   AC 2 — If a Read targets a doc-class file over its class budget and no
 *           "doc toc" for that path has been issued this session, deny and
 *           print the "doc toc <path>" invocation.
 *   AC 3 — If a Bash command cats or heads a doc-class file over its class
 *           budget, deny and print the "doc show <path>" invocation.
 *   AC 4 — Never deny an Edit, Write, or MultiEdit. (Defensive: these tools
 *           are not registered, but the guard double-checks.)
 *   AC 5 — A notes/ scratch file within its class budget is always permitted.
 *   AC 6 — FAIL-OPEN: any error → emit nothing, exit 0.
 *   AC 7 — Registered for Read, Bash, and Grep; passes through for Grep.
 *
 * Session TOC state: tracks which doc-class file paths have had "doc toc"
 * issued this session. Stored in a temp JSON file keyed by session_id from
 * the hook input. The hook records a toc for a path when it sees a Bash
 * command matching "doc toc <path>".
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { readStdin, passthrough, isEmbeddedAgent } from './lib/hook-io.mjs'
import { classifyDoc, estimateTokens } from './lib/doc-io.mjs'

// ---------------------------------------------------------------------------
// Session TOC state
// ---------------------------------------------------------------------------

function tocStatePath(sessionId) {
  return `${tmpdir()}/groundwork-doc-toc-${sessionId}.json`
}

function loadTocPaths(sessionId) {
  try {
    return new Set(JSON.parse(readFileSync(tocStatePath(sessionId), 'utf8')))
  } catch {
    return new Set()
  }
}

function recordTocPath(sessionId, absPath) {
  try {
    const set = loadTocPaths(sessionId)
    set.add(absPath)
    writeFileSync(tocStatePath(sessionId), JSON.stringify([...set]))
  } catch {
    // Fail-open: state write failure does not block the command.
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function deny(reason) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  )
  process.exit(0)
}

/** True if any path segment equals 'notes'. */
function isNotesScratch(absPath) {
  return absPath.split(sep).includes('notes')
}

/**
 * Extract file paths from a cat or head command.
 * Matches: cat [flags] path  and  head [flags] path
 * Handles two-word flags like "head -n 50 path" by treating a numeric token
 * immediately after a flag as the flag's value, not the path.
 * Returns an array of raw path strings (may be relative).
 */
function extractCatHeadPaths(command) {
  const paths = []
  // Match cat/head, optional flags (including two-word "-n 50" style), then path.
  // (?:-[^\s]*(?:\s+\d+)?\s+)* handles both "-n50" and "-n 50" flag forms.
  const re = /(?:^|[|;&\n])\s*(?:cat|head)\s+(?:-[^\s]*(?:\s+\d+)?\s+)*([^\s|;&\n>-][^\s|;&\n>]*)/g
  let m
  while ((m = re.exec(command)) !== null) {
    paths.push(m[1])
  }
  return paths
}

/**
 * Extract the path argument from a "doc toc <path>" command.
 * Returns the path string or null if not matched.
 */
function extractDocTocPath(command) {
  const m = command.match(/\bdoc\s+toc\s+(\S+)/)
  return m ? m[1] : null
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function handleRead(input, sessionId) {
  const fp = input?.tool_input?.file_path
  if (typeof fp !== 'string' || !fp) return

  const absPath = resolve(process.cwd(), fp)

  // AC 4 defensive: Read is never a write, but guard just in case.
  // (Not needed — Read cannot be Edit/Write — but belt-and-suspenders.)

  const cls = classifyDoc(absPath, process.cwd())
  if (!cls) return // unclassified → permit

  let content
  try {
    content = readFileSync(absPath, 'utf8')
  } catch {
    return // unreadable → fail-open (permit)
  }

  const tokens = estimateTokens(content)

  // AC 5: notes/ scratch file within budget → permit unconditionally.
  if (isNotesScratch(absPath) && tokens <= cls.budget) return

  if (tokens <= cls.budget) return // within budget → permit

  // Over budget. Check if toc has been issued for this path.
  if (!sessionId) return // no session tracking → fail-open (permit)

  const toc = loadTocPaths(sessionId)
  if (toc.has(absPath)) return // toc issued → permit

  deny(
    `doc-read-guard: ${absPath} is a '${cls.name}' doc-class file (~${tokens} tokens, budget ${cls.budget}).\n` +
      `Reading it wholesale injects the full file into context. Use progressive disclosure instead:\n\n` +
      `  doc toc ${absPath}\n\n` +
      `Then load only the section you need with:\n` +
      `  doc show ${absPath} --section <anchor>`,
  )
}

function handleBash(input, sessionId) {
  const command = input?.tool_input?.command
  if (typeof command !== 'string' || !command) return

  // If this is a "doc toc <path>" invocation, record it so subsequent
  // Reads of the same file are permitted.
  const tocRawPath = extractDocTocPath(command)
  if (tocRawPath && sessionId) {
    const absPath = resolve(process.cwd(), tocRawPath)
    recordTocPath(sessionId, absPath)
    return // permit the toc command itself
  }

  // AC 3: detect cat / head of a doc-class file over budget.
  const rawPaths = extractCatHeadPaths(command)
  for (const rawPath of rawPaths) {
    let absPath
    try {
      absPath = resolve(process.cwd(), rawPath)
    } catch {
      continue
    }

    const cls = classifyDoc(absPath, process.cwd())
    if (!cls) continue

    let content
    try {
      content = readFileSync(absPath, 'utf8')
    } catch {
      continue
    }

    const tokens = estimateTokens(content)
    if (tokens <= cls.budget) continue

    // AC 5: notes/ within budget already filtered above (tokens > budget here).
    if (isNotesScratch(absPath)) continue

    deny(
      `doc-read-guard: ${absPath} is a '${cls.name}' doc-class file (~${tokens} tokens, budget ${cls.budget}).\n` +
        `cat/head injects the full file into context. Use progressive disclosure instead:\n\n` +
        `  doc show ${absPath}\n\n` +
        `Or load a specific section with:\n` +
        `  doc show ${absPath} --section <anchor>`,
    )
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
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

    // AC 4: never deny writes — defensive guard.
    if (toolNorm === 'edit' || toolNorm === 'write' || toolNorm === 'multiedit') {
      return passthrough()
    }

    // Grep: registered per AC 7 but no action taken — pass through.
    if (toolNorm === 'grep') return passthrough()

    const sessionId = typeof input.session_id === 'string' ? input.session_id : ''

    if (toolNorm === 'read') {
      handleRead(input, sessionId)
    } else if (toolNorm === 'bash') {
      handleBash(input, sessionId)
    }
  } catch {
    // AC 6: fail-open — any unexpected error permits the call.
  }

  return passthrough()
}

main()
