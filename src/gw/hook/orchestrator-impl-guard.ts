/**
 * TypeScript port of hooks/orchestrator-impl-guard.mjs — orchestrator direct-implementation guard.
 * Stateless: takes pre-parsed input and env; no process.exit(), no readStdin().
 *
 * WARNS (non-blocking) when the orchestrator attempts Edit/Write/MultiEdit/NotebookEdit
 * directly instead of delegating. The edit still proceeds — only an additionalContext
 * nudge is emitted, no permissionDecision.
 */
import os from 'node:os'
import path from 'node:path'
import type { HookFn, HookResult } from './types.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

function passthrough(): HookResult {
  return { stdout: '', stderr: '', exit: 0 }
}

function warn(reason: string): HookResult {
  return {
    stdout:
      JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: reason },
      }) + '\n',
    stderr: '',
    exit: 0,
  }
}

// ── Policy constants ──────────────────────────────────────────────────────────

/**
 * Canonical guarded tool names (lowercase, no fast_ prefix).
 * Normalization: lowercase → strip leading "fast_" → match here.
 */
const GUARDED_CANONICAL = new Set(['edit', 'write', 'multiedit', 'notebookedit'])

// ── Pure helpers ──────────────────────────────────────────────────────────────

/** Normalize a raw tool name to its canonical form for guard matching. */
function normalizeToolName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const lower = raw.toLowerCase()
  return lower.startsWith('fast_') ? lower.slice(5) : lower
}

/** Is the caller a delegated subagent (which is SUPPOSED to implement)? */
function isSubagentCall(input: Record<string, unknown>): boolean {
  const agentType = input.agent_type
  if (typeof agentType === 'string' && agentType.trim()) return true
  if (input.agent_id) return true
  const tp = input.transcript_path
  if (typeof tp === 'string' && path.basename(tp).startsWith('agent-')) return true
  return false
}

/**
 * Returns true when the orchestrator is permitted to write the target path
 * directly (content already held in context — no codebase read required).
 *
 * Permit 1 — session/project memory files:
 *   Path must be under ~/.claude/projects/<hash>/memory/<file>
 *   Anchored to os.homedir() so source-tree spoof paths do NOT match.
 */
function isOrchestratorWritablePath(rawPath: unknown): boolean {
  if (typeof rawPath !== 'string' || !rawPath) return false
  let resolved: string
  try {
    resolved = path.resolve(rawPath)
  } catch {
    return false
  }

  // Permit 1: ~/.claude/projects/<hash>/memory/<file>
  const memoryBase = path.join(os.homedir(), '.claude', 'projects')
  if (resolved.startsWith(memoryBase + path.sep)) {
    const rel = resolved.slice(memoryBase.length + 1) // "<hash>/memory/<file>"
    const segments = rel.split(path.sep)
    // segments: [0]=hash, [1]="memory", [2+]=filename — require all three levels
    if (segments.length >= 3 && segments[1] === 'memory') return true
  }

  return false
}

/** Is this file path the run ledger (`…/.groundwork/run.json`)? */
function isLedgerPath(fp: unknown): boolean {
  if (typeof fp !== 'string' || !fp) return false
  const norm = path.normalize(fp)
  return (
    path.basename(norm) === 'run.json' && path.basename(path.dirname(norm)) === '.groundwork'
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export const run: HookFn = async (rawInput, _env) => {
  try {
    const input = (rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
      ? rawInput
      : {}) as Record<string, unknown>

    const rawTool = typeof input.tool_name === 'string' ? input.tool_name : ''
    const tool = normalizeToolName(rawTool)
    if (!GUARDED_CANONICAL.has(tool)) return passthrough()

    // Subagents are the intended implementers — never block them.
    if (isSubagentCall(input)) return passthrough()

    // Ledger file itself is governed by ledger-guard; its init Write stays free.
    const filePath = (input.tool_input as Record<string, unknown> | undefined)?.file_path
    if (isLedgerPath(filePath)) return passthrough()

    // Narrow permit: memory files the orchestrator composes in-context.
    if (isOrchestratorWritablePath(filePath)) return passthrough()

    // Absolute path to ledger bin — resolved relative to this file's location.
    // src/gw/hook/ → up 3 levels to project root → bin/ledger
    const here = path.dirname(new URL(import.meta.url).pathname)
    const LEDGER_BIN = path.resolve(here, '..', '..', '..', 'bin', 'ledger')

    return warn(
      `⚠️  groundwork: orchestrator ${rawTool} — HIGHLY ENCOURAGED to delegate this change instead of implementing directly:\n` +
        `  task(subagent_type="groundwork:general-purpose", background=true, model="claude-sonnet-4-6", prompt="<file path> + exact change + success criteria")\n` +
        `  Then mark it complete: ${LEDGER_BIN} complete <id>\n` +
        `  (Edit is proceeding, but delegation keeps expensive opus load off direct implementation.)`,
    )
  } catch {
    return passthrough()
  }
}
