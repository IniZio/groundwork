import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { captureFileSnapshot, diffFileSnapshots, formatFileChanges } from '../../src/lib/snapshot.js'
import { formatTranscript, HANDOFF_COMMAND } from '../../src/lib/handoff.js'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ─── captureFileSnapshot ─────────────────────────────────────────────────

describe('captureFileSnapshot', () => {
  let tmpDir: string

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'gw-snap-'))
  })

  afterAll(async () => {
    try { await rm(tmpDir, { recursive: true }) } catch {}
  })

  test('empty directory', async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), 'gw-empty-'))
    try {
      const snap = await captureFileSnapshot(emptyDir) as any
      expect(snap.files).toHaveLength(0)
    } finally {
      await rm(emptyDir, { recursive: true })
    }
  })

  test('finds files in directory', async () => {
    await writeFile(join(tmpDir, 'a.ts'), 'content a')
    await writeFile(join(tmpDir, 'b.ts'), 'content b that is longer')
    const snap = await captureFileSnapshot(tmpDir) as any
    expect(snap.files.length).toBeGreaterThanOrEqual(2)
    const paths = snap.files.map((f: any) => f.path)
    expect(paths).toContain('a.ts')
    expect(paths).toContain('b.ts')
  })

  test('files have correct metadata', async () => {
    await writeFile(join(tmpDir, 'meta-test.txt'), 'hello world')
    const snap = await captureFileSnapshot(tmpDir) as any
    const file = snap.files.find((f: any) => f.path === 'meta-test.txt')
    expect(file).toBeDefined()
    expect(file.size).toBe(11) // 'hello world'.length
    expect(file.mtime).toBeDefined()
  })

  test('finds nested directories', async () => {
    const nestedDir = join(tmpDir, 'sub', 'deep')
    await mkdir(nestedDir, { recursive: true })
    await writeFile(join(nestedDir, 'nested.txt'), 'deep content')
    const snap = await captureFileSnapshot(tmpDir) as any
    const paths = snap.files.map((f: any) => f.path)
    expect(paths.some((p: string) => p.includes('nested.txt'))).toBe(true)
  })

  test('respects maxDepth limit', async () => {
    // Create dir at depth 3: tmpDir/l1/l2/l3/deep.txt
    const deepDir = join(tmpDir, 'depth-l1', 'depth-l2', 'depth-l3')
    await mkdir(deepDir, { recursive: true })
    await writeFile(join(deepDir, 'deep.txt'), 'very deep')

    // maxDepth=2 should NOT find files at depth 3
    const snap2 = await captureFileSnapshot(tmpDir, 2) as any
    const paths2 = snap2.files.map((f: any) => f.path)
    expect(paths2.some((p: string) => p.includes('deep.txt'))).toBe(false)

    // maxDepth=3 SHOULD find them
    const snap3 = await captureFileSnapshot(tmpDir, 3) as any
    const paths3 = snap3.files.map((f: any) => f.path)
    expect(paths3.some((p: string) => p.includes('deep.txt'))).toBe(true)
  })

  test('skips hidden files', async () => {
    await writeFile(join(tmpDir, '.hidden'), 'secret')
    const snap = await captureFileSnapshot(tmpDir) as any
    const paths = snap.files.map((f: any) => f.path)
    expect(paths).not.toContain('.hidden')
  })

  test('skips node_modules', async () => {
    const nmDir = join(tmpDir, 'node_modules', 'pkg')
    await mkdir(nmDir, { recursive: true })
    await writeFile(join(nmDir, 'index.js'), 'module.exports = {}')
    const snap = await captureFileSnapshot(tmpDir) as any
    const paths = snap.files.map((f: any) => f.path)
    expect(paths.some((p: string) => p.includes('node_modules'))).toBe(false)
  })
})

// ─── formatTranscript ─────────────────────────────────────────────────────

describe('formatTranscript', () => {
  test('formats user message', () => {
    const msgs = [{ info: { role: 'user' }, parts: [{ type: 'text', text: 'hello' }] }]
    const result = formatTranscript(msgs)
    expect(result).toContain('## User')
    expect(result).toContain('hello')
  })

  test('formats assistant message', () => {
    const msgs = [{ info: { role: 'assistant' }, parts: [{ type: 'text', text: 'response text' }] }]
    const result = formatTranscript(msgs)
    expect(result).toContain('## Assistant')
    expect(result).toContain('response text')
  })

  test('formats tool call with completed status', () => {
    const msgs = [{ info: { role: 'assistant' }, parts: [{ type: 'tool', tool: 'read', state: { status: 'completed', title: 'read file.ts' } }] }]
    const result = formatTranscript(msgs)
    expect(result).toContain('[Tool: read] read file.ts')
  })

  test('formats file attachment', () => {
    const msgs = [{ info: { role: 'user' }, parts: [{ type: 'file', filename: 'test.ts' }] }]
    const result = formatTranscript(msgs)
    expect(result).toContain('[Attached: test.ts]')
  })

  test('ignores parts with ignored=true', () => {
    const msgs = [{ info: { role: 'user' }, parts: [{ type: 'text', text: 'hidden', ignored: true }] }]
    const result = formatTranscript(msgs)
    expect(result).not.toContain('hidden')
  })

  test('shows limit message when at limit', () => {
    const msgs = Array.from({ length: 5 }, (_, i) => ({
      info: { role: 'user' as const },
      parts: [{ type: 'text', text: `msg ${i}` }]
    }))
    const result = formatTranscript(msgs, 5)
    expect(result).toContain('Showing 5 most recent')
  })

  test('shows end of session when under limit', () => {
    const msgs = [{ info: { role: 'user' }, parts: [{ type: 'text', text: 'hi' }] }]
    const result = formatTranscript(msgs, 100)
    expect(result).toContain('End of session')
    expect(result).toContain('1 messages')
  })

  test('empty messages shows end of session', () => {
    const result = formatTranscript([])
    expect(result).toContain('End of session')
    expect(result).toContain('0 messages')
  })

  test('multiple message types', () => {
    const msgs = [
      { info: { role: 'user' }, parts: [{ type: 'text', text: 'question' }] },
      { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'answer' }, { type: 'tool', tool: 'write', state: { status: 'completed', title: 'wrote file' } }] }
    ]
    const result = formatTranscript(msgs)
    expect(result).toContain('## User')
    expect(result).toContain('question')
    expect(result).toContain('## Assistant')
    expect(result).toContain('answer')
    expect(result).toContain('[Tool: write] wrote file')
  })
})

// ─── HANDOFF_COMMAND ─────────────────────────────────────────────────────

describe('HANDOFF_COMMAND', () => {
  test('starts with GOAL:', () => {
    expect(HANDOFF_COMMAND.startsWith('GOAL:')).toBe(true)
  })

  test('contains $ARGUMENTS placeholder', () => {
    expect(HANDOFF_COMMAND).toContain('$ARGUMENTS')
  })

  test('contains handoff_session instruction', () => {
    expect(HANDOFF_COMMAND).toContain('handoff_session')
  })

  test('references file loading', () => {
    expect(HANDOFF_COMMAND).toContain('file')
  })
})
