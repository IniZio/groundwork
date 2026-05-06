/**
 * opencode-groundwork plugin
 *
 * Merges:
 * 1. Groundwork workflow skills injection (via config hook + chat.messages.transform)
 * 2. Background task tools (background_task, background_output, background_cancel, background_list)
 * 3. Session handoff tools (handoff_session, read_session) + /handoff command
 */

import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { tool } from '@opencode-ai/plugin'
import fsPromises from 'fs/promises'

const z = tool.schema
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
  const skillPath = path.join(groundworkSkillsDir, 'use-groundwork', 'SKILL.md')
  if (!fs.existsSync(skillPath)) return null
  const fullContent = fs.readFileSync(skillPath, 'utf8')
  const { content } = extractAndStripFrontmatter(fullContent)
  return `<EXTREMELY_IMPORTANT>
You have groundwork workflow skills.

**IMPORTANT: The use-groundwork skill content is included below. It is ALREADY LOADED - you are currently following it. Do NOT use the skill tool to load "use-groundwork" again.**

${content}
</EXTREMELY_IMPORTANT>`
}

// ─── Background task types and helpers ───────────────────────────────────────

const PERSISTENCE_DIR = '.opencode/background-tasks'

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function extractMessages(result) {
  if (Array.isArray(result)) return result
  if (Array.isArray(result?.data)) return result.data
  if (Array.isArray(result?.data?.messages)) return result.data.messages
  if (Array.isArray(result?.messages)) return result.messages
  return []
}

function formatTaskStatus(task) {
  const duration = task.status === 'pending'
    ? formatDuration(task.queuedAt, undefined)
    : formatDuration(task.startedAt, task.completedAt)
  const statusNote = task.completing ? 'completing...'
    : task.status === 'pending' ? 'queued'
    : task.status === 'running' ? 'running'
    : task.status === 'error' ? 'failed'
    : task.status === 'interrupt' ? 'interrupted'
    : task.status
  return `Task ${task.id}: ${task.description} [${task.agent}] — ${statusNote} (${duration})`
}

async function formatTaskResult(task, client) {
  if (!task.sessionID) return 'Error: Task has no sessionID'
  const maxAttempts = 4
  const duration = formatDuration(task.startedAt ?? new Date(), task.completedAt)
  const header = `Task Result\n\nTask ID: ${task.id}\nDescription: ${task.description}\nDuration: ${duration}\nSession ID: ${task.sessionID}\n\n---\n\n`
  let prevMsgCount = -1
  let bestContent = ''
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      if (attempt > 0) await sleep(3000 * attempt)
      const resp = await client.session.messages({ path: { id: task.sessionID } })
      const messages = extractMessages(resp)
      if (!messages.length) {
        if (attempt < maxAttempts - 1) continue
        break
      }
      const msgCount = messages.length
      const relevant = messages.filter(m => m.info?.role === 'assistant' || m.info?.role === 'tool')
      if (!relevant.length) {
        if (attempt < maxAttempts - 1) continue
        break
      }
      const extracted = []
      for (const msg of relevant) {
        for (const part of msg.parts ?? []) {
          if (part.type === 'text' && part.text) {
            extracted.push(part.text)
          } else if (part.type === 'reasoning' && part.text) {
            extracted.push(part.text)
          } else if (part.type === 'thinking' && part.text) {
            extracted.push(part.text)
          } else if (part.type === 'tool' && part.state) {
            if (part.state.status === 'completed' && part.state.title) {
              extracted.push(`[Tool: ${part.tool}] ${part.state.title}`)
            } else if (part.state.status === 'error') {
              extracted.push(`[Tool: ${part.tool}] ERROR: ${part.state.title || 'unknown error'}`)
            }
          }
        }
      }
      const content = extracted.filter(t => t.length > 0).join('\n\n')
      if (content.length > bestContent.length) bestContent = content
      if (msgCount === prevMsgCount && bestContent) return header + bestContent
      prevMsgCount = msgCount
      if (attempt >= maxAttempts - 1) return header + (bestContent || '(No text output)')
    } catch (err) {
      if (attempt >= maxAttempts - 1) {
        if (bestContent) return header + bestContent
        return `${header}Error extracting task result: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  }
  return header + (bestContent || '(No text output)')
}

function buildNotificationText({ task, duration, statusText, allComplete, remainingCount, completedTasks, artifactPath }) {
  const desc = task.description || task.id
  if (allComplete) {
    const succeeded = completedTasks.filter(t => t.status === 'completed')
    const failed = completedTasks.filter(t => t.status !== 'completed')
    let lines = []
    if (succeeded.length) lines.push(...succeeded.map(t => `✓ ${t.id}: ${t.description}`))
    if (failed.length) lines.push(...failed.map(t => `✗ ${t.id}: ${t.description} [${t.status}]`))
    if (!lines.length) lines.push(`${task.id}: ${desc} [${task.status}]`)
    return `<system-reminder>\n[ALL DONE]\n${lines.join('\n')}${artifactPath ? `\nArtifact: ${artifactPath}` : ''}\n</system-reminder>`
  }
  return `<system-reminder>\n[${statusText}] ${task.id}: ${desc} (${duration})${task.error ? ` — ${task.error}` : ''}${remainingCount > 0 ? ` — ${remainingCount} remaining` : ''}\n</system-reminder>`
}

function formatTaskList(tasks, sessionID) {
  if (!tasks.length) return `No background tasks for ${sessionID}.`
  const lines = tasks.map(t => {
    const status = t.status === 'running' ? 'run' : t.status === 'pending' ? 'q' : t.status === 'completed' ? 'done' : t.status === 'error' ? 'err' : t.status === 'cancelled' ? 'x' : t.status === 'interrupt' ? '!' : t.status
    const duration = t.status === 'pending' ? formatDuration(t.queuedAt) : formatDuration(t.startedAt, t.completedAt)
    return `${t.id}: ${t.description} [${t.agent}] ${status} (${duration})`
  })
  return `Background tasks (${tasks.length}):\n${lines.join('\n')}`
}

// ─── Handoff helpers ──────────────────────────────────────────────────────────

const FILE_REGEX = /(?:^|[\s(])@(\.{0,2}\/[^\s,;)"'`]+|[a-zA-Z][a-zA-Z0-9._-]*(?:\/[a-zA-Z0-9._-]+){1,}(?:\.[a-zA-Z0-9]+))/g

function parseFileReferences(text) {
  const fileRefs = new Set()
  for (const match of text.matchAll(FILE_REGEX)) {
    if (match[1]) fileRefs.add(match[1])
  }
  return fileRefs
}

function isBinaryBuffer(buffer) {
  for (let i = 0; i < Math.min(buffer.length, 8192); i++) {
    const byte = buffer[i]
    if (byte === 0) return true
    if (byte < 0x07) return true
    if (byte > 0x0d && byte < 0x20) return true
  }
  return false
}

async function buildSyntheticFileParts(directory, refs) {
  const parts = []
  for (const ref of refs) {
    const filepath = path.resolve(directory, ref)
    try {
      const stats = await fsPromises.stat(filepath)
      if (!stats.isFile()) continue
      const buffer = await fsPromises.readFile(filepath)
      if (isBinaryBuffer(buffer)) continue
      const content = buffer.toString('utf-8')
      const lines = content.split('\n')
      const numbered = lines.map((line, i) => `${i + 1}: ${line}`).join('\n')
      parts.push({ type: 'text', synthetic: true, text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: filepath })}` })
      parts.push({ type: 'text', synthetic: true, text: `<path>${filepath}</path>\n<type>file</type>\n<content>\n${numbered}\n</content>` })
    } catch {}
  }
  return parts
}

function formatTranscript(messages, limit) {
  const lines = []
  for (const msg of messages) {
    if (msg.info.role === 'user') {
      lines.push('## User')
      for (const part of msg.parts) {
        if (part.type === 'text' && !part.ignored) lines.push(part.text)
        if (part.type === 'file') lines.push(`[Attached: ${part.filename || 'file'}]`)
      }
      lines.push('')
    }
    if (msg.info.role === 'assistant') {
      lines.push('## Assistant')
      for (const part of msg.parts) {
        if (part.type === 'text') lines.push(part.text)
        if (part.type === 'tool' && part.state?.status === 'completed') lines.push(`[Tool: ${part.tool}] ${part.state.title}`)
      }
      lines.push('')
    }
  }
  const output = lines.join('\n').trim()
  if (messages.length >= (limit ?? 100)) return output + `\n\n(Showing ${messages.length} most recent messages. Use a higher 'limit' to see more.)`
  return output + `\n\n(End of session - ${messages.length} messages)`
}

const HANDOFF_COMMAND = `GOAL: You are creating a handoff message to continue work in a new session.

When an AI assistant starts a fresh session, it spends significant time exploring the codebase before it can begin actual work. A good handoff frontloads everything the next session needs so it can start implementing immediately.

Analyze this conversation and extract what matters for continuing the work.

1. Identify all relevant files that should be loaded into the next session's context. Include files that will be edited, dependencies being touched, relevant tests, configs, and key reference docs. Target 8-15 files, up to 20 for complex work.

2. Draft the context and goal description. Describe what we're working on and provide whatever context helps continue the work. Preserve decisions, constraints, user preferences, technical patterns. Exclude conversation back-and-forth, dead ends, meta-commentary.

USER: $ARGUMENTS

---

After generating the handoff message, IMMEDIATELY call handoff_session with your prompt and files:
\`handoff_session(prompt="...", files=["src/foo.ts", "src/bar.ts", ...])\``

// ─── PersistenceLayer ─────────────────────────────────────────────────────────

class PersistenceLayer {
  constructor() {}

  artifactPath(taskId, parentSessionID, directory) {
    return path.join(directory, PERSISTENCE_DIR, parentSessionID, `${taskId}.md`)
  }

  artifactDir(taskId, parentSessionID, directory) {
    return path.dirname(this.artifactPath(taskId, parentSessionID, directory))
  }

  async write(taskId, parentSessionID, directory, content, metadata) {
    const dir = this.artifactDir(taskId, parentSessionID, directory)
    await fsPromises.mkdir(dir, { recursive: true })
    const frontmatter = Object.entries(metadata)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n')
    const md = `---\n${frontmatter}\n---\n\n${content}`
    await fsPromises.writeFile(this.artifactPath(taskId, parentSessionID, directory), md, 'utf8')
    return this.artifactPath(taskId, parentSessionID, directory)
  }

  async read(taskId, parentSessionID, directory) {
    try {
      return await fsPromises.readFile(this.artifactPath(taskId, parentSessionID, directory), 'utf8')
    } catch { return null }
  }

  async remove(taskId, parentSessionID, directory) {
    try { await fsPromises.unlink(this.artifactPath(taskId, parentSessionID, directory)) } catch {}
  }

  async listForSession(parentSessionID, directory) {
    const sessionDir = path.join(directory, PERSISTENCE_DIR, parentSessionID)
    try {
      const entries = await fsPromises.readdir(sessionDir)
      const results = []
      for (const entry of entries) {
        if (!entry.endsWith('.md')) continue
        const content = await fsPromises.readFile(path.join(sessionDir, entry), 'utf8')
        const match = content.match(/^---\n([\s\S]*?)\n---\n/)
        if (!match) continue
        const meta = {}
        for (const line of match[1].split('\n')) {
          const colonIdx = line.indexOf(':')
          if (colonIdx > 0) meta[line.slice(0, colonIdx).trim()] = line.slice(colonIdx + 1).trim()
        }
        results.push({ id: entry.replace('.md', ''), ...meta })
      }
      return results
    } catch { return [] }
  }
}

const persistence = new PersistenceLayer()

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
  readTasks = new Set()
  artifactPaths = new Map()

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

  isRead(taskId) { return this.readTasks.has(taskId) }

  markRead(taskId) { this.readTasks.add(taskId) }

  async persistResult(task) {
    if (!task.sessionID) return
    try {
      const result = await formatTaskResult(task, this.client)
      const duration = formatDuration(task.startedAt ?? new Date(), task.completedAt)
      const artifactPath = await persistence.write(
        task.id, task.parentSessionID, this.directory, result,
        {
          id: task.id,
          description: task.description,
          agent: task.agent,
          status: task.status,
          parent_session: task.parentSessionID,
          session: task.sessionID,
          started_at: task.startedAt?.toISOString(),
          completed_at: task.completedAt?.toISOString(),
          duration,
          error: task.error || '',
        }
      )
      this.artifactPaths.set(task.id, artifactPath)
    } catch (persistErr) {
      try {
        const fallback = `Task Result\n\nTask ID: ${task.id}\nStatus: ${task.status}\nError: persistence failed - ${persistErr instanceof Error ? persistErr.message : String(persistErr)}`
        const fallbackPath = await persistence.write(task.id, task.parentSessionID, this.directory, fallback, { id: task.id, status: task.status, error: String(persistErr) })
        this.artifactPaths.set(task.id, fallbackPath)
      } catch {}
    }
  }

  compactionContext(sessionID) {
    const tasks = this.getAllDescendantTasks(sessionID)
    const running = tasks.filter(t => t.status === 'running' || t.status === 'pending')
    const unreadCompleted = tasks.filter(t => {
      const terminal = t.status === 'completed' || t.status === 'error' || t.status === 'cancelled' || t.status === 'interrupt'
      return terminal && !this.isRead(t.id)
    })
    if (running.length === 0 && unreadCompleted.length === 0) return null
    let ctx = '<background-task-context>\n'
    if (running.length > 0) {
      ctx += '  running:\n'
      for (const t of running) ctx += `    - id: ${t.id} description: ${t.description} agent: ${t.agent}\n`
    }
    if (unreadCompleted.length > 0) {
      ctx += '  unread-completed:\n'
      for (const t of unreadCompleted) {
        const artifact = this.artifactPaths.get(t.id) ?? ''
        ctx += `    - id: ${t.id} description: ${t.description} artifact: ${artifact}\n`
      }
    }
    ctx += '</background-task-context>'
    return ctx
  }

  async recoverState(sessionID) {
    const diskTasks = await persistence.listForSession(sessionID, this.directory)
    const recovered = []
    for (const diskTask of diskTasks) {
      if (this.tasks.has(diskTask.id)) continue
      const task = {
        id: diskTask.id,
        description: diskTask.description || '(recovered)',
        agent: diskTask.agent || 'unknown',
        status: diskTask.status || 'completed',
        parentSessionID: sessionID,
        sessionID: diskTask.session || '',
        completedAt: diskTask.completed_at ? new Date(diskTask.completed_at) : new Date(),
        startedAt: diskTask.started_at ? new Date(diskTask.started_at) : undefined,
        error: diskTask.error || '',
      }
      this.tasks.set(task.id, task)
      const artifactPath = persistence.artifactPath(task.id, sessionID, this.directory)
      this.artifactPaths.set(task.id, artifactPath)
      recovered.push(task)
    }
    return recovered
  }

  async recoverStateForTask(taskId) {
    const baseDir = path.join(this.directory, PERSISTENCE_DIR)
    try {
      const sessionDirs = await fsPromises.readdir(baseDir)
      for (const sessionDir of sessionDirs) {
        const sessionPath = path.join(baseDir, sessionDir)
        try {
          const files = await fsPromises.readdir(sessionPath)
          if (files.includes(`${taskId}.md`)) {
            await this.recoverState(sessionDir)
            return
          }
        } catch {}
      }
    } catch {}
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
      await this.persistResult(task)
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
        void this.persistResult(task).then(() => {
          this.markForNotification(task)
          void this.notifyParentSession(task)
        })
      }
    }
  }

  async tryCompleteTask(task, _source) {
    // Atomic guard: prevent concurrent completion attempts from poll + idle + error handlers
    if (task.status !== 'running' || task.completing) return
    task.completing = true
    
    try {
      if (task.concurrencyKey) { this.concurrencyManager.release(task.concurrencyKey); task.concurrencyKey = undefined }
      await sleep(2000)
      await this.persistResult(task)
      task.status = 'completed'
      task.completedAt = new Date()
      this.markForNotification(task)
      try { await this.client.session.abort({ path: { id: task.sessionID } }) } catch {}
      await this.notifyParentSession(task)
    } catch (err) {
      task.status = 'error'
      task.error = err instanceof Error ? err.message : String(err)
      task.completedAt = new Date()
      this.markForNotification(task)
      await this.notifyParentSession(task)
    } finally {
      task.completing = false
    }
  }

  handleEvent(event) {
    const props = event.properties
    if (event.type === 'session.idle') {
      const sessionID = typeof props?.sessionID === 'string' ? props.sessionID : undefined
      if (!sessionID) return
      const task = this.findBySession(sessionID)
      if (!task || task.status !== 'running' || task.completing) return
      const existingTimer = this.completionTimers.get(task.id)
      if (existingTimer) return
      const timer = setTimeout(() => { this.completionTimers.delete(task.id); void this.tryCompleteTask(task, 'session.idle') }, 5000)
      if (typeof timer?.unref === 'function') timer.unref()
      this.completionTimers.set(task.id, timer)
    }
    if (event.type === 'session.error') {
      const sessionID = typeof props?.sessionID === 'string' ? props.sessionID : undefined
      if (!sessionID) return
      const task = this.findBySession(sessionID)
      if (!task || task.status !== 'running' || task.completing) return
      task.status = 'error'
      task.error = typeof props?.error?.message === 'string' ? props.error.message : 'Session error'
      task.completedAt = new Date()
      if (task.concurrencyKey) { this.concurrencyManager.release(task.concurrencyKey); task.concurrencyKey = undefined }
      void this.persistResult(task).then(() => {
        this.markForNotification(task)
        void this.notifyParentSession(task)
      })
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
    // Deduplicate: prevent multiple notifications for the same task
    if (task.notified) return
    task.notified = true
    const duration = formatDuration(task.startedAt ?? new Date(), task.completedAt)
    const artifactPath = this.artifactPaths.get(task.id) ?? ''
    if (!this.completedTaskSummaries.has(task.parentSessionID)) {
      this.completedTaskSummaries.set(task.parentSessionID, [])
    }
    this.completedTaskSummaries.get(task.parentSessionID).push({
      id: task.id, description: task.description, status: task.status, error: task.error, artifactPath,
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
      ? (this.completedTaskSummaries.get(task.parentSessionID) ?? [{ id: task.id, description: task.description, status: task.status, error: task.error, artifactPath }])
      : []
    if (allComplete) this.completedTaskSummaries.delete(task.parentSessionID)
    const statusText = task.status === 'completed' ? 'COMPLETED'
      : task.status === 'interrupt' ? 'INTERRUPTED'
      : task.status === 'error' ? 'ERROR'
      : 'CANCELLED'
    const notification = buildNotificationText({ task, duration, statusText, allComplete, remainingCount, completedTasks, artifactPath })
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
const handoffProcessedSessions = new Set()

export const GroundworkPlugin = async ({ client, directory }) => {
  manager.client = client
  manager.directory = directory

  return {
    config: async (config) => {
      config.skills = config.skills || {}
      config.skills.paths = config.skills.paths || []
      if (!config.skills.paths.includes(groundworkSkillsDir)) {
        config.skills.paths.push(groundworkSkillsDir)
      }
      config.command = config.command || {}
      config.command['handoff'] = {
        description: 'Create a focused handoff prompt for a new session',
        template: HANDOFF_COMMAND,
      }
      try {
        const gitignorePath = path.join(directory, '.gitignore')
        const OPENCODE_IGNORE = '.opencode/background-tasks/'
        let gitignore = ''
        try { gitignore = await fsPromises.readFile(gitignorePath, 'utf8') } catch {}
        if (!gitignore.includes(OPENCODE_IGNORE)) {
          const newContent = gitignore ? (gitignore.endsWith('\n') ? gitignore : gitignore + '\n') + OPENCODE_IGNORE + '\n' : OPENCODE_IGNORE + '\n'
          await fsPromises.writeFile(gitignorePath, newContent, 'utf8')
        }
      } catch {}
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
      background_task: tool({
        description: 'Launch background task. Returns task_id. Use background_output after notification.',
        args: {
          description: z.string().describe('Short description (3-5 words)'),
          prompt: z.string().describe('Self-contained prompt with all context'),
          agent: z.string().describe('Agent type (general, explore, coder)'),
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
      }),

      background_output: tool({
        description: 'Get background task output. Call after notification.',
        args: {
          task_id: z.string().describe('Task ID to get output from'),
          block: z.boolean().optional().describe('Wait for completion (default: false)'),
          timeout: z.number().optional().describe('Max wait time in ms when blocking (default: 60000, max: 600000)'),
        },
        async execute(args) {
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
            const isActive = (t) => t.status === 'pending' || t.status === 'running' || t.completing
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
              if (persisted && !persisted.endsWith('(No text output)') && !persisted.endsWith('(No messages found)') && !persisted.endsWith('(No assistant or tool response found)')) return persisted
              if (resolvedTask.status === 'completed') return await formatTaskResult(resolvedTask, client)
            }
            return formatTaskStatus(resolvedTask)
          } catch (error) {
            return `Error getting output: ${error instanceof Error ? error.message : String(error)}`
          }
        },
      }),

      background_list: tool({
        description: 'List background tasks for this session.',
        args: {
          include_completed: z.boolean().optional().describe('Include completed/failed tasks (default: false, shows only active)'),
        },
        async execute(args, toolContext) {
          try {
            let allTasks = manager.getAllDescendantTasks(toolContext.sessionID)
            if (!allTasks.length) {
              await manager.recoverState(toolContext.sessionID)
              allTasks = manager.getAllDescendantTasks(toolContext.sessionID)
            }
            const tasks = args.include_completed
              ? allTasks
              : allTasks.filter(t => t.status === 'running' || t.status === 'pending')
            return formatTaskList(tasks, toolContext.sessionID)
          } catch (error) {
            return `Error listing tasks: ${error instanceof Error ? error.message : String(error)}`
          }
        },
      }),

      background_cancel: tool({
        description: 'Cancel background task(s). Use all=true for all.',
        args: {
          taskId: z.string().optional().describe('Task ID to cancel'),
          all: z.boolean().optional().describe('Cancel all running background tasks'),
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
      }),

      handoff_session: tool({
        description: 'Create a new session with the handoff prompt as an editable draft. Called after /handoff command generates the summary.',
        args: {
          prompt: z.string().describe('The generated handoff prompt'),
          files: z.array(z.string()).optional().describe('Array of file paths to load into the new session context'),
        },
        async execute(args, context) {
          const sessionReference = `Continuing work from session ${context.sessionID}. When you lack specific information you can use read_session to get it.`
          const fileRefs = args.files?.length
            ? args.files.map(f => `@${f.replace(/^@/, '')}`).join(' ')
            : ''
          const fullPrompt = fileRefs
            ? `${sessionReference}\n\n${fileRefs}\n\n${args.prompt}`
            : `${sessionReference}\n\n${args.prompt}`
          await client.tui.executeCommand({ body: { command: 'session_new' } })
          await new Promise(r => setTimeout(r, 150))
          await client.tui.appendPrompt({ body: { text: fullPrompt } })
          await client.tui.showToast({
            body: { title: 'Handoff Ready', message: 'Review and edit the draft, then send', variant: 'success', duration: 4000 }
          })
          return 'Handoff prompt created in new session. Review and edit before sending.'
        }
      }),

      read_session: tool({
        description: 'Read the conversation transcript from a previous session. Use when you need specific information from the source session not in the handoff summary.',
        args: {
          sessionID: z.string().describe('The full session ID (e.g., sess_01jxyz...)'),
          limit: z.number().optional().describe('Maximum number of messages to read (defaults to 100, max 500)'),
        },
        async execute(args) {
          const limit = Math.min(args.limit ?? 100, 500)
          try {
            const response = await client.session.messages({
              path: { id: args.sessionID },
              query: { limit }
            })
            const messages = extractMessages(response)
            if (!messages.length) return 'Session has no messages or does not exist.'
            return formatTranscript(messages, limit)
          } catch (error) {
            return `Could not read session ${args.sessionID}: ${error instanceof Error ? error.message : 'Unknown error'}`
          }
        }
      }),
    },

    event: async ({ event }) => {
      manager.handleEvent(event)
      if (event.type === 'session.deleted') {
        handoffProcessedSessions.delete(event.properties?.info?.id)
      }
    },

    'chat.message': async (_input, output) => {
      manager.injectPendingNotifications(output.parts, _input.sessionID)
      const sessionID = output.message.sessionID ?? _input.sessionID
      if (handoffProcessedSessions.has(sessionID)) return
      const text = output.parts
        .filter(p => p.type === 'text' && !p.synthetic && typeof p.text === 'string')
        .map(p => p.text)
        .join('\n')
      if (!text.includes('Continuing work from session')) return
      handoffProcessedSessions.add(sessionID)
      const fileRefs = parseFileReferences(text)
      if (fileRefs.size === 0) return
      const fileParts = await buildSyntheticFileParts(directory, fileRefs)
      if (fileParts.length === 0) return
      await client.session.prompt({
        path: { id: sessionID },
        body: {
          noReply: true,
          model: output.message.model,
          agent: output.message.agent,
          parts: fileParts,
        },
      })
    },

    'experimental.session.compacting': async ({ sessionID }) => {
      try {
        return manager.compactionContext(sessionID)
      } catch { return null }
    },
  }
}

export default GroundworkPlugin
