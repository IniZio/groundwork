// ─── BackgroundManager ─────────────────────────────────────────────────────
// Manages background task lifecycle: launch, complete, cancel, notify.

import path from 'node:path'
import { formatDuration, truncateText, sleep, extractMessages, extractFailureContext } from './helpers.js'
import { captureFileSnapshot, diffFileSnapshots } from './snapshot.js'
import { BACKGROUND_TASK_PREAMBLE } from './preamble.js'
import { formatTaskStatus, formatTaskResult, buildNotificationText, formatTaskList } from './task-formatting.js'
import { PersistenceLayer } from './persistence.js'
import { ConcurrencyManager } from './concurrency.js'
import type { TaskInfo, TaskLaunchInput } from '../types.js'

// ─── Constants ──────────────────────────────────────────────────────────────

const TASK_CLEANUP_DELAY_MS = 10 * 60 * 1000   // 10 minutes
const TASK_TTL_MS = 30 * 60 * 1000              // 30 minutes
const WAITING_TIMEOUT_MS = 5 * 60 * 1000        // 5 minutes
const CLEANUP_DELAY_MS = 5 * 60 * 1000          // 5 minutes idle window for reactivation

// ─── BackgroundManager ──────────────────────────────────────────────────────

export class BackgroundManager {
  tasks = new Map<string, TaskInfo>()
  notifications = new Map<string, TaskInfo[]>()
  pendingNotifications = new Map<string, string[]>()
  pendingByParent = new Map<string, Set<string>>()
  completedTaskSummaries = new Map<string, Array<{ id: string; description?: string; status?: string; error?: string; artifactPath?: string }>>()
  concurrencyManager = new ConcurrencyManager()
  queuesByKey = new Map<string, Array<{ task: TaskInfo; input: TaskLaunchInput }>>()
  artifactPaths = new Map<string, string>()
  readTasks = new Set<string>()

  // Set by plugin init
  client: any
  directory: string = ''

  // Persistence layer
  persistence = new PersistenceLayer()

  // ─── Task Accessors ─────────────────────────────────────────────────────

  getTask(taskId: string): TaskInfo | undefined {
    return this.tasks.get(taskId)
  }

  getTasksByParent(parentSessionID: string): TaskInfo[] {
    return Array.from(this.tasks.values()).filter(t => t.parentSessionID === parentSessionID)
  }

  getAllDescendantTasks(sessionID: string): TaskInfo[] {
    const direct = this.getTasksByParent(sessionID)
    const result = [...direct]
    for (const task of direct) {
      if (task.sessionID) {
        result.push(...this.getAllDescendantTasks(task.sessionID))
      }
    }
    return result
  }

  findBySession(sessionID: string): TaskInfo | undefined {
    for (const task of this.tasks.values()) {
      if (task.sessionID === sessionID) return task
    }
    return undefined
  }

  isRead(taskId: string): boolean {
    return this.readTasks.has(taskId)
  }

  markRead(taskId: string): void {
    this.readTasks.add(taskId)
  }

  // ─── Persistence ────────────────────────────────────────────────────────

  async persistResult(task: TaskInfo): Promise<void> {
    // Pass sessionID explicitly so formatTaskResult can read session messages
    // even if task.sessionID was cleared (e.g., by session cleanup timer)
    const result = await formatTaskResult(task, this.client, { sessionID: task.sessionID })
    const duration = formatDuration(task.startedAt ?? new Date(), task.completedAt)
    const metadata = {
      id: task.id,
      description: task.description ?? '',
      agent: task.agent,
      status: task.status,
      parent_session: task.parentSessionID,
      session: task.sessionID ?? '',
      started_at: task.startedAt?.toISOString(),
      queued_at: task.queuedAt?.toISOString(),
      completed_at: task.completedAt?.toISOString(),
      duration,
      timeout: task.timeout,
      error: task.error ?? '',
    }
    const artifactPath = await this.persistence.write(task.id, task.parentSessionID, this.directory, result, metadata)
    this.artifactPaths.set(task.id, artifactPath)
  }

  compactionContext(sessionID: string): any {
    const tasks = this.getAllDescendantTasks(sessionID)
    if (!tasks.length) return null

    const active = tasks.filter(t => t.status === 'running' || t.status === 'pending')
    const completed = tasks.filter(t => t.status === 'completed' || t.status === 'error' || t.status === 'cancelled')
    const summaries = completed.map(t => ({
      id: t.id,
      description: t.description,
      status: t.status,
      error: t.error,
    }))

    return {
      backgroundTasks: summaries,
      activeTasks: active.map(t => t.id),
    }
  }

  // ─── State Recovery ─────────────────────────────────────────────────────

  async recoverState(sessionID: string): Promise<void> {
    const results = await this.persistence.listForSession(sessionID, this.directory)
    for (const result of results) {
      if (!this.tasks.has(result.id)) {
        const task: TaskInfo = {
          id: result.id,
          parentSessionID: sessionID,
          status: result.status as TaskInfo['status'],
          description: result.description,
          agent: result.agent ?? 'unknown',
          prompt: '',
          createdAt: new Date(result.queued_at ?? Date.now()),
          queuedAt: result.queued_at ? new Date(result.queued_at) : undefined,
          startedAt: result.started_at ? new Date(result.started_at) : undefined,
          completedAt: result.completed_at ? new Date(result.completed_at) : undefined,
          error: result.error,
        }
        this.tasks.set(result.id, task)
      }
    }
  }

  async recoverStateForTask(taskId: string): Promise<void> {
    const result = await this.persistence.readMeta(taskId, this.directory)
    if (result && !this.tasks.has(taskId)) {
      const task: TaskInfo = {
        id: result.id,
        parentSessionID: result.parent_session,
        sessionID: result.session,
        status: result.status as TaskInfo['status'],
        description: result.description,
        agent: result.agent ?? 'unknown',
        prompt: '',
        createdAt: new Date(result.queued_at ?? Date.now()),
        queuedAt: result.queued_at ? new Date(result.queued_at) : undefined,
        startedAt: result.started_at ? new Date(result.started_at) : undefined,
        completedAt: result.completed_at ? new Date(result.completed_at) : undefined,
        error: result.error,
      }
      this.tasks.set(taskId, task)
    }
  }

  // ─── Dependency Checking ────────────────────────────────────────────────

  checkDependencies(task: TaskInfo): boolean | string {
    if (!task.depends_on || task.depends_on.length === 0) return true

    const missing: string[] = []
    const failed: string[] = []

    for (const depId of task.depends_on) {
      const dep = this.tasks.get(depId)
      if (!dep) {
        missing.push(depId)
      } else if (dep.status === 'error' || dep.status === 'cancelled') {
        failed.push(depId)
      } else if (dep.status !== 'completed') {
        return false // Still pending/running
      }
    }

    if (missing.length > 0) return 'missing'
    if (failed.length > 0) return 'failed'
    return true
  }

  // ─── Task Launch ────────────────────────────────────────────────────────

  async launch(input: TaskLaunchInput): Promise<TaskInfo> {
    const taskId = `bg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
    const task: TaskInfo = {
      id: taskId,
      parentSessionID: input.parentSessionID,
      description: input.description,
      agent: input.agent.trim(),
      prompt: input.prompt,
      depends_on: input.depends_on,
      timeout: input.timeout,
      status: 'pending',
      createdAt: new Date(),
      queuedAt: new Date(),
    }

    // Check dependencies before queueing
    if (input.depends_on && input.depends_on.length > 0) {
      const depStatus = this.checkDependencies(task)
      if (depStatus === false) {
        task.status = 'waiting'
        this.tasks.set(taskId, task)
        this.addToPending(input.parentSessionID, taskId)
        return task
      } else if (depStatus === 'failed' || depStatus === 'missing') {
        task.status = 'error'
        const missingDeps = input.depends_on.filter(depId => !this.tasks.has(depId))
        task.error = missingDeps.length > 0
          ? `Dependency not found: ${missingDeps.join(', ')} (these tasks were never launched)`
          : `Dependency failed: one or more required tasks (${input.depends_on.join(', ')}) failed or were cancelled`
        task.completedAt = new Date()
        this.tasks.set(taskId, task)
        this.markForNotification(task)
        void this.notifyParentSession(task)
        return task
      }
    }

    this.tasks.set(taskId, task)
    this.addToPending(input.parentSessionID, taskId)

    // Try to capture before snapshot
    try {
      const parentSession = await this.client.session.get({ path: { id: input.parentSessionID }, query: { directory: this.directory } }).catch(() => null)
      const parentDirectory = parentSession?.data?.directory ?? this.directory
      task.beforeSnapshot = await captureFileSnapshot(parentDirectory)
    } catch {}

    // Queue by agent key
    const key = input.agent.trim()
    const queue = this.queuesByKey.get(key) ?? []
    queue.push({ task, input })
    this.queuesByKey.set(key, queue)
    void this.processKey(key)

    return task
  }

  private addToPending(parentSessionID: string, taskId: string): void {
    const pending = this.pendingByParent.get(parentSessionID) ?? new Set<string>()
    pending.add(taskId)
    this.pendingByParent.set(parentSessionID, pending)
  }

  async processKey(key: string): Promise<void> {
    const queue = this.queuesByKey.get(key)
    if (!queue || queue.length === 0) return
    await this.concurrencyManager.acquire(key)
    const entry = queue.shift()
    if (queue.length === 0) this.queuesByKey.delete(key)
    if (!entry) { this.concurrencyManager.release(key); return }
    await this.startTask(entry.task, entry.input)
  }

  async startTask(task: TaskInfo, input: TaskLaunchInput): Promise<void> {
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

    // Store parent context
    ;(task as any).parentModel = input.parentModel
    ;(task as any).parentAgent = input.parentAgent
    ;(task as any).parentMessageID = input.parentMessageID

    const launchModel = input.parentModel
      ? { providerID: input.parentModel.providerID, modelID: input.parentModel.modelID }
      : undefined

    const promptBody: any = {
      agent: input.agent.trim(),
      ...(launchModel ? { model: launchModel } : {}),
      parts: [{ type: 'text', text: BACKGROUND_TASK_PREAMBLE + input.prompt, synthetic: true }],
    }

    // Fire-and-forget wrapper so startTask() returns immediately
    void (async () => {
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Task timed out')), TASK_TTL_MS)
        )
        const result = await Promise.race([
          this.client.session.prompt({
            path: { id: sessionID },
            body: promptBody,
          }),
          timeoutPromise,
        ])
        // session.prompt() resolves when the agent finishes — reliable completion detection
        await this.tryCompleteTask(task, 'prompt-resolved')
      } catch (error: any) {
        const msg = error instanceof Error ? error.message : String(error)
        task.status = 'interrupt'
        task.error = msg
        task.completedAt = new Date()
        if (task.concurrencyKey) { this.concurrencyManager.release(task.concurrencyKey); task.concurrencyKey = undefined }
        try { await this.client.session.abort({ path: { id: sessionID } }) } catch {}
        await this.persistResult(task)
        this.markForNotification(task)
        void this.notifyParentSession(task)
      }
    })()
  }

  // ─── Cancel ─────────────────────────────────────────────────────────────

  async cancelTask(taskId: string, options: { source?: string; abortSession?: boolean; skipNotification?: boolean } = {}): Promise<boolean> {
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

    const shouldAbort = options.abortSession !== false
    if (shouldAbort && task.sessionID) {
      try { await this.client.session.abort({ path: { id: task.sessionID } }) } catch {}
    }

    if (options.skipNotification) {
      this.cleanupPendingByParent(task)
      this.scheduleTaskRemoval(task.id)
      return true
    }

    this.markForNotification(task)
    await this.notifyParentSession(task)
    return true
  }

  // ─── Pending Notification Injection ─────────────────────────────────────

  injectPendingNotifications(parts: any[], sessionID: string): void {
    const notifications = this.pendingNotifications.get(sessionID)
    if (!notifications || notifications.length === 0) return
    this.pendingNotifications.delete(sessionID)
    const content = notifications.join('\n\n')
    const firstText = parts.findIndex((p: any) => p.type === 'text')
    if (firstText === -1) {
      parts.unshift({ type: 'text', text: content, synthetic: true })
    } else {
      parts[firstText].text = `${content}\n\n---\n\n${parts[firstText].text ?? ''}`
    }
  }

  // ─── Task Completion ────────────────────────────────────────────────────

  async tryCompleteTask(task: TaskInfo, _source: string): Promise<void> {
    if (task.status !== 'running') return

    try {
      if (task.concurrencyKey) { this.concurrencyManager.release(task.concurrencyKey); task.concurrencyKey = undefined }
      // No artificial sleep — formatTaskResult polls session.messages with content-aware backoff
      task.status = 'completed'
      task.completedAt = new Date()
      await this.persistResult(task)

      try {
        const parentSession = await this.client.session.get({ path: { id: task.parentSessionID }, query: { directory: this.directory } }).catch(() => null)
        const parentDirectory = parentSession?.data?.directory ?? this.directory
        const afterSnapshot = await captureFileSnapshot(parentDirectory)
        if (task.beforeSnapshot) {
          ;(task as any).fileChanges = diffFileSnapshots(task.beforeSnapshot, afterSnapshot)
        }
      } catch (err) {
        console.error(`[BackgroundManager] Failed to capture after snapshot for task ${task.id}: ${err instanceof Error ? err.message : String(err)}`)
      }

      this.markForNotification(task)
      this.scheduleSessionCleanup(task)
      await this.notifyParentSession(task)
      await this.checkWaitingTasks()
    } catch (err) {
      task.status = 'error'
      task.error = err instanceof Error ? err.message : String(err)
      task.completedAt = new Date()
      this.markForNotification(task)
      await this.notifyParentSession(task)
      await this.checkWaitingTasks()
    }
  }

  scheduleSessionCleanup(task: TaskInfo): void {
    if ((task as any)._cleanupTimer) clearTimeout((task as any)._cleanupTimer)
    ;(task as any)._cleanupTimer = setTimeout(async () => {
      if (task.status === 'completed' && task.sessionID) {
        try {
          await this.client.session.abort({ path: { id: task.sessionID } })
          task.sessionID = undefined
        } catch {}
      }
      ;(task as any)._cleanupTimer = undefined
    }, CLEANUP_DELAY_MS)
  }

  cancelSessionCleanup(task: TaskInfo): void {
    if ((task as any)._cleanupTimer) {
      clearTimeout((task as any)._cleanupTimer)
      ;(task as any)._cleanupTimer = undefined
    }
  }

  async checkWaitingTasks(): Promise<void> {
    for (const task of this.tasks.values()) {
      if (task.status !== 'waiting') continue
      const depStatus = this.checkDependencies(task)
      if (depStatus === true) {
        task.status = 'pending'
        const key = task.agent.trim()
        const queue = this.queuesByKey.get(key) ?? []
        queue.push({
          task,
          input: {
            agent: task.agent,
            prompt: task.prompt,
            description: task.description,
            parentSessionID: task.parentSessionID,
            parentMessageID: (task as any).parentMessageID,
            parentModel: (task as any).parentModel,
            parentAgent: (task as any).parentAgent,
          }
        })
        this.queuesByKey.set(key, queue)
        void this.processKey(key)
      } else if (depStatus === 'failed' || depStatus === 'missing') {
        const missingDeps = task.depends_on?.filter(depId => !this.tasks.has(depId))
        task.status = 'error'
        if (missingDeps && missingDeps.length > 0) {
          task.error = `Dependency not found: ${missingDeps.join(', ')} (these tasks were never launched)`
        } else {
          task.error = `Dependency failed: one or more required tasks (${task.depends_on?.join(', ')}) failed or were cancelled`
        }
        task.completedAt = new Date()
        this.markForNotification(task)
        void this.notifyParentSession(task)
      }
    }
  }

  // ─── Event Handling ─────────────────────────────────────────────────────

  handleEvent(event: any): void {
    const props = event.properties

    if (event.type === 'session.error') {
      const sessionID = typeof props?.sessionID === 'string' ? props.sessionID : undefined
      if (!sessionID) return
      const task = this.findBySession(sessionID)
      if (!task || task.status !== 'running') return
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
    }
  }

  // ─── Notification Management ────────────────────────────────────────────

  markForNotification(task: TaskInfo): void {
    const queue = this.notifications.get(task.parentSessionID) ?? []
    queue.push(task)
    this.notifications.set(task.parentSessionID, queue)
  }

  cleanupPendingByParent(task: TaskInfo): void {
    if (!task.parentSessionID) return
    const pending = this.pendingByParent.get(task.parentSessionID)
    if (pending) { pending.delete(task.id); if (pending.size === 0) this.pendingByParent.delete(task.parentSessionID) }
  }

  scheduleTaskRemoval(taskId: string): void {
    const timer = setTimeout(() => { this.tasks.delete(taskId) }, TASK_CLEANUP_DELAY_MS)
    if (typeof timer?.unref === 'function') timer.unref()
  }

  async notifyParentSession(task: TaskInfo): Promise<void> {
    if ((task as any).notified) return
    ;(task as any).notified = true

    const duration = formatDuration(task.startedAt ?? new Date(), task.completedAt)
    const artifactPath = this.artifactPaths.get(task.id) ?? ''

    if (!this.completedTaskSummaries.has(task.parentSessionID)) {
      this.completedTaskSummaries.set(task.parentSessionID, [])
    }
    this.completedTaskSummaries.get(task.parentSessionID)!.push({
      id: task.id, description: task.description, status: task.status, error: task.error, artifactPath,
    })

    const pendingSet = this.pendingByParent.get(task.parentSessionID)
    let remainingCount = 0
    let allComplete = false
    if (pendingSet) {
      pendingSet.delete(task.id)
      remainingCount = pendingSet.size
      allComplete = remainingCount === 0
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
      await this.client.session.prompt({
        path: { id: task.parentSessionID },
        body: {
          noReply: !shouldReply,
          ...((task as any).parentAgent !== undefined ? { agent: (task as any).parentAgent } : {}),
          ...((task as any).parentModel !== undefined ? { model: (task as any).parentModel } : {}),
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
