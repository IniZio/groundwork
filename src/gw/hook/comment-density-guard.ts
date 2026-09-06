/**
 * src/gw/hook/comment-density-guard.ts — comment density advisory guard.
 *
 * PreToolUse handler for Edit/Write/MultiEdit. Warns when a file would exceed
 * 5 comments per 100 lines, or when comments merely restate adjacent code.
 * Advisory only — the edit always proceeds (no permissionDecision emitted).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { HookFn, HookResult } from './types.js'
import {
  analyzeFile,
  isExcluded,
  FILE_CAP,
} from '../../../hooks/lib/comment-density.mjs'
import { findAllRestatingComments } from '../../../hooks/lib/comment-restate.mjs'

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

const GUARDED_TOOLS = new Set(['edit', 'write', 'multiedit'])

const RULE_TEXT =
  'Comments per 100 lines must stay ≤5 in every file you touch; all comment lines count including doc comments. Do not add comments that restate the adjacent code. Touching a legacy file means bringing the whole file under the cap. This rule applies to every Edit, Write, and MultiEdit call.'

function normalizeToolName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const lower = raw.toLowerCase()
  return lower.startsWith('fast_') ? lower.slice(5) : lower
}

function isSubagentCall(input: Record<string, unknown>): boolean {
  const agentType = input.agent_type
  if (typeof agentType === 'string' && agentType.trim()) return true
  if (input.agent_id) return true
  const tp = input.transcript_path
  if (typeof tp === 'string' && path.basename(tp).startsWith('agent-')) return true
  return false
}

interface EditEntry {
  old_string: string
  new_string: string
  replace_all?: boolean
}

function applyEdit(content: string, edit: EditEntry): string {
  const { old_string, new_string, replace_all } = edit
  if (replace_all) {
    return content.split(old_string).join(new_string)
  }
  const idx = content.indexOf(old_string)
  if (idx === -1) return content
  return content.slice(0, idx) + new_string + content.slice(idx + old_string.length)
}

export const run: HookFn = async (rawInput, env) => {
  try {
    if (env.GROUNDWORK_COMMENT_DENSITY === '0') return passthrough()

    if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
      return passthrough()
    }
    const input = rawInput as Record<string, unknown>

    const tool = normalizeToolName(input.tool_name)
    if (!GUARDED_TOOLS.has(tool)) return passthrough()

    const toolInput = (input.tool_input && typeof input.tool_input === 'object' && !Array.isArray(input.tool_input))
      ? (input.tool_input as Record<string, unknown>)
      : {}
    const filePath = typeof toolInput.file_path === 'string' ? toolInput.file_path : ''
    if (!filePath) return passthrough()

    const subagent = isSubagentCall(input)

    if (isExcluded(filePath)) {
      if (subagent) return warn(RULE_TEXT)
      return passthrough()
    }

    let content: string
    try {
      if (tool === 'write') {
        const c = toolInput.content
        if (typeof c !== 'string') return passthrough()
        content = c
      } else if (tool === 'edit') {
        const oldStr = toolInput.old_string
        const newStr = toolInput.new_string
        if (typeof oldStr !== 'string' || typeof newStr !== 'string') return passthrough()
        const existing = readFileSync(filePath, 'utf-8')
        content = applyEdit(existing, {
          old_string: oldStr,
          new_string: newStr,
          replace_all: toolInput.replace_all === true,
        })
      } else {
        const edits = toolInput.edits
        if (!Array.isArray(edits)) return passthrough()
        const existing = readFileSync(filePath, 'utf-8')
        content = existing
        for (const e of edits) {
          if (!e || typeof e !== 'object') return passthrough()
          const ed = e as Record<string, unknown>
          if (typeof ed.old_string !== 'string' || typeof ed.new_string !== 'string') {
            return passthrough()
          }
          content = applyEdit(content, {
            old_string: ed.old_string,
            new_string: ed.new_string,
            replace_all: ed.replace_all === true,
          })
        }
      }
    } catch {
      return passthrough()
    }

    const fileResult = analyzeFile(filePath, content)
    const restating = findAllRestatingComments(content)

    const violations: string[] = []
    if (fileResult.commentsPer100 > FILE_CAP) {
      violations.push(
        `${filePath} lines [${fileResult.lines.join(',')}]: over-cap ${fileResult.commentsPer100.toFixed(1)}/100 > ${FILE_CAP}/100`,
      )
    }
    for (const r of restating) {
      violations.push(`${filePath} line ${r.line + 1}: restating: "${r.comment}"`)
    }

    if (violations.length === 0 && !subagent) return passthrough()

    const parts: string[] = []
    if (violations.length > 0) {
      parts.push('⚠️  groundwork comment-density-guard:\n' + violations.join('\n'))
    }
    parts.push(RULE_TEXT)
    return warn(parts.join('\n\n'))
  } catch {
    return passthrough()
  }
}
