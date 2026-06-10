// ─── background_input Tool ─────────────────────────────────────────────────

import { tool } from '@opencode-ai/plugin'
import { z } from 'zod'
import { manager } from '../lib/singletons.js'
import { truncateText } from '../lib/helpers.js'
import type { ToolDeps } from './deps.js'

export function createBackgroundInputTool(deps: ToolDeps) {
  const { client } = deps
  return tool({
    description: 'Send a steering message, input, or interrupt to a running background task. Use type="steer" to send semantic instructions like "where are you at?" or "try approach B". Use type="interrupt" for Ctrl+C. Use type="input" for raw stdin text.',
    args: {
      task_id: z.string().describe('Task ID to send message to'),
      data: z.string().describe('The message, instruction, or control sequence to send'),
      type: z.enum(['steer', 'interrupt', 'input']).optional().describe('Type of message: "steer" = semantic steering instruction (default), "interrupt" = Ctrl+C abort, "input" = raw text input'),
    },
    async execute(args: any) {
      try {
        const task = manager.getTask(args.task_id)
        if (!task) return `[ERROR] Task not found: ${args.task_id}`
        if (!task.sessionID) return `[ERROR] Task has no session ID.`

        const msgType = args.type || 'steer'

        // Handle interrupt type
        if (msgType === 'interrupt' || args.data === '\\x03') {
          if (task.status !== 'running') return `[ERROR] Cannot interrupt task with status "${task.status}". Task must be running.`
          try {
            await client.session.abort({ path: { id: task.sessionID } })
            task.status = 'interrupt'
            task.error = 'Task interrupted by user (Ctrl+C)'
            task.completedAt = new Date()
            if (task.concurrencyKey) { manager.concurrencyManager.release(task.concurrencyKey); task.concurrencyKey = undefined }
            await manager.persistResult(task)
            manager.markForNotification(task)
            void manager.notifyParentSession(task)
            return `Task ${args.task_id} interrupted (Ctrl+C sent)`
          } catch (abortErr) {
            return `[ERROR] Failed to abort task: ${abortErr instanceof Error ? abortErr.message : String(abortErr)}`
          }
        }

        // Handle steer type
        if (msgType === 'steer') {
          const steeringPrefix = '[STEERING MESSAGE FROM ORCHESTRATOR] '
          const steeringSuffix = '\n\n[End steering message. Continue your work incorporating this guidance.]'
          const fullMessage = steeringPrefix + args.data + steeringSuffix

          if (task.status === 'running') {
            await client.session.prompt({
              path: { id: task.sessionID },
              body: {
                noReply: true,
                parts: [{ type: 'text', text: fullMessage, synthetic: true }],
              },
            })
            ;(task as any).stuckNotified = false
            if (task.progress) task.progress.lastUpdate = new Date()
            return `Steering message sent to running task ${args.task_id}: "${truncateText(args.data, 100)}"`
          }

          if (task.status === 'completed') {
            if (!task.sessionID) {
              return `[ERROR] Cannot reactivate task ${args.task_id}: session has been cleaned up. Start a new task instead.`
            }
            const key = task.agent
            const ccm = manager.concurrencyManager
            const currentCount = ccm.getCount(key)
            if (ccm.limit !== Infinity && currentCount >= ccm.limit) {
              return `[ERROR] Cannot reactivate task ${args.task_id}: concurrency limit reached for agent "${key}"`
            }
            await ccm.acquire(key)
            task.concurrencyKey = key

            manager.cancelSessionCleanup(task)
            task.status = 'running'
            task.error = ''
            ;(task as any).completing = false
            ;(task as any).autoCancelled = false
            ;(task as any).stuckNotified = false
            ;(task as any).toolErrorNotified = false
            task.progress = { toolCalls: 0, lastUpdate: new Date() }

            await manager.persistResult(task)

            void (async () => {
              try {
                await manager.client.session.prompt({
                  path: { id: task.sessionID! },
                  body: { parts: [{ type: 'text', text: fullMessage, synthetic: true }] },
                })
                await manager.tryCompleteTask(task, 'reactivation')
              } catch (error: any) {
                const msg = error instanceof Error ? error.message : String(error)
                task.status = 'error'
                task.error = `Reactivation failed: ${msg}`
                task.completedAt = new Date()
                if (task.concurrencyKey) { manager.concurrencyManager.release(task.concurrencyKey); task.concurrencyKey = undefined }
                await manager.persistResult(task)
                manager.markForNotification(task)
                void manager.notifyParentSession(task)
              }
            })()

            return `Task ${args.task_id} reactivated with steering message: "${truncateText(args.data, 100)}"`
          }

          return `[ERROR] Cannot steer task with status "${task.status}". Only running or completed tasks can be steered.`
        }

        // Handle input type
        if (task.status !== 'running') return `[ERROR] Cannot send input to task with status "${task.status}". Task must be running.`
        let inputData = args.data
        const controlChars: Record<string, string> = {
          '\\x03': '\x03',
          '\\x04': '\x04',
          '\\n': '\n',
          '\\r': '\r',
          '\\t': '\t',
        }
        for (const [escape, char] of Object.entries(controlChars)) {
          inputData = inputData.replaceAll(escape, char)
        }

        await client.session.prompt({
          path: { id: task.sessionID },
          body: {
            noReply: true,
            parts: [{ type: 'text', text: inputData, synthetic: true }],
          },
        })

        ;(task as any).stuckNotified = false
        if (task.progress) task.progress.lastUpdate = new Date()

        return `Input sent to task ${args.task_id}: "${truncateText(inputData, 50)}"`
      } catch (error) {
        return `[ERROR] Failed to send input: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  })
}
