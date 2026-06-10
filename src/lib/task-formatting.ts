import { formatDuration, truncateText, extractMessages, extractFailureContext } from './helpers.js'
import { formatFileChanges } from './snapshot.js'

const STUCK_THRESHOLD_MS = 60_000

export function formatTaskStatus(task: any): string {
  const duration = task.status === 'pending' || task.status === 'waiting'
    ? formatDuration(task.queuedAt, undefined)
    : formatDuration(task.startedAt, task.completedAt)
  const statusNote = task.completing ? 'completing...'
    : task.status === 'pending' ? 'queued'
    : task.status === 'waiting' ? 'waiting'
    : task.status === 'running' ? 'running'
    : task.status === 'error' ? 'failed'
    : task.status === 'interrupt' ? 'interrupted'
    : task.status
  return `Task ${task.id}: ${task.description} [${task.agent}] — ${statusNote} (${duration})`
}

/**
 * Extract TASK_SUMMARY block from message text.
 * Returns the block content (between markers) or null.
 */
function extractTaskSummaryBlock(text: string): string | null {
  const match = text.match(/<!--\s*TASK_SUMMARY_START\s*-->([\s\S]*?)<!--\s*TASK_SUMMARY_END\s*-->/)
  return match ? match[1].trim() : null
}

function extractStatus(summaryBlock: string): string {
  const match = summaryBlock.match(/^STATUS:\s*(\S+)/m)
  return match ? match[1].toLowerCase() : 'unknown'
}

/**
 * Format the structured task result.
 * Simple 2-step approach: read session messages once, extract text and summary block.
 */
export async function formatTaskResult(task: any, client: any, opts?: { sessionID?: string }): Promise<string> {
  const sessionId = opts?.sessionID || task.sessionID || task.session
  const duration = formatDuration(task.startedAt ?? new Date(), task.completedAt)

  let resultText = ''
  let summaryBlock: string | null = null

  if (!sessionId) {
    return buildResultOutput(task, duration, null, '')
  }

  // Step 1: Read session messages once (no polling — prompt already resolved)
  try {
    const resp = await client.session.messages({ path: { id: sessionId }, query: { limit: 500 } })
    const messages = extractMessages(resp)

    // Scan ALL assistant messages (newest first) for text
    const assistantMsgs = messages.filter((m: any) => m.info?.role === 'assistant')
    for (let i = assistantMsgs.length - 1; i >= 0; i--) {
      const msg = assistantMsgs[i]
      const textParts: string[] = []
      for (const part of msg.parts ?? []) {
        if ((part.type === 'text' || part.type === 'reasoning' || part.type === 'thinking') && part.text?.trim()) {
          textParts.push(part.text.trim())
        }
      }
      const msgText = textParts.join('\n\n')
      if (msgText && msgText.length > resultText.length) {
        resultText = msgText
      }
      const block = extractTaskSummaryBlock(msgText)
      if (block) {
        summaryBlock = block
        break
      }
    }
  } catch {}

  return buildResultOutput(task, duration, summaryBlock, resultText)
}

function buildResultOutput(task: any, duration: string, summaryBlock: string | null, fallbackText: string): string {
  const lines: string[] = []

  if (summaryBlock) {
    const status = extractStatus(summaryBlock)
    lines.push(`TASK RESULT: ${task.id} [${status.toUpperCase()}]`)
    lines.push(`DESCRIPTION: ${task.description}`)
    lines.push(`DURATION: ${duration}`)
    lines.push('')
    lines.push('--- BEGIN TASK_SUMMARY ---')
    lines.push(summaryBlock)
    lines.push('--- END TASK_SUMMARY ---')
  } else if (fallbackText) {
    // Has text but no structured block — surface what we have
    lines.push(`TASK RESULT: ${task.id}`)
    lines.push(`DESCRIPTION: ${task.description}`)
    lines.push(`DURATION: ${duration}`)
    lines.push('')
    lines.push(fallbackText)
    lines.push('')
    // Check if the text mentions file operations
    const hasFileOps = /\b(created|modified|wrote|updated|deleted|renamed)\b/i.test(fallbackText) ||
                       /\[path\]|\[bash\]|\[op\]|\[inbox\]/.test(fallbackText)
    if (hasFileOps) {
      lines.push('NOTE: Output recovered from session messages (no TASK_SUMMARY block found).')
    } else if (/\b(error|fail|exception|traceback)\b/i.test(fallbackText)) {
      lines.push('NOTE: Output appears to contain an error (no TASK_SUMMARY block found).')
    } else {
      lines.push('NOTE: No structured TASK_SUMMARY block found.')
    }
  } else {
    // Completely empty — nothing recoverable
    lines.push(`TASK RESULT: ${task.id} [UNKNOWN]`)
    lines.push(`DESCRIPTION: ${task.description}`)
    lines.push(`DURATION: ${duration}`)
    lines.push('')
    lines.push('(No output — task produced no text)')
  }

  return lines.join('\n')
}

export function buildNotificationText({ task, duration, statusText, allComplete, remainingCount, completedTasks, artifactPath }: {
  task: any
  duration: string
  statusText: string
  allComplete: boolean
  remainingCount: number
  completedTasks: any[]
  artifactPath?: string
}): string {
  const desc = task.description || task.id

  if (allComplete) {
    const succeeded = completedTasks.filter((t: any) => t.status === 'completed')
    const failed = completedTasks.filter((t: any) => t.status !== 'completed')
    const lines: string[] = []
    if (succeeded.length) lines.push(...succeeded.map((t: any) => `[OK] ${t.id}: ${t.description}`))
    if (failed.length) lines.push(...failed.map((t: any) => `[FAIL] ${t.id}: ${t.description} [${t.status}]`))
    if (!lines.length) lines.push(`${task.id}: ${desc} [${task.status}]`)
    return `<system-reminder>\n[ALL DONE]\n${lines.join('\n')}${artifactPath ? `\nArtifact: ${artifactPath}` : ''}\n-> Task completed. Result is available in the task response above.\n</system-reminder>`
  }

  let failureContext = ''
  if (task.status === 'error' || task.status === 'interrupt') {
    const toolCalls = task.progress?.toolCalls || 0
    const lastTool = task.progress?.lastTool
    const parts: string[] = []
    if (toolCalls > 0) parts.push(`after ${toolCalls} tool calls`)
    if (lastTool) parts.push(`last: ${lastTool}`)
    if (parts.length) failureContext = ` — ${parts.join(', ')}`
    failureContext += artifactPath ? `\nCheck artifact for full details: ${artifactPath}` : ''
  }

  const steerHint = (task.status === 'completed')
    ? `\n-> Task completed. Result is available in the response above.`
    : (task.status === 'error' || task.status === 'interrupt')
    ? `\n-> Task failed. Check the error details in the response above. Relaunch with corrected prompt if needed.`
    : ''

  return `<system-reminder>\n[${statusText}] ${task.id}: ${desc} (${duration})${task.error ? ` — ${task.error}` : ''}${failureContext}${remainingCount > 0 ? ` — ${remainingCount} remaining` : ''}${steerHint}\n</system-reminder>`
}

// --- Task list formatting (emoji-free) ---

export function formatActivityTime(lastUpdate: Date | undefined): string {
  if (!lastUpdate) return ''
  const ms = Date.now() - lastUpdate.getTime()
  if (ms < 5000) return 'active now'
  if (ms < 60_000) return `active ${Math.floor(ms / 1000)}s ago`
  if (ms < 3600_000) return `active ${Math.floor(ms / 60_000)}m ago`
  return `active ${Math.floor(ms / 3600_000)}h ago`
}

export function isTaskStuck(task: any): boolean {
  if (task.status !== 'running') return false
  const lastUpdate = task.progress?.lastUpdate ?? task.startedAt
  if (!lastUpdate) return false
  return Date.now() - lastUpdate.getTime() > STUCK_THRESHOLD_MS
}

export function formatTaskList(tasks: any[], sessionID: string, options: any = {}): string {
  if (!tasks.length) return `No subagent tasks for ${sessionID}.`

  const groups = {
    running: tasks.filter((t: any) => t.status === 'running'),
    pending: tasks.filter((t: any) => t.status === 'pending'),
    waiting: tasks.filter((t: any) => t.status === 'waiting'),
    completed: tasks.filter((t: any) => t.status === 'completed'),
    error: tasks.filter((t: any) => t.status === 'error' || t.status === 'interrupt'),
    cancelled: tasks.filter((t: any) => t.status === 'cancelled'),
  }

  const totalRunning = groups.running.length
  const totalPending = groups.pending.length
  const totalWaiting = groups.waiting.length
  const totalCompleted = groups.completed.length
  const totalError = groups.error.length
  const totalCancelled = groups.cancelled.length
  const totalActive = totalRunning + totalPending + totalWaiting

  const headerParts: string[] = []
  if (totalActive > 0) headerParts.push(`${totalActive} active`)
  if (totalWaiting > 0) headerParts.push(`${totalWaiting} waiting`)
  if (totalCompleted > 0) headerParts.push(`${totalCompleted} completed`)
  if (totalError > 0) headerParts.push(`${totalError} failed`)
  if (totalCancelled > 0) headerParts.push(`${totalCancelled} cancelled`)

  const lines: string[] = []
  lines.push(`Subagent tasks for ${sessionID} — ${tasks.length} total${headerParts.length ? ` (${headerParts.join(', ')})` : ''}`)
  lines.push('')

  const formatTask = (task: any, isCompact = false) => {
    const status = task.status === 'running' ? 'RUN' : task.status === 'pending' ? 'QUEUED' : task.status === 'completed' ? 'DONE' : task.status === 'error' ? 'ERR' : task.status === 'cancelled' ? 'CANCELLED' : task.status === 'interrupt' ? 'INTERRUPTED' : task.status
    const duration = task.status === 'pending' ? formatDuration(task.queuedAt, undefined) : formatDuration(task.startedAt, task.completedAt)

    if (isCompact) {
      return `${task.id}: ${task.description} [${task.agent}] ${status} (${duration})`
    }

    let line = `${task.id}: ${task.description} [${task.agent}] ${status} (${duration})`

    if (task.status === 'running') {
      const stuck = isTaskStuck(task)
      const activity = formatActivityTime(task.progress?.lastUpdate)
      const toolCalls = task.progress?.toolCalls ?? 0
      const lastTool = task.progress?.lastTool
      const indicators: string[] = []
      if (stuck) indicators.push('STUCK')
      if (toolCalls > 0) indicators.push(`${toolCalls} tools`)
      if (lastTool) indicators.push(`last: ${lastTool}`)
      if (activity) indicators.push(activity)
      if (indicators.length) line += ` — ${indicators.join(' | ')}`
    }

    return line
  }

  if (groups.running.length > 0) {
    lines.push(`[RUNNING] (${groups.running.length}):`)
    for (const task of groups.running) lines.push(`  ${formatTask(task)}`)
    lines.push('')
  }

  if (groups.pending.length > 0) {
    lines.push(`[PENDING] (${groups.pending.length}):`)
    for (const task of groups.pending) lines.push(`  ${formatTask(task)}`)
    lines.push('')
  }

  if (groups.completed.length > 0) {
    lines.push(`[COMPLETED] (${groups.completed.length}):`)
    for (const task of groups.completed) lines.push(`  ${formatTask(task)}`)
    lines.push('')
  }

  if (groups.error.length > 0) {
    lines.push(`[FAILED] (${groups.error.length}):`)
    for (const task of groups.error) lines.push(`  ${formatTask(task)}`)
    lines.push('')
  }

  if (groups.cancelled.length > 0) {
    lines.push(`[CANCELLED] (${groups.cancelled.length}):`)
    for (const task of groups.cancelled) lines.push(`  ${formatTask(task)}`)
    lines.push('')
  }

  if (options.include_completed && (groups.completed.length > 0 || groups.error.length > 0)) {
    const finishedTasks = [...groups.completed, ...groups.error]
    const successCount = groups.completed.length
    const failureCount = groups.error.length

    let totalDurationMs = 0
    let durationCount = 0
    for (const task of finishedTasks) {
      if (task.startedAt && task.completedAt) {
        totalDurationMs += task.completedAt.getTime() - task.startedAt.getTime()
        durationCount++
      }
    }

    lines.push('─'.repeat(50))
    lines.push('Summary:')
    lines.push(`  Success: ${successCount} | Failed: ${failureCount} | Total: ${finishedTasks.length}`)
    if (durationCount > 0) {
      const avgDuration = formatDuration(new Date(0), new Date(Math.round(totalDurationMs / durationCount)))
      lines.push(`  Average duration: ${avgDuration}`)
    }
    lines.push('')
  }

  return lines.join('\n').trim()
}
