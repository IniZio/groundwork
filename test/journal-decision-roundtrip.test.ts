import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, test, expect, afterAll } from 'vitest'
import { run } from '../src/gw/cli/commands/journal.js'

const MOTIVE = 'test-roundtrip'

function makeProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'gw-decision-rt-'))
  mkdirSync(path.join(dir, '.groundwork', 'motives', MOTIVE, 'decisions'), { recursive: true })
  const decisionMd = [
    '---',
    'id: D-TEST',
    'status: accepted',
    'date: \'2026-01-01\'',
    'rationale: Test rationale text',
    'alternatives:',
    '  - Option A',
    '  - Option B',
    'kind: architecture',
    'motive: \'[[test-roundtrip]]\'',
    '---',
    '## Decision',
    '',
    'Use the new approach.',
  ].join('\n')
  writeFileSync(path.join(dir, '.groundwork', 'motives', MOTIVE, 'decisions', 'D-TEST.md'), decisionMd)
  return dir
}

const dirs: string[] = []
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })

describe('decision markdown round-trip through gw journal compile', () => {
  test('alternatives, kind, and status survive readMotiveDecisionEvents', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    process.env['CLAUDE_PROJECT_DIR'] = projectDir

    const envelope = await run(['compile', MOTIVE, '--json'], projectDir)

    expect(envelope.ok, JSON.stringify(envelope)).toBe(true)
    if (!envelope.ok) throw new Error('envelope not ok')
    const content = (envelope.data as Record<string, unknown>)['content'] as string
    const parsed = JSON.parse(content) as { decisions?: Array<Record<string, unknown>> }
    const decisions = parsed.decisions ?? []
    expect(decisions.length).toBeGreaterThan(0)

    const d = decisions.find(x => x['id'] === 'D-TEST')
    expect(d, 'D-TEST not found in compiled decisions').toBeDefined()

    expect(d!['status']).toBe('accepted')
    expect(d!['rationale']).toContain('Test rationale text')
    expect(d!['alternatives']).toEqual(['Option A', 'Option B'])
    expect(d!['kind']).toBe('architecture')
  })

  test('missing status defaults to proposed', async () => {
    const projectDir = makeProject()
    dirs.push(projectDir)
    process.env['CLAUDE_PROJECT_DIR'] = projectDir

    const noStatusMd = [
      '---',
      'id: D-NOSTATUS',
      'date: \'2026-01-02\'',
      '---',
      'No status field.',
    ].join('\n')
    writeFileSync(
      path.join(projectDir, '.groundwork', 'motives', MOTIVE, 'decisions', 'D-NOSTATUS.md'),
      noStatusMd,
    )

    const envelope = await run(['compile', MOTIVE, '--json'], projectDir)

    expect(envelope.ok, JSON.stringify(envelope)).toBe(true)
    if (!envelope.ok) throw new Error('envelope not ok')
    const content = (envelope.data as Record<string, unknown>)['content'] as string
    const parsed = JSON.parse(content) as { decisions?: Array<Record<string, unknown>> }
    const d = (parsed.decisions ?? []).find(x => x['id'] === 'D-NOSTATUS')
    expect(d, 'D-NOSTATUS not found').toBeDefined()
    expect(d!['status']).toBe('proposed')
  })
})
