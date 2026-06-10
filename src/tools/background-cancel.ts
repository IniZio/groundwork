// ─── background_cancel Tool ────────────────────────────────────────────────

import { tool } from '@opencode-ai/plugin'
import { z } from 'zod'
import { manager } from '../lib/singletons.js'
import type { ToolDeps } from './deps.js'

export function createBackgroundCancelTool(_deps: ToolDeps) {
  return tool({
    description: 'Cancel background task(s). Use all=true for all.',
    args: {
      taskId: z.string().optional().describe('Task ID to cancel'),
      all: z.boolean().optional().describe('Cancel all running background tasks'),
    },
    async execute(args: any, toolContext: any) {
      try {
        if (args.all === true) {
          const tasks = manager.getAllDescendantTasks(toolContext.sessionID)
          const cancellable = tasks.filter((t: any) => t.status === 'running' || t.status === 'pending')
          if (cancellable.length === 0) return 'No running or pending background tasks to cancel.'
          const results: string[] = []
          for (const t of cancellable) {
            await manager.cancelTask(t.id, { source: 'background_cancel', abortSession: t.status === 'running', skipNotification: true })
            results.push(`- \`${t.id}\`: ${t.description}`)
          }
          return `Cancelled ${results.length} task(s):\n${results.join('\n')}`
        }
        if (!args.taskId) return '[ERROR] Provide a taskId or set all=true.'
        const task = manager.getTask(args.taskId)
        if (!task) return `[ERROR] Task not found: ${args.taskId}`
        if (task.status !== 'running' && task.status !== 'pending') return `[ERROR] Cannot cancel task with status "${task.status}".`
        await manager.cancelTask(task.id, { source: 'background_cancel', abortSession: task.status === 'running', skipNotification: true })
        return `Task cancelled:\n- ID: ${task.id}\n- Description: ${task.description}`
      } catch (error) {
        return `[ERROR] ${error instanceof Error ? error.message : String(error)}`
      }
    },
  })
}
