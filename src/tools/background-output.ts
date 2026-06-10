// ─── background_output Tool ───────────────────────────────────────────────
// Reads the persisted result of a background task. With the fix to
// background-manager.ts, session.prompt() now awaits synchronously, so
// the agent's response text is reliably captured and no inbox/deep
// recovery is needed.

import { tool } from '@opencode-ai/plugin'
import { z } from 'zod'
import { manager, persistence } from '../lib/singletons.js'
import { formatTaskResult, formatTaskStatus } from '../lib/task-formatting.js'
import type { ToolDeps } from './deps.js'

export function createBackgroundOutputTool(deps: ToolDeps) {
  const { client } = deps
  return tool({
    description: 'Get background task output. Call after notification.',
    args: {
      task_id: z.string().describe('Task ID to get output from'),
      block: z.boolean().optional().describe('Wait for completion (default: false)'),
      timeout: z.number().optional().describe('Max wait time in ms when blocking (default: 60000, max: 600000)'),
    },
    async execute(args: any) {
      try {
        let task = manager.getTask(args.task_id)
        if (!task) {
          await manager.recoverStateForTask(args.task_id)
          task = manager.getTask(args.task_id)
        }
        if (!task) return `Task not found: ${args.task_id}`

        const shouldBlock = args.block === true
        const timeoutMs = Math.min(args.timeout ?? 60000, 600000)
        let resolvedTask = task
        const isActive = (t: any) => t.status === 'pending' || t.status === 'running'

        if (shouldBlock && isActive(task)) {
          const start = Date.now()
          while (Date.now() - start < timeoutMs) {
            await new Promise(r => setTimeout(r, 1000))
            const current = manager.getTask(args.task_id)
            if (!current) return `Task was deleted: ${args.task_id}`
            resolvedTask = current
            if (!isActive(current)) break
          }
        }

        const terminal = resolvedTask.status === 'completed' || resolvedTask.status === 'error' || resolvedTask.status === 'cancelled' || resolvedTask.status === 'interrupt'

        if (terminal) {
          manager.markRead(resolvedTask.id)
          const persisted = await persistence.read(resolvedTask.id, resolvedTask.parentSessionID, manager.directory)
          const isEmpty = !persisted || ['(No text output)', '(No messages found)', '(No assistant or tool response found)', 'Error: Task has no sessionID']
            .some(e => persisted.startsWith(e) || persisted.endsWith(e) || persisted.includes(e))

          if (persisted && !isEmpty) return persisted

          // Single attempt to get result from session
          if (resolvedTask.status === 'completed' || resolvedTask.status === 'error') {
            const freshResult = await formatTaskResult(resolvedTask, client, { sessionID: resolvedTask.sessionID })
            if (freshResult && !freshResult.includes('(No text output)') && !freshResult.startsWith('Error')) {
              void manager.persistResult(resolvedTask).catch(() => {})
            }
            return freshResult
          }
        }

        return formatTaskStatus(resolvedTask)
      } catch (error) {
        return `Error getting output: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  })
}
