import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { ConcurrencyManager } from '../src/lib/concurrency.js'
import { PersistenceLayer } from '../src/lib/persistence.js'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ─── ConcurrencyManager ──────────────────────────────────────────────────

describe('ConcurrencyManager', () => {
  test('basic acquire and release', () => {
    const cm = new ConcurrencyManager(5)
    cm.acquire('key')
    expect(cm.getCount('key')).toBe(1)
    cm.release('key')
    expect(cm.getCount('key')).toBe(0)
  })

  test('multiple keys are independent', async () => {
    const cm = new ConcurrencyManager(5)
    await cm.acquire('a')
    await cm.acquire('b')
    expect(cm.getCount('a')).toBe(1)
    expect(cm.getCount('b')).toBe(1)
    cm.release('a')
    expect(cm.getCount('a')).toBe(0)
    expect(cm.getCount('b')).toBe(1)
    cm.release('b')
  })

  test('limit enforcement blocks at limit', async () => {
    const cm = new ConcurrencyManager(2)
    await cm.acquire('key')
    await cm.acquire('key')
    expect(cm.getCount('key')).toBe(2)

    // Third acquire should not resolve immediately
    let resolved = false
    const p = cm.acquire('key').then(() => { resolved = true })

    // Give it a tick to potentially resolve
    await new Promise(r => setTimeout(r, 50))
    expect(resolved).toBe(false)

    // Release one slot
    cm.release('key')
    await p
    expect(resolved).toBe(true)
    expect(cm.getCount('key')).toBe(2) // still 2 (release decremented, but queued acquire incremented)
  })

  test('queue ordering is FIFO', async () => {
    const cm = new ConcurrencyManager(1)
    await cm.acquire('key') // fills the slot

    const order: number[] = []
    const p1 = cm.acquire('key').then(() => order.push(1))
    const p2 = cm.acquire('key').then(() => order.push(2))
    const p3 = cm.acquire('key').then(() => order.push(3))

    // Release all one by one
    cm.release('key')
    await new Promise(r => setTimeout(r, 20))
    cm.release('key')
    await new Promise(r => setTimeout(r, 20))
    cm.release('key')

    await Promise.all([p1, p2, p3])
    expect(order).toEqual([1, 2, 3])
  })

  test('Infinity limit allows all without tracking', async () => {
    const cm = new ConcurrencyManager(Infinity)
    // Infinity limit returns early from acquire/release without incrementing counts
    for (let i = 0; i < 100; i++) {
      await cm.acquire('key')
    }
    // Count stays 0 because Infinity means no tracking needed
    expect(cm.getCount('key')).toBe(0)
  })

  test('clear rejects pending queues', async () => {
    const cm = new ConcurrencyManager(1)
    await cm.acquire('key') // fills the slot

    let rejected = false
    const p = cm.acquire('key').catch((err: Error) => {
      rejected = true
      expect(err.message).toContain('cancelled')
    })

    cm.clear()
    await p
    expect(rejected).toBe(true)
    expect(cm.getCount('key')).toBe(0)
  })

  test('getCount for unknown key returns 0', () => {
    const cm = new ConcurrencyManager(5)
    expect(cm.getCount('unknown')).toBe(0)
  })

  test('limit getter returns configured limit', () => {
    const cm = new ConcurrencyManager(10)
    expect(cm.limit).toBe(10)
  })

  test('release below zero stays at zero', async () => {
    const cm = new ConcurrencyManager(5)
    cm.release('key') // never acquired
    expect(cm.getCount('key')).toBe(0)
  })

  test('double release stays at zero', async () => {
    const cm = new ConcurrencyManager(5)
    await cm.acquire('key')
    expect(cm.getCount('key')).toBe(1)
    cm.release('key')
    expect(cm.getCount('key')).toBe(0)
    cm.release('key') // second release
    expect(cm.getCount('key')).toBe(0)
  })
})

// ─── PersistenceLayer ─────────────────────────────────────────────────────

describe('PersistenceLayer', () => {
  let tmpDir: string
  const pl = new PersistenceLayer()

  // Create temp dir before tests
  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'gw-test-'))
  })

  // Clean up after all tests
  afterAll(async () => {
    try { await rm(tmpDir, { recursive: true }) } catch {}
  })

  test('write + read cycle', async () => {
    await pl.write('task-1', 'sess-1', tmpDir, 'task result content', {
      id: 'task-1',
      status: 'completed',
      agent: 'coder'
    })
    const content = await pl.read('task-1', 'sess-1', tmpDir)
    expect(content).not.toBeNull()
    expect(content!).toContain('task result content')
    expect(content!).toContain('id: task-1')
    expect(content!).toContain('status: completed')
    expect(content!).toContain('agent: coder')
  })

  test('read nonexistent returns null', async () => {
    const result = await pl.read('nonexistent', 'sess-1', tmpDir)
    expect(result).toBeNull()
  })

  test('remove deletes persisted file', async () => {
    await pl.write('task-2', 'sess-1', tmpDir, 'to be removed', { id: 'task-2' })
    const before = await pl.read('task-2', 'sess-1', tmpDir)
    expect(before).not.toBeNull()

    await pl.remove('task-2', 'sess-1', tmpDir)
    const after = await pl.read('task-2', 'sess-1', tmpDir)
    expect(after).toBeNull()
  })

  test('listForSession returns all tasks', async () => {
    await pl.write('list-1', 'sess-list', tmpDir, 'content 1', { id: 'list-1', status: 'completed' })
    await pl.write('list-2', 'sess-list', tmpDir, 'content 2', { id: 'list-2', status: 'failed' })
    await pl.write('list-3', 'sess-list', tmpDir, 'content 3', { id: 'list-3', status: 'running' })

    const results = await pl.listForSession('sess-list', tmpDir)
    expect(results).toHaveLength(3)

    const ids = results.map(r => r.id).sort()
    expect(ids).toEqual(['list-1', 'list-2', 'list-3'])

    // Verify metadata is parsed
    const task1 = results.find(r => r.id === 'list-1')
    expect(task1?.status).toBe('completed')
  })

  test('listForSession empty for nonexistent', async () => {
    const results = await pl.listForSession('nonexistent-session', tmpDir)
    expect(results).toEqual([])
  })

  test('readMeta finds task across sessions', async () => {
    await pl.write('meta-1', 'sess-meta', tmpDir, 'meta content', { id: 'meta-1', agent: 'coder' })
    const meta = await pl.readMeta('meta-1', tmpDir)
    expect(meta).not.toBeNull()
    expect(meta!.id).toBe('meta-1')
    expect(meta!.agent).toBe('coder')
  })

  test('readMeta returns null for nonexistent', async () => {
    const meta = await pl.readMeta('nonexistent-task', tmpDir)
    expect(meta).toBeNull()
  })

  test('frontmatter filters undefined/null values', async () => {
    await pl.write('filter-1', 'sess-filter', tmpDir, 'content', {
      id: 'filter-1',
      status: 'completed',
      error: undefined,
      description: null,
      agent: 'explore'
    })
    const content = await pl.read('filter-1', 'sess-filter', tmpDir)
    expect(content).not.toBeNull()
    expect(content!).toContain('id: filter-1')
    expect(content!).toContain('agent: explore')
    // error and description should NOT be in frontmatter
    expect(content!).not.toContain('error:')
    expect(content!).not.toContain('description:')
  })

  test('artifactPath constructs correct path', () => {
    const result = pl.artifactPath('task-99', 'sess-99', '/workspace')
    expect(result).toBe('/workspace/.opencode/background-tasks/sess-99/task-99.md')
  })

  test('remove nonexistent does not throw', async () => {
    // Should not throw
    await pl.remove('nonexistent-task', 'nonexistent-session', tmpDir)
  })
})
