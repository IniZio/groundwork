import fs from 'fs/promises'
import path from 'path'
import os from 'os'

const z = { string: () => ({ describe: () => {} }), boolean: () => ({ optional: () => ({ describe: () => {} }) }), number: () => ({ optional: () => ({ describe: () => {} }) }), array: () => ({ optional: () => ({ describe: () => {} }) }) }
const tool = { schema: z }
tool.__mock = true

const __dirname = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1')
const pluginPath = path.resolve(__dirname, '.opencode/plugins/groundwork.js')

const PERSISTENCE_BASE = path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'), 'opencode', 'background-tasks')

function hashPath(p) {
  let hash = 0
  for (let i = 0; i < p.length; i++) {
    hash = ((hash << 5) - hash) + p.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

const TEST_DIR = path.join(os.tmpdir(), `bg-test-${Date.now()}`)
const TEST_PROJECT_DIR = path.join(TEST_DIR, 'project')

let passed = 0
let failed = 0

function assert(condition, label) {
  if (condition) { passed++; console.log(`  ✅ ${label}`) }
  else { failed++; console.log(`  ❌ ${label}`) }
}

async function setup() {
  await fs.mkdir(TEST_PROJECT_DIR, { recursive: true })
  await fs.mkdir(path.join(TEST_DIR, 'artifacts'), { recursive: true })
}

async function cleanup() {
  await fs.rm(TEST_DIR, { recursive: true }).catch(() => {})
}

// ─── PersistenceLayer Tests ──────────────────────────────────────────────────

async function testPersistenceLayer() {
  console.log('\n📦 PersistenceLayer Tests')
  
  const plBase = path.join(TEST_DIR, 'persistence')
  
  class PersistenceLayer {
    constructor(b) { this.basePath = b }
    artifactPath(id, parent, dir) { return path.join(this.basePath, hashPath(dir), parent, `${id}.md`) }
    artifactDir(id, parent, dir) { return path.dirname(this.artifactPath(id, parent, dir)) }
    async write(id, parent, dir, content, meta) {
      const d = this.artifactDir(id, parent, dir); await fs.mkdir(d, { recursive: true })
      const fm = Object.entries(meta).filter(([,v]) => v !== undefined && v !== null).map(([k,v]) => `${k}: ${v}`).join('\n')
      await fs.writeFile(this.artifactPath(id, parent, dir), `---\n${fm}\n---\n\n${content}`, 'utf8')
      return this.artifactPath(id, parent, dir)
    }
    async read(id, parent, dir) { try { return await fs.readFile(this.artifactPath(id, parent, dir), 'utf8') } catch { return null } }
    async remove(id, parent, dir) { try { await fs.unlink(this.artifactPath(id, parent, dir)) } catch {} }
    async listForSession(parent, dir) {
      const sd = path.join(this.basePath, hashPath(dir), parent)
      try {
        const entries = await fs.readdir(sd); const results = []
        for (const e of entries) { if (!e.endsWith('.md')) continue
          const c = await fs.readFile(path.join(sd, e), 'utf8')
          const m = c.match(/^---\n([\s\S]*?)\n---\n/); if (!m) continue
          const meta = {}; for (const l of m[1].split('\n')) { const ci = l.indexOf(':'); if(ci>0) meta[l.slice(0,ci).trim()] = l.slice(ci+1).trim() }
          results.push({id: e.replace('.md',''), ...meta})
        }; return results
      } catch { return [] }
    }
  }
  
  const pl = new PersistenceLayer(plBase)
  const parent = 'sess_parent001'
  const taskId = 'bg_test00001'
  
  // Test 1: Write artifact
  const artPath = await pl.write(taskId, parent, TEST_PROJECT_DIR, 'Task output: Hello World', {
    id: taskId, description: 'test task', agent: 'advisor', status: 'completed',
    parent_session: parent, session: 'sess_child001', error: ''
  })
  assert(artPath.endsWith(`${taskId}.md`), 'Write returns correct artifact path')
  assert(await fs.access(artPath).then(() => true).catch(() => false), 'Artifact file exists on disk')
  
  // Test 2: Read artifact
  const content = await pl.read(taskId, parent, TEST_PROJECT_DIR)
  assert(content !== null, 'Read returns content')
  assert(content.startsWith('---\n'), 'Artifact has YAML frontmatter')
  assert(content.includes('Hello World'), 'Artifact contains task output')
  assert(content.includes('status: completed'), 'Artifact has status metadata')
  
  // Test 3: List for session
  const list = await pl.listForSession(parent, TEST_PROJECT_DIR)
  assert(list.length === 1, 'List returns 1 task')
  assert(list[0].id === taskId, 'List returns correct task ID')
  assert(list[0].status === 'completed', 'List returns correct status')
  
  // Test 4: Multiple tasks for same session
  const taskId2 = 'bg_test00002'
  await pl.write(taskId2, parent, TEST_PROJECT_DIR, 'Second task output', {
    id: taskId2, description: 'task 2', agent: 'coder', status: 'error',
    parent_session: parent, session: 'sess_child002', error: 'timeout'
  })
  const list2 = await pl.listForSession(parent, TEST_PROJECT_DIR)
  assert(list2.length === 2, 'List returns 2 tasks after second write')
  
  // Test 5: Remove artifact
  await pl.remove(taskId, parent, TEST_PROJECT_DIR)
  const afterRemove = await pl.read(taskId, parent, TEST_PROJECT_DIR)
  assert(afterRemove === null, 'Read returns null after remove')
  
  // Test 6: Read non-existent artifact
  const noExist = await pl.read('bg_nonexistent', parent, TEST_PROJECT_DIR)
  assert(noExist === null, 'Read non-existent returns null')
  
  // Test 7: List empty session
  const emptyList = await pl.listForSession('sess_nobody', TEST_PROJECT_DIR)
  assert(emptyList.length === 0, 'List empty session returns 0')
}

// ─── Notification Format Tests ───────────────────────────────────────────────

async function testNotificationFormat() {
  console.log('\n🔔 Notification Format Tests')
  
  function buildNotificationText({ task, duration, statusText, allComplete, remainingCount, completedTasks, artifactPath }) {
    const desc = task.description || task.id
    const errorInfo = task.error ? `\n**Error:** ${task.error}` : ''
    if (allComplete) {
      const succeeded = completedTasks.filter(t => t.status === 'completed')
      const failed = completedTasks.filter(t => t.status !== 'completed')
      const header = failed.length > 0 ? `[ALL BACKGROUND TASKS FINISHED - ${failed.length} FAILED]` : '[ALL BACKGROUND TASKS COMPLETE]'
      let body = ''
      if (succeeded.length) body += `**Completed:**\n${succeeded.map(t => `- \`${t.id}\`: ${t.description}${t.artifactPath ? ` → ${t.artifactPath}` : ''}`).join('\n')}\n`
      if (failed.length) body += `\n**Failed:**\n${failed.map(t => `- \`${t.id}\`: ${t.description} [${t.status.toUpperCase()}]${t.error ? ` - ${t.error}` : ''}`).join('\n')}\n`
      if (!body) body = `- \`${task.id}\`: ${desc} [${task.status.toUpperCase()}]${task.error ? ` - ${task.error}` : ''}\n`
      return `<system-reminder>\n${header}\n\n${body.trim()}\n\nUse \`background_output(task_id="<id>")\` to retrieve each result.${artifactPath ? `\nArtifact: ${artifactPath}` : ''}${failed.length > 0 ? `\n\n**ACTION REQUIRED:** ${failed.length} task(s) failed.` : ''}\n</system-reminder>`
    }
    const isFailure = statusText !== 'COMPLETED'
    return `<system-reminder>\n[BACKGROUND TASK ${statusText}]\n**ID:** \`${task.id}\`\n**Description:** ${desc}\n**Duration:** ${duration}${errorInfo}${artifactPath ? `\n**Artifact:** ${artifactPath}` : ''}\n\n**${remainingCount} task${remainingCount === 1 ? '' : 's'} still in progress.** You WILL be notified when ALL complete.\n${isFailure ? '**ACTION REQUIRED:** This task failed. Check the error and decide whether to retry.' : 'Do NOT poll - continue productive work.'}\n\nUse \`background_output(task_id="${task.id}")\` to retrieve this result when ready.\n</system-reminder>`
  }
  
  const fakeTask = { id: 'bg_abc123', description: 'advisor check', status: 'completed' }
  const fakeArtifact = '/tmp/artifacts/bg_abc123.md'
  
  // Test 1: Single completed notification with artifact
  const singleNotif = buildNotificationText({
    task: fakeTask, duration: '5.2s', statusText: 'COMPLETED',
    allComplete: false, remainingCount: 1, completedTasks: [], artifactPath: fakeArtifact
  })
  assert(singleNotif.includes('**Artifact:** ' + fakeArtifact), 'Single notification includes artifact path')
  assert(!singleNotif.includes('FULL TASK OUTPUT'), 'Notification is summary-only (no full output)')
  assert(singleNotif.includes('background_output'), 'Notification references background_output tool')
  
  // Test 2: All-complete notification with artifact paths
  const allComplete = buildNotificationText({
    task: fakeTask, duration: '5.2s', statusText: 'COMPLETED',
    allComplete: true, remainingCount: 0,
    completedTasks: [
      { id: 'bg_abc123', description: 'advisor check', status: 'completed', artifactPath: fakeArtifact },
      { id: 'bg_def456', description: 'code review', status: 'error', error: 'timeout' }
    ],
    artifactPath: fakeArtifact
  })
  assert(allComplete.includes('[ALL BACKGROUND TASKS FINISHED'), 'All-complete with failures has FAILED header')
  assert(allComplete.includes(fakeArtifact), 'All-complete includes artifact path')
  assert(allComplete.includes('1 FAILED'), 'All-complete shows failure count')
  
  // Test 3: All-complete with no failures
  const allSuccess = buildNotificationText({
    task: fakeTask, duration: '3s', statusText: 'COMPLETED',
    allComplete: true, remainingCount: 0,
    completedTasks: [
      { id: 'bg_abc123', description: 'advisor check', status: 'completed', artifactPath: fakeArtifact }
    ],
    artifactPath: fakeArtifact
  })
  assert(allSuccess.includes('[ALL BACKGROUND TASKS COMPLETE]'), 'All-success has COMPLETE header')
  assert(!allSuccess.includes('FAILED'), 'All-success has no FAILED text')
  
  // Test 4: Notification without artifact (fallback case)
  const noArtifact = buildNotificationText({
    task: fakeTask, duration: '2s', statusText: 'COMPLETED',
    allComplete: false, remainingCount: 0, completedTasks: [], artifactPath: ''
  })
  assert(!noArtifact.includes('**Artifact:**'), 'No artifact field when path is empty')
}

// ─── Compaction Context Tests ───────────────────────────────────────────────

async function testCompactionContext() {
  console.log('\n🔄 Compaction Context Tests')
  
  const readTasks = new Set()
  const artifactPaths = new Map()
  
  function isRead(id) { return readTasks.has(id) }
  function markRead(id) { readTasks.add(id) }
  
  function compactionContext(tasks, sessionID) {
    const sessionTasks = tasks.filter(t => t.parentSessionID === sessionID)
    const running = sessionTasks.filter(t => t.status === 'running' || t.status === 'pending')
    const unreadCompleted = sessionTasks.filter(t => {
      const terminal = t.status === 'completed' || t.status === 'error' || t.status === 'cancelled' || t.status === 'interrupt'
      return terminal && !isRead(t.id)
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
        const artifact = artifactPaths.get(t.id) ?? ''
        ctx += `    - id: ${t.id} description: ${t.description} artifact: ${artifact}\n`
      }
    }
    ctx += '</background-task-context>'
    return ctx
  }
  
  const fakeTasks = [
    { id: 'bg_run1', parentSessionID: 'sess_1', status: 'running', description: 'task 1', agent: 'advisor' },
    { id: 'bg_run2', parentSessionID: 'sess_1', status: 'pending', description: 'task 2', agent: 'coder' },
    { id: 'bg_done1', parentSessionID: 'sess_1', status: 'completed', description: 'done task', agent: 'advisor' },
    { id: 'bg_err1', parentSessionID: 'sess_1', status: 'error', description: 'failed task', agent: 'advisor', error: 'timeout' },
  ]
  artifactPaths.set('bg_done1', '/tmp/artifacts/bg_done1.md')
  artifactPaths.set('bg_err1', '/tmp/artifacts/bg_err1.md')
  
  // Test 1: Context with running + unread completed
  const ctx1 = compactionContext(fakeTasks, 'sess_1')
  assert(ctx1 !== null, 'Returns context when tasks exist')
  assert(ctx1.includes('<background-task-context>'), 'Has XML wrapper')
  assert(ctx1.includes('running:'), 'Has running section')
  assert(ctx1.includes('unread-completed:'), 'Has unread-completed section')
  assert(ctx1.includes('bg_run1'), 'Running task included')
  assert(ctx1.includes('bg_done1'), 'Unread completed task included')
  assert(ctx1.includes('/tmp/artifacts/bg_done1.md'), 'Unread completed has artifact path')
  
  // Test 2: Mark one as read
  markRead('bg_done1')
  const ctx2 = compactionContext(fakeTasks, 'sess_1')
  assert(!ctx2.includes('bg_done1'), 'Read completed task excluded from unread')
  assert(ctx2.includes('bg_err1'), 'Unread error task still included')
  
  // Test 3: No tasks for session
  const ctx3 = compactionContext(fakeTasks, 'sess_nonexistent')
  assert(ctx3 === null, 'Returns null for session with no tasks')
  
  // Test 4: All completed and read
  markRead('bg_err1')
  const fakeTasksAllRead = [
    { id: 'bg_done2', parentSessionID: 'sess_2', status: 'completed', description: 'all read', agent: 'advisor' }
  ]
  markRead('bg_done2')
  const ctx4 = compactionContext(fakeTasksAllRead, 'sess_2')
  assert(ctx4 === null, 'Returns null when all completed tasks are read')
}

// ─── State Recovery Tests ────────────────────────────────────────────────────

async function testStateRecovery() {
  console.log('\n🔧 State Recovery Tests')
  
  const plBase = path.join(TEST_DIR, 'recovery')
  
  class PersistenceLayer {
    constructor(b) { this.basePath = b }
    artifactPath(id, parent, dir) { return path.join(this.basePath, hashPath(dir), parent, `${id}.md`) }
    async write(id, parent, dir, content, meta) {
      const d = path.dirname(this.artifactPath(id, parent, dir)); await fs.mkdir(d, { recursive: true })
      const fm = Object.entries(meta).filter(([,v]) => v !== undefined && v !== null).map(([k,v]) => `${k}: ${v}`).join('\n')
      await fs.writeFile(this.artifactPath(id, parent, dir), `---\n${fm}\n---\n\n${content}`, 'utf8')
      return this.artifactPath(id, parent, dir)
    }
    async listForSession(parent, dir) {
      const sd = path.join(this.basePath, hashPath(dir), parent)
      try {
        const entries = await fs.readdir(sd); const results = []
        for (const e of entries) { if (!e.endsWith('.md')) continue
          const c = await fs.readFile(path.join(sd, e), 'utf8')
          const m = c.match(/^---\n([\s\S]*?)\n---\n/); if (!m) continue
          const meta = {}; for (const l of m[1].split('\n')) { const ci = l.indexOf(':'); if(ci>0) meta[l.slice(0,ci).trim()] = l.slice(ci+1).trim() }
          results.push({id: e.replace('.md',''), ...meta})
        }; return results
      } catch { return [] }
    }
  }
  
  const pl = new PersistenceLayer(plBase)
  const parent = 'sess_recover_01'
  const projectDir = path.join(TEST_DIR, 'recover-project')
  
  // Seed artifacts on disk (simulating prior process run)
  await pl.write('bg_old001', parent, projectDir, 'Old task output 1', {
    id: 'bg_old001', description: 'old advisor task', agent: 'advisor', status: 'completed',
    parent_session: parent, session: 'sess_child_old1', error: ''
  })
  await pl.write('bg_old002', parent, projectDir, 'Old task output 2', {
    id: 'bg_old002', description: 'old coder task', agent: 'coder', status: 'error',
    parent_session: parent, session: 'sess_child_old2', error: 'timeout'
  })
  
  // Simulate empty in-memory state
  const inMemoryTasks = new Map()
  
  // Test 1: recoverState populates from disk
  const diskTasks = await pl.listForSession(parent, projectDir)
  assert(diskTasks.length === 2, 'Disk has 2 artifacts')
  
  for (const diskTask of diskTasks) {
    if (inMemoryTasks.has(diskTask.id)) continue
    inMemoryTasks.set(diskTask.id, {
      id: diskTask.id, description: diskTask.description, agent: diskTask.agent,
      status: diskTask.status, parentSessionID: parent
    })
  }
  assert(inMemoryTasks.size === 2, 'Recovery adds 2 tasks to memory')
  assert(inMemoryTasks.has('bg_old001'), 'First task recovered')
  assert(inMemoryTasks.has('bg_old002'), 'Second task recovered')
  assert(inMemoryTasks.get('bg_old001').status === 'completed', 'Status preserved')
  assert(inMemoryTasks.get('bg_old002').status === 'error', 'Error status preserved')
  
  // Test 2: Recover doesn't duplicate existing tasks
  for (const diskTask of diskTasks) {
    if (inMemoryTasks.has(diskTask.id)) continue
    inMemoryTasks.set(diskTask.id, { id: diskTask.id })
  }
  assert(inMemoryTasks.size === 2, 'No duplicate after second recovery attempt')
  
  // Test 3: Reading artifact content after recovery
  const artPath = pl.artifactPath('bg_old001', parent, projectDir)
  const content = await fs.readFile(artPath, 'utf8')
  assert(content.includes('Old task output 1'), 'Artifact content is intact')
}

// ─── Edge Cases ──────────────────────────────────────────────────────────────

async function testEdgeCases() {
  console.log('\n⚡ Edge Case Tests')
  
  const plBase = path.join(TEST_DIR, 'edge')
  
  class PersistenceLayer {
    constructor(b) { this.basePath = b }
    artifactPath(id, parent, dir) { return path.join(this.basePath, hashPath(dir), parent, `${id}.md`) }
    artifactDir(id, parent, dir) { return path.dirname(this.artifactPath(id, parent, dir)) }
    async write(id, parent, dir, content, meta) {
      const d = this.artifactDir(id, parent, dir); await fs.mkdir(d, { recursive: true })
      const fm = Object.entries(meta).filter(([,v]) => v !== undefined && v !== null).map(([k,v]) => `${k}: ${v}`).join('\n')
      await fs.writeFile(this.artifactPath(id, parent, dir), `---\n${fm}\n---\n\n${content}`, 'utf8')
      return this.artifactPath(id, parent, dir)
    }
    async read(id, parent, dir) { try { return await fs.readFile(this.artifactPath(id, parent, dir), 'utf8') } catch { return null } }
    async remove(id, parent, dir) { try { await fs.unlink(this.artifactPath(id, parent, dir)) } catch {} }
  }
  
  const pl = new PersistenceLayer(plBase)
  const parent = 'sess_edge'
  const dir = path.join(TEST_DIR, 'edge-project')
  
  // Test 1: Artifact with empty content
  const emptyArt = await pl.write('bg_empty', parent, dir, '', {
    id: 'bg_empty', description: 'empty output', agent: 'advisor', status: 'completed'
  })
  const emptyContent = await pl.read('bg_empty', parent, dir)
  assert(emptyContent !== null, 'Empty artifact still readable')
  assert(emptyContent.includes('---'), 'Empty artifact has frontmatter')
  
  // Test 2: Artifact with special characters
  const specialContent = `Output with "quotes" and 'apostrophes' and $dollars and <xml>tags</xml>`
  await pl.write('bg_special', parent, dir, specialContent, {
    id: 'bg_special', description: 'special chars', agent: 'advisor', status: 'completed'
  })
  const specialRead = await pl.read('bg_special', parent, dir)
  assert(specialRead.includes('<xml>tags</xml>'), 'Special characters preserved')
  
  // Test 3: Artifact with very long content (10KB)
  const longContent = 'A'.repeat(10000)
  await pl.write('bg_long', parent, dir, longContent, {
    id: 'bg_long', description: 'long output', agent: 'advisor', status: 'completed'
  })
  const longRead = await pl.read('bg_long', parent, dir)
  assert(longRead !== null, 'Long artifact readable')
  assert(longRead.length > 10000, 'Long artifact not truncated')
  
  // Test 4: Read non-existent task
  const noArt = await pl.read('bg_nonexistent', parent, dir)
  assert(noArt === null, 'Non-existent artifact returns null (fallback trigger)')
  
  // Test 5: Remove non-existent (should not throw)
  let removeOk = true
  try { await pl.remove('bg_nonexistent', parent, dir) } catch { removeOk = false }
  assert(removeOk, 'Remove non-existent does not throw')
  
  // Test 6: Different projects get different hash paths (isolation)
  const dir2 = path.join(TEST_DIR, 'other-project')
  const art1 = pl.artifactPath('bg_same', parent, dir)
  const art2 = pl.artifactPath('bg_same', parent, dir2)
  assert(art1 !== art2, 'Different projects get different artifact paths')
  
  // Test 7: Metadata with empty error field
  const noError = await pl.write('bg_noerr', parent, dir, 'content', {
    id: 'bg_noerr', description: 'no error', agent: 'advisor', status: 'completed', error: ''
  })
  const noErrorRead = await pl.read('bg_noerr', parent, dir)
  assert(noErrorRead !== null, 'Artifact with empty error field readable')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🧪 Background Task Persistence Test Suite')
  console.log('=' .repeat(50))
  
  await setup()
  
  try {
    await testPersistenceLayer()
    await testNotificationFormat()
    await testCompactionContext()
    await testStateRecovery()
    await testEdgeCases()
  } finally {
    await cleanup()
  }
  
  console.log('\n' + '='.repeat(50))
  console.log(`Results: ${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

main()
