// ─── background_status Tool ────────────────────────────────────────────────

import { tool } from '@opencode-ai/plugin'
import { z } from 'zod'
import { manager, persistence } from '../lib/singletons.js'
import { formatTaskStatus } from '../lib/task-formatting.js'
import { formatDuration, truncateText } from '../lib/helpers.js'
import type { ToolDeps } from './deps.js'

export function createBackgroundStatusTool(deps: ToolDeps) {
  const { client } = deps
  return tool({
    description: 'Get detailed health information about a running or completed background task.',
    args: {
      task_id: z.string().describe('Task ID to get status for'),
    },
    async execute(args: any) {
      try {
        let task = manager.getTask(args.task_id)
        if (!task) {
          await manager.recoverStateForTask(args.task_id)
          task = manager.getTask(args.task_id)
        }
        if (!task) return `Task not found: ${args.task_id}`

        const lines: string[] = []
        lines.push(`Task ID: ${task.id}`)
        lines.push(`Description: ${task.description || '(no description)'}`)
        lines.push(`Agent: ${task.agent || 'unknown'}`)
        lines.push(`Status: ${formatTaskStatus(task).split(' — ')[1] || task.status}`)

        const duration = task.status === 'pending'
          ? formatDuration(task.queuedAt, undefined)
          : formatDuration(task.startedAt, task.completedAt)
        lines.push(`Duration: ${duration}`)

        if (task.progress) {
          lines.push(`Tool Calls: ${task.progress.toolCalls || 0}`)
          lines.push(`Last Update: ${task.progress.lastUpdate ? task.progress.lastUpdate.toISOString() : 'N/A'}`)
          lines.push(`Last Tool: ${task.progress.lastTool || 'N/A'}`)
        } else {
          lines.push(`Tool Calls: 0`)
          lines.push(`Last Update: N/A`)
          lines.push(`Last Tool: N/A`)
        }

        const now = new Date()
        const lastUpdate = task.progress?.lastUpdate || task.startedAt || task.queuedAt
        const timeSinceUpdate = lastUpdate ? now.getTime() - lastUpdate.getTime() : 0
        const isStuck = task.status === 'running' && timeSinceUpdate > 30000
        lines.push(`Stuck: ${isStuck ? 'YES (no progress for >30s)' : 'No'}`)

        lines.push(`Session ID: ${task.sessionID || 'N/A'}`)
        lines.push(`Error: ${task.error || 'None'}`)
        lines.push(`Result Read: ${manager.isRead(task.id) ? 'Yes' : 'No'}`)

        const artifactPath = manager.artifactPaths.get(task.id)
        lines.push(`Artifact: ${artifactPath || 'N/A'}`)

        if (task.status === 'running') {
          const timeSinceActivity = lastUpdate ? formatDuration(lastUpdate, now) : 'N/A'
          lines.push(`Time Since Last Activity: ${timeSinceActivity}`)
          lines.push(`Estimated Completion: Active (awaiting prompt resolution)`)
        }

        if (task.status === 'completed' || task.status === 'error' || task.status === 'cancelled' || task.status === 'interrupt') {
          if (task.completedAt) lines.push(`Completion Time: ${task.completedAt.toISOString()}`)
          try {
            const persisted = await persistence.read(task.id, task.parentSessionID, manager.directory)
            if (persisted) {
              const contentMatch = persisted.match(/^---\n[\s\S]*?\n---\n\n([\s\S]*)$/)
              const content = contentMatch ? contentMatch[1] : persisted
              lines.push(`Result Summary: ${truncateText(content.replace(/\n/g, ' ').trim(), 200)}`)
            } else {
              lines.push(`Result Summary: (not persisted yet)`)
            }
          } catch {
            lines.push(`Result Summary: (unable to read)`)
          }
        }

        return lines.join('\n')
      } catch (error) {
        return `Error getting status: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  })
}
