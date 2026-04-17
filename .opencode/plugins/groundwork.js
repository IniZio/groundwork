/**
 * opencode-groundwork plugin
 *
 * Merges:
 * 1. Groundwork workflow skills injection (via config hook + chat.messages.transform)
 * 2. Background task tools (background_task, background_output, background_cancel)
 * 3. PTY tools (pty_spawn, pty_write, pty_read, pty_list, pty_kill) via opencode-pty
 */

import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { PTYPlugin } from 'opencode-pty'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ─── Skills injection helpers ─────────────────────────────────────────────────

const groundworkSkillsDir = path.resolve(__dirname, '../../skills/groundwork')

function extractAndStripFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return { frontmatter: {}, content }
  const frontmatterStr = match[1]
  const body = match[2]
  const frontmatter = {}
  for (const line of frontmatterStr.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim()
      const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '')
      frontmatter[key] = value
    }
  }
  return { frontmatter, content: body }
}

function getBootstrapContent() {
  const skillPath = path.join(groundworkSkillsDir, 'using-workflow', 'SKILL.md')
  if (!fs.existsSync(skillPath)) return null
  const fullContent = fs.readFileSync(skillPath, 'utf8')
  const { content } = extractAndStripFrontmatter(fullContent)
  return `<EXTREMELY_IMPORTANT>
You have groundwork workflow skills.

**IMPORTANT: The using-workflow skill content is included below. It is ALREADY LOADED - you are currently following it. Do NOT use the skill tool to load "using-workflow" again.**

${content}
</EXTREMELY_IMPORTANT>`
}

// ─── Background task types and helpers ───────────────────────────────────────

function formatDuration(start, end) {
  if (!start) return 'N/A'
  const ms = (end ?? new Date()).getTime() - start.getTime()
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return `${m}m ${s}s`
}

function truncateText(text, maxLen) {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + '…'
}

function extractMessages(result) {
  if (Array.isArray(result)) return result
  if (Array.isArray(result?.data)) return result.data
  return []
}

function formatTaskStatus(task) {
  const durationLabel = task.status === 'pending' ? 'Queued for' : 'Duration'
  const duration = task.status === 'pending'
    ? formatDuration(task.queuedAt, undefined)
    : formatDuration(task.startedAt, task.completedAt)
  const promptPreview = truncateText(task.prompt, 500)
  const progressSection = task.progress?.lastTool ? `\n| Last tool | ${task.progress.lastTool} |` : ''
  let statusNote = ''
  if (task.status === 'pending') statusNote = '\n\n> **Queued**: Waiting for a concurrency slot.'
  else if (task.status === 'running') statusNote = '\n\n> **Note**: System will notify you on completion. No need to poll.'
  else if (task.status === 'error') statusNote = '\n\n> **Failed**: Check the error field.'
  else if (task.status === 'interrupt') statusNote = '\n\n> **Interrupted**: Prompt error. Session may have partial results.'
  return `# Task Status\n\n| Field | Value |\n|-------|-------|\n| Task ID | \`${task.id}\` |\n| Description | ${task.description} |\n| Agent | ${task.agent} |\n| Status | **${task.status}** |\n| ${durationLabel} | ${duration} |\n| Session ID | \`${task.sessionID ?? 'N/A'}\` |${progressSection}\n${statusNote}\n## Original Prompt\n\n\`\`\`\n${promptPreview}\n\`\`\``
}

async function formatTaskResult(task, client) {
  if (!task.sessionID) return 'Error: Task has no sessionID'
  const resp = await client.session.messages({ path: { id: task.sessionID } })
  const messages = extractMessages(resp)
  const duration = formatDuration(task.startedAt ?? new Date(), task.completedAt)
  const header = `Task Result\n\nTask ID: ${task.id}\nDescription: ${task.description}\nDuration: ${duration}\nSession ID: ${task.sessionID}\n\n---\n\n`
  if (!messages.length) return header + '(No messages found)'
  const relevant = messages.filter(m => m.info?.role === 'assistant' || m.info?.role === 'tool')
  if (!relevant.length) return header + '(No assistant or tool response found)'
  const extracted = []
  for (const msg of relevant) {
    for (const part of msg.parts ?? []) {
      if ((part.type === 'text' || part.type === 'reasoning') && part.text) {
        extracted.push(part.text)
      }
    }
  }
  const content = extracted.filter(t => t.length > 0).join('\n\n')
  return header + (content || '(No text output)')
}

function buildNotificationText({ task, duration, statusText, allComplete, remainingCount, completedTasks }) {
  const desc = task.description || task.id
  const errorInfo = task.error ? `\n**Error:** ${task.error}` : ''
  if (allComplete) {
    const succeeded = completedTasks.filter(t => t.status === 'completed')
    const failed = completedTasks.filter(t => t.status !== 'completed')
    const header = failed.length > 0
      ? `[ALL BACKGROUND TASKS FINISHED - ${failed.length} FAILED]`
      : '[ALL BACKGROUND TASKS COMPLETE]'
    let body = ''
    if (succeeded.length) body += `**Completed:**\n${succeeded.map(t => `- \`${t.id}\`: ${t.description}`).join('\n')}\n`
    if (failed.length) body += `\n**Failed:**\n${failed.map(t => `- \`${t.id}\`: ${t.description} [${t.status.toUpperCase()}]${t.error ? ` - ${t.error}` : ''}`).join('\n')}\n`
    if (!body) body = `- \`${task.id}\`: ${desc} [${task.status.toUpperCase()}]${task.error ? ` - ${task.error}` : ''}\n`
    return `<system-reminder>\n${header}\n\n${body.trim()}\n\nUse \`background_output(task_id="<id>")\` to retrieve each result.${failed.length > 0 ? `\n\n**ACTION REQUIRED:** ${failed.length} task(s) failed.` : ''}\n</system-reminder>`
  }
  const isFailure = statusText !== 'COMPLETED'
  return `<system-reminder>\n[BACKGROUND TASK ${statusText}]\n**ID:** \`${task.id}\`\n**Description:** ${desc}\n**Duration:** ${duration}${errorInfo}\n\n**${remainingCount} task${remainingCount === 1 ? '' : 's'} still in progress.** You WILL be notified when ALL complete.\n${isFailure ? '**ACTION REQUIRED:** This task failed. Check the error and decide whether to retry.' : 'Do NOT poll - continue productive work.'}\n\nUse \`background_output(task_id="${task.id}")\` to retrieve this result when ready.\n</system-reminder>`
}

// ─── ConcurrencyManager ───────────────────────────────────────────────────────

class ConcurrencyManager {
  counts = new Map()
  queues = new Map()
  defaultLimit

  constructor(defaultLimit = 5) {
    this.defaultLimit = defaultLimit
  }

  async acquire(key) {
    const limit = this.defaultLimit
    if (limit === Infinity) return
    const current = this.counts.get(key) ?? 0
    if (current < limit) { this.counts.set(key, current + 1); return }
    return new Promise((resolve, reject) => {
      const queue = this.queues.get(key) ?? []
      const entry = {
        resolve: () => { if (entry.settled) return; entry.settled = true; resolve() },
        rawReject: reject,
        settled: false,
      }
      queue.push(entry)
      this.queues.set(key, queue)
    })
  }

  release(key) {
    if (this.defaultLimit === Infinity) return
    const queue = this.queues.get(key)
    while (queue && queue.length > 0) {
      const next = queue.shift()
      if (!next.settled) { next.resolve(); return }
    }
    const current = this.counts.get(key) ?? 0
    if (current > 0) this.counts.set(key, current - 1)
  }

  clear() {
    for (const [key, queue] of this.queues) {
      for (const entry of queue) {
        if (!entry.settled) { entry.settled = true; entry.rawReject(new Error(`Concurrency queue cancelled: ${key}`)) }
      }
    }
    this.counts.clear()
    this.queues.clear()
  }
}

// ─── BackgroundManager ────────────────────────────────────────────────────────

const POLLING_INTERVAL_MS = 3000
const TASK_CLEANUP_DELAY_MS = 10 * 60 * 1000
const TASK_TTL_MS = 30 * 60 * 1000

class BackgroundManager {
  tasks = new Map()
  notifications = new Map()
  pendingNotifications = new Map()
  pendingByParent = new Map()
  completedTaskSummaries = new Map()
  pollingInterval = undefined
  completionTimers = new Map()
  concurrencyManager = new ConcurrencyManager(5)
  queuesByKey = new Map()
  processingKeys = new Set()
  client = null
  directory = ''

  getTask(id) { return this.tasks.get(id) }

  getTasksByParent(sessionID) {
    return Array.from(this.tasks.values()).filter(t => t.parentSessionID === sessionID)
  }

  getAllDescendantTasks(sessionID) {
    const result = []
    for (const child of this.getTasksByParent(sessionID)) {
      result.push(child)
      if (child.sessionID) result.push(...this.getAllDescendantTasks(child.sessionID))
    }
    return result
  }

  findBySession(sessionID) {
    return Array.from(this.tasks.values()).find(t => t.sessionID === sessionID)
  }

  async launch(input) {
    if (!input.agent?.trim()) throw new Error('Agent parameter is required')
    const task = {
      id: `bg_${crypto.randomUUID().slice(0, 8)}`,
      status: 'pending',
      queuedAt: new Date(),
      description: input.description,
      prompt: input.prompt,
      agent: input.agent.trim(),
      parentSessionID: input.parentSessionID,
      parentMessageID: input.parentMessageID,
      parentModel: input.parentModel,
      parentAgent: input.parentAgent,
    }
    this.tasks.set(task.id, task)
    const pending = this.pendingByParent.get(input.parentSessionID) ?? new Set()
    pending.add(task.id)
    this.pendingByParent.set(input.parentSessionID, pending)
    const key = input.agent.trim()
    const queue = this.queuesByKey.get(key) ?? []
    queue.push({ task, input })
    this.queuesByKey.set(key, queue)
    void this.processKey(key)
    return { ...task }
  }

  async processKey(key) {
    if (this.processingKeys.has(key)) return
    this.processingKeys.add(key)
    try {
      const queue = this.queuesByKey.get(key)
      while (queue && queue.length > 0) {
        const item = queue.shift()
        if (!item) continue
        await this.concurrencyManager.acquire(key)
        if (item.task.status === 'cancelled' || item.task.status === 'error') {
          this.concurrencyManager.release(key); continue
        }
        try {
          await this.startTask(item)
        } catch (error) {
          item.task.status = 'error'
          item.task.error = error instanceof Error ? error.message : String(error)
          item.task.completedAt = new Date()
          this.concurrencyManager.release(key)
          this.markForNotification(item.task)
          void this.notifyParentSession(item.task)
        }
      }
    } finally {
      this.processingKeys.delete(key)
    }
  }

  async startTask({ task, input }) {
    const key = input.agent.trim()
    const parentSession = await this.client.session.get({
      path: { id: input.parentSessionID },
      query: { directory: this.directory },
    }).catch(() => null)
    const parentDirectory = parentSession?.data?.directory ?? this.directory
    const createResult = await this.client.session.create({
      body: { parentID: input.parentSessionID },
      query: { directory: parentDirectory },
    })
    if (createResult?.error) {
      this.concurrencyManager.release(key)
      throw new Error(`Failed to create background session: ${createResult.error}`)
    }
    const sessionID = createResult?.data?.id
    if (!sessionID) {
      this.concurrencyManager.release(key)
      throw new Error('Failed to create background session: no session ID returned')
    }
    task.status = 'running'
    task.startedAt = new Date()
    task.sessionID = sessionID
    task.progress = { toolCalls: 0, lastUpdate: new Date() }
    task.concurrencyKey = key
    task.concurrencyGroup = key
    this.startPolling()
    const launchModel = input.parentModel
      ? { providerID: input.parentModel.providerID, modelID: input.parentModel.modelID }
      : undefined
    const promptBody = {
      agent: input.agent.trim(),
      ...(launchModel ? { model: launchModel } : {}),
      parts: [{ type: 'text', text: input.prompt, synthetic: true }],
    }
    this.client.session.promptAsync?.({
      path: { id: sessionID },
      body: promptBody,
    }).catch(async (error) => {
      const msg = error instanceof Error ? error.message : String(error)
      task.status = 'interrupt'
      task.error = msg
      task.completedAt = new Date()
      if (task.concurrencyKey) { this.concurrencyManager.release(task.concurrencyKey); task.concurrencyKey = undefined }
      try { await this.client.session.abort({ path: { id: sessionID } }) } catch {}
      this.markForNotification(task)
      void this.notifyParentSession(task)
    })
  }

  async cancelTask(taskId, options = {}) {
    const task = this.tasks.get(taskId)
    if (!task || (task.status !== 'running' && task.status !== 'pending')) return false
    if (task.status === 'pending') {
      const key = task.agent
      const queue = this.queuesByKey.get(key)
      if (queue) {
        const idx = queue.findIndex(i => i.task.id === taskId)
        if (idx !== -1) queue.splice(idx, 1)
        if (queue.length === 0) this.queuesByKey.delete(key)
      }
    }
    task.status = 'cancelled'
    task.completedAt = new Date()
    if (task.concurrencyKey) { this.concurrencyManager.release(task.concurrencyKey); task.concurrencyKey = undefined }
    const idleTimer = this.completionTimers.get(task.id)
    if (idleTimer) { clearTimeout(idleTimer); this.completionTimers.delete(task.id) }
    const shouldAbort = options.abortSession !== false
    if (shouldAbort && task.sessionID) {
      try { await this.client.session.abort({ path: { id: task.sessionID } }) } catch {}
    }
    if (options.skipNotification) { this.cleanupPendingByParent(task); this.scheduleTaskRemoval(task.id); return true }
    this.markForNotification(task)
    await this.notifyParentSession(task)
    return true
  }

  injectPendingNotifications(parts, sessionID) {
    const notifications = this.pendingNotifications.get(sessionID)
    if (!notifications || notifications.length === 0) return
    this.pendingNotifications.delete(sessionID)
    const content = notifications.join('\n\n')
    const firstText = parts.findIndex(p => p.type === 'text')
    if (firstText === -1) {
      parts.unshift({ type: 'text', text: content, synthetic: true })
    } else {
      parts[firstText].text = `${content}\n\n---\n\n${parts[firstText].text ?? ''}`
    }
  }

  startPolling() {
    if (this.pollingInterval) return
    this.pollingInterval = setInterval(() => void this.pollRunningTasks(), POLLING_INTERVAL_MS)
    if (typeof this.pollingInterval?.unref === 'function') this.pollingInterval.unref()
  }

  stopPolling() {
    if (this.pollingInterval) { clearInterval(this.pollingInterval); this.pollingInterval = undefined }
    this.concurrencyManager.clear()
  }

  async pollRunningTasks() {
    const running = Array.from(this.tasks.values()).filter(t => t.status === 'running')
    if (running.length === 0) { this.stopPolling(); return }
    for (const task of running) {
      if (!task.sessionID) continue
      try {
        const resp = await this.client.session.messages({ path: { id: task.sessionID } })
        const messages = extractMessages(resp)
        const count = messages.length
        if (task.lastMsgCount !== undefined && task.lastMsgCount === count) {
          task.stablePolls = (task.stablePolls ?? 0) + 1
        } else { task.stablePolls = 0 }
        task.lastMsgCount = count
        if ((task.stablePolls ?? 0) >= 10 && count > 0) {
          const last = messages[messages.length - 1]
          if (last?.info?.role === 'assistant') await this.tryCompleteTask(task, 'poll-stability')
        }
      } catch {}
    }
    const now = Date.now()
    for (const task of Array.from(this.tasks.values())) {
      if (task.status !== 'running' && task.status !== 'pending') continue
      const ref = task.status === 'pending' ? task.queuedAt : task.startedAt
      if (ref && now - ref.getTime() > TASK_TTL_MS) {
        task.status = 'error'; task.error = 'Task timed out'; task.completedAt = new Date()
        if (task.concurrencyKey) { this.concurrencyManager.release(task.concurrencyKey); task.concurrencyKey = undefined }
        this.markForNotification(task)
        void this.notifyParentSession(task)
      }
    }
  }

  async tryCompleteTask(task, _source) {
    if (task.status !== 'running') return
    task.status = 'completed'; task.completedAt = new Date()
    if (task.concurrencyKey) { this.concurrencyManager.release(task.concurrencyKey); task.concurrencyKey = undefined }
    this.markForNotification(task)
    try { await this.client.session.abort({ path: { id: task.sessionID } }) } catch {}
    await this.notifyParentSession(task)
  }

  handleEvent(event) {
    const props = event.properties
    if (event.type === 'session.idle') {
      const sessionID = typeof props?.sessionID === 'string' ? props.sessionID : undefined
      if (!sessionID) return
      const task = this.findBySession(sessionID)
      if (!task || task.status !== 'running') return
      const existingTimer = this.completionTimers.get(task.id)
      if (existingTimer) return
      const timer = setTimeout(() => { this.completionTimers.delete(task.id); void this.tryCompleteTask(task, 'session.idle') }, 2000)
      if (typeof timer?.unref === 'function') timer.unref()
      this.completionTimers.set(task.id, timer)
    }
    if (event.type === 'session.error') {
      const sessionID = typeof props?.sessionID === 'string' ? props.sessionID : undefined
      if (!sessionID) return
      const task = this.findBySession(sessionID)
      if (!task || task.status !== 'running') return
      task.status = 'error'
      task.error = typeof props?.error?.message === 'string' ? props.error.message : 'Session error'
      task.completedAt = new Date()
      if (task.concurrencyKey) { this.concurrencyManager.release(task.concurrencyKey); task.concurrencyKey = undefined }
      this.markForNotification(task)
      void this.notifyParentSession(task)
    }
    if (event.type === 'session.deleted') {
      const id = typeof props?.info?.id === 'string' ? props.info.id : undefined
      if (!id) return
      const directTask = this.findBySession(id)
      if (directTask && (directTask.status === 'running' || directTask.status === 'pending')) {
        void this.cancelTask(directTask.id, { source: 'session.deleted', abortSession: false, skipNotification: true })
      }
    }
    if (event.type === 'message.part.updated' || event.type === 'message.part.delta') {
      const partInfo = props?.part
      const sessionID = partInfo?.sessionID ?? (typeof props?.sessionID === 'string' ? props.sessionID : undefined)
      if (!sessionID) return
      const task = this.findBySession(sessionID)
      if (!task || !task.progress) return
      task.progress.lastUpdate = new Date()
      if (partInfo?.tool) { task.progress.toolCalls += 1; task.progress.lastTool = partInfo.tool }
      const existing = this.completionTimers.get(task.id)
      if (existing) { clearTimeout(existing); this.completionTimers.delete(task.id) }
    }
  }

  markForNotification(task) {
    const queue = this.notifications.get(task.parentSessionID) ?? []
    queue.push(task)
    this.notifications.set(task.parentSessionID, queue)
  }

  cleanupPendingByParent(task) {
    if (!task.parentSessionID) return
    const pending = this.pendingByParent.get(task.parentSessionID)
    if (pending) { pending.delete(task.id); if (pending.size === 0) this.pendingByParent.delete(task.parentSessionID) }
  }

  scheduleTaskRemoval(taskId) {
    const timer = setTimeout(() => { this.completionTimers.delete(taskId); this.tasks.delete(taskId) }, TASK_CLEANUP_DELAY_MS)
    if (typeof timer?.unref === 'function') timer.unref()
    this.completionTimers.set(taskId, timer)
  }

  async notifyParentSession(task) {
    const duration = formatDuration(task.startedAt ?? new Date(), task.completedAt)
    if (!this.completedTaskSummaries.has(task.parentSessionID)) {
      this.completedTaskSummaries.set(task.parentSessionID, [])
    }
    this.completedTaskSummaries.get(task.parentSessionID).push({
      id: task.id, description: task.description, status: task.status, error: task.error,
    })
    const pendingSet = this.pendingByParent.get(task.parentSessionID)
    let remainingCount = 0; let allComplete = false
    if (pendingSet) {
      pendingSet.delete(task.id); remainingCount = pendingSet.size; allComplete = remainingCount === 0
      if (allComplete) this.pendingByParent.delete(task.parentSessionID)
    } else {
      remainingCount = Array.from(this.tasks.values())
        .filter(t => t.parentSessionID === task.parentSessionID && t.id !== task.id && (t.status === 'running' || t.status === 'pending'))
        .length
      allComplete = remainingCount === 0
    }
    const completedTasks = allComplete
      ? (this.completedTaskSummaries.get(task.parentSessionID) ?? [{ id: task.id, description: task.description, status: task.status, error: task.error }])
      : []
    if (allComplete) this.completedTaskSummaries.delete(task.parentSessionID)
    const statusText = task.status === 'completed' ? 'COMPLETED'
      : task.status === 'interrupt' ? 'INTERRUPTED'
      : task.status === 'error' ? 'ERROR'
      : 'CANCELLED'
    const notification = buildNotificationText({ task, duration, statusText, allComplete, remainingCount, completedTasks })
    const isTaskFailure = task.status === 'error' || task.status === 'cancelled' || task.status === 'interrupt'
    const shouldReply = allComplete || isTaskFailure
    try {
      await this.client.session.promptAsync({
        path: { id: task.parentSessionID },
        body: {
          noReply: !shouldReply,
          ...(task.parentAgent !== undefined ? { agent: task.parentAgent } : {}),
          ...(task.parentModel !== undefined ? { model: task.parentModel } : {}),
          parts: [{ type: 'text', text: notification, synthetic: true }],
        },
      })
    } catch {
      this.pendingNotifications.set(
        task.parentSessionID,
        [...(this.pendingNotifications.get(task.parentSessionID) ?? []), notification]
      )
    }
    this.scheduleTaskRemoval(task.id)
  }
}

// ─── Plugin export ────────────────────────────────────────────────────────────

const manager = new BackgroundManager()

export const GroundworkPlugin = async (ctx) => {
  const { client, directory } = ctx
  manager.client = client
  manager.directory = directory

  // Load PTY plugin and merge its hooks
  const ptyHooks = await PTYPlugin(ctx)

  return {
    config: async (config) => {
      config.skills = config.skills || {}
      config.skills.paths = config.skills.paths || []
      if (!config.skills.paths.includes(groundworkSkillsDir)) {
        config.skills.paths.push(groundworkSkillsDir)
      }
      if (ptyHooks.config) await ptyHooks.config(config)
    },

    'experimental.chat.messages.transform': async (_input, output) => {
      const bootstrap = getBootstrapContent()
      if (!bootstrap || !output.messages.length) return
      const firstUser = output.messages.find(m => m.info.role === 'user')
      if (!firstUser || !firstUser.parts.length) return
      if (firstUser.parts.some(p => p.type === 'text' && p.text.includes('EXTREMELY_IMPORTANT'))) return
      const ref = firstUser.parts[0]
      firstUser.parts.unshift({ ...ref, type: 'text', text: bootstrap })
    },

    tool: {
      ...ptyHooks.tool,
      background_task: {
        description: 'Run agent task in background. Returns task_id immediately; notifies on completion. Use `background_output` to get results. Prompts MUST be in English.',
        parameters: {
          type: 'object',
          properties: {
            description: { type: 'string', description: 'Short task description (shown in status)' },
            prompt: { type: 'string', description: 'Full detailed prompt for the agent' },
            agent: { type: 'string', description: 'Agent type to use (e.g. "general", "explore", "build")' },
          },
          required: ['description', 'prompt', 'agent'],
        },
        async execute(args, toolContext) {
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
            })
            return `Background task launched.\n\nTask ID: ${task.id}\nDescription: ${task.description}\nAgent: ${task.agent}\nStatus: ${task.status}\n\nDo NOT call background_output now. Wait for <system-reminder> notification first.`
          } catch (error) {
            return `[ERROR] Failed to launch: ${error instanceof Error ? error.message : String(error)}`
          }
        },
      },

      background_output: {
        description: 'Get output from background task. ONLY call AFTER receiving a <system-reminder> notification.',
        parameters: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID to get output from' },
            block: { type: 'boolean', description: 'Wait for completion (default: false)' },
            timeout: { type: 'number', description: 'Max wait time in ms (default: 60000)' },
          },
          required: ['task_id'],
        },
        async execute(args) {
          try {
            const task = manager.getTask(args.task_id)
            if (!task) return `Task not found: ${args.task_id}`
            const shouldBlock = args.block === true
            const timeoutMs = Math.min(args.timeout ?? 60000, 600000)
            let resolvedTask = task
            if (shouldBlock && (task.status === 'pending' || task.status === 'running')) {
              const start = Date.now()
              while (Date.now() - start < timeoutMs) {
                await new Promise(r => setTimeout(r, 1000))
                const current = manager.getTask(args.task_id)
                if (!current) return `Task was deleted: ${args.task_id}`
                resolvedTask = current
                if (current.status !== 'pending' && current.status !== 'running') break
              }
            }
            if (resolvedTask.status === 'completed') return await formatTaskResult(resolvedTask, client)
            return formatTaskStatus(resolvedTask)
          } catch (error) {
            return `Error getting output: ${error instanceof Error ? error.message : String(error)}`
          }
        },
      },

      background_cancel: {
        description: 'Cancel running background task(s). Use all=true to cancel ALL.',
        parameters: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: 'Task ID to cancel' },
            all: { type: 'boolean', description: 'Cancel all running background tasks' },
          },
        },
        async execute(args, toolContext) {
          try {
            if (args.all === true) {
              const tasks = manager.getAllDescendantTasks(toolContext.sessionID)
              const cancellable = tasks.filter(t => t.status === 'running' || t.status === 'pending')
              if (cancellable.length === 0) return 'No running or pending background tasks to cancel.'
              const results = []
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
      },
    },

    event: async (input) => {
      manager.handleEvent(input.event)
      if (ptyHooks.event) await ptyHooks.event(input)
    },

    'chat.message': async (_input, output) => {
      manager.injectPendingNotifications(output.parts, _input.sessionID)
    },

    'command.execute.before': ptyHooks['command.execute.before'],
  }
}

export default GroundworkPlugin
