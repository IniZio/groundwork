// ─── background_task Tool ──────────────────────────────────────────────────

import { tool } from '@opencode-ai/plugin'
import { z } from 'zod'
import { manager } from '../lib/singletons.js'
import { extractMessages } from '../lib/helpers.js'
import type { ToolDeps } from './deps.js'

export function createBackgroundTaskTool(deps: ToolDeps) {
  const { client } = deps
  return tool({
    description: 'Launch background task. Returns task_id. Use background_output after notification.',
    args: {
      description: z.string().describe('Short description (3-5 words)'),
      prompt: z.string().describe('Self-contained prompt with all context'),
      agent: z.string().describe('Agent type (general, explore, coder)'),
      timeout: z.number().optional().describe('Timeout in seconds (default: 1800 = 30 min, max: 7200 = 2 hours)'),
      depends_on: z.array(z.string()).optional().describe('Array of task IDs that must complete before this task starts'),
    },
    async execute(args: any, toolContext: any) {
      if (!args.agent?.trim()) return '[ERROR] Agent parameter is required.'
      try {
        const parentMessages = await client.session.messages({ path: { id: toolContext.sessionID } })
        const msgs = extractMessages(parentMessages)
        const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : undefined
        const parentAgent = toolContext.agent ?? lastMsg?.info?.agent
        const parentModel = lastMsg?.info?.model?.providerID && lastMsg?.info?.model?.modelID
          ? { providerID: lastMsg.info.model.providerID, modelID: lastMsg.info.model.modelID }
          : undefined
        const task = await manager.launch({
          description: args.description, prompt: args.prompt, agent: args.agent.trim(),
          parentSessionID: toolContext.sessionID, parentMessageID: toolContext.messageID,
          parentModel, parentAgent,
          timeout: args.timeout,
          depends_on: args.depends_on,
        })
        if (task.status === 'waiting') {
          return `Background task launched with dependencies.\n\nTask ID: ${task.id}\nDescription: ${task.description}\nAgent: ${task.agent}\nStatus: ${task.status} (waiting for: ${task.depends_on?.join(', ')})\n\nDo NOT call background_output now. Wait for <system-reminder> notification first.`
        }
        return `Background task launched.\n\nTask ID: ${task.id}\nDescription: ${task.description}\nAgent: ${task.agent}\nStatus: ${task.status}\n\nDo NOT call background_output now. Wait for <system-reminder> notification first.`
      } catch (error) {
        return `[ERROR] Failed to launch: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  })
}
