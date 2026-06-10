// ─── background_stream Tool ────────────────────────────────────────────────

import { tool } from '@opencode-ai/plugin'
import { z } from 'zod'
import { manager } from '../lib/singletons.js'
import { extractMessages, truncateText } from '../lib/helpers.js'
import type { ToolDeps } from './deps.js'

export function createBackgroundStreamTool(deps: ToolDeps) {
  const { client } = deps
  return tool({
    description: 'Get partial output from a running background task. Useful for monitoring long-running tasks without waiting for completion.',
    args: {
      task_id: z.string().describe('Task ID to stream output from'),
      offset: z.number().optional().describe('Character offset to start from (default: 0 for beginning)'),
    },
    async execute(args: any) {
      try {
        let task = manager.getTask(args.task_id)
        if (!task) {
          await manager.recoverStateForTask(args.task_id)
          task = manager.getTask(args.task_id)
        }
        if (!task) return `Task not found: ${args.task_id}`
        if (!task.sessionID) return `Task has no session ID`

        const resp = await client.session.messages({ path: { id: task.sessionID } })
        const messages = extractMessages(resp)

        if (!messages.length) {
          return `Task ${args.task_id} has no messages yet.\nStatus: ${task.status}\nOffset: ${args.offset || 0}`
        }

        const extracted: string[] = []
        for (const msg of messages) {
          if (msg.info?.role !== 'assistant') continue
          for (const part of msg.parts || []) {
            if (part.type === 'text' && part.text) extracted.push(part.text)
            else if (part.type === 'reasoning' && part.text) extracted.push(part.text)
            else if (part.type === 'thinking' && part.text) extracted.push(part.text)
            else if (part.type === 'tool' && part.state) {
              if (part.state.status === 'completed' && part.state.title) extracted.push(`[Tool: ${part.tool}] ${part.state.title}`)
              else if (part.state.status === 'error') extracted.push(`[Tool: ${part.tool}] ERROR: ${part.state.title || 'unknown error'}`)
            }
          }
        }

        const fullContent = extracted.join('\n\n')
        const offset = args.offset || 0

        if (offset >= fullContent.length) {
          return `Task ${args.task_id}\nStatus: ${task.status}\nTotal length: ${fullContent.length}\nNo new content since offset ${offset}\nIs running: ${task.status === 'running'}`
        }

        const newContent = fullContent.slice(offset)
        const newLength = newContent.length
        const totalLength = fullContent.length
        const isRunning = task.status === 'running' || task.status === 'pending' || task.status === 'waiting'

        if (task.status === 'running') {
          ;(task as any).lastOutputLength = totalLength
        }

        return `Task ${args.task_id} — ${task.status}\nTotal: ${totalLength} chars | New: ${newLength} chars | Offset: ${offset}\nRunning: ${isRunning}\n\n---\n\n${truncateText(newContent, 4000)}\n\n---\n\nNext offset: ${totalLength}`
      } catch (error) {
        return `Error streaming output: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  })
}
