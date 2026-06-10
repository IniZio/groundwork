// ─── background_list Tool ────────────────────────────────────────────────────

import { tool } from '@opencode-ai/plugin'
import { z } from 'zod'
import { manager } from '../lib/singletons.js'
import { formatTaskList } from '../lib/task-formatting.js'
import type { ToolDeps } from './deps.js'

export function createBackgroundListTool(_deps: ToolDeps) {
  return tool({
    description: 'List background tasks for this session.',
    args: {
      include_completed: z.boolean().optional().describe('Include completed/failed tasks (default: false, shows only active)'),
    },
    async execute(args: any, toolContext: any) {
      try {
        let allTasks = manager.getAllDescendantTasks(toolContext.sessionID)
        if (!allTasks.length) {
          await manager.recoverState(toolContext.sessionID)
          allTasks = manager.getAllDescendantTasks(toolContext.sessionID)
        }
        const tasks = args.include_completed
          ? allTasks
          : allTasks.filter((t: any) => t.status === 'running' || t.status === 'pending')
        return formatTaskList(tasks, toolContext.sessionID, { include_completed: args.include_completed })
      } catch (error) {
        return `Error listing tasks: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  })
}
