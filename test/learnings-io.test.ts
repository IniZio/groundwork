/**
 * Unit tests for hooks/lib/learnings-io.mjs — the Learnings KB read/write lib.
 *
 * Framework: vitest (same pattern as signals-and-slug.test.ts).
 * Uses a temp directory as the projectDir for each test.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  resolveLearningPath,
  readLearning,
  upsertLearning,
  listLearnings,
  promoteLearning,
} from '../hooks/lib/learnings-io.mjs'

import {
  toSlug,
} from '../hooks/lib/concept-slug.mjs'

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tmpDir: string

beforeEach(() => {
  tmpDir = path.join(os.tmpdir(), `learnings-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// resolveLearningPath
// ---------------------------------------------------------------------------

describe('resolveLearningPath', () => {
  test('returns path inside .groundwork/learnings/ with slug filename', () => {
    const p = resolveLearningPath(tmpDir, 'Prod Binary Deploy!')
    expect(p).toBe(path.join(tmpDir, '.groundwork', 'learnings', 'prod-binary-deploy.md'))
  })

  test('slugifies via toSlug', () => {
    const concept = 'Retry Loop  '
    const p = resolveLearningPath(tmpDir, concept)
    expect(p).toContain(toSlug(concept) + '.md')
  })
})

// ---------------------------------------------------------------------------
// readLearning — missing / corrupt
// ---------------------------------------------------------------------------

describe('readLearning', () => {
  test('returns null for a missing file', () => {
    expect(readLearning(tmpDir, 'does-not-exist')).toBeNull()
  })

  test('returns null for a corrupt file (no frontmatter fences)', () => {
    const dir = path.join(tmpDir, '.groundwork', 'learnings')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'corrupt.md'), 'this is not valid frontmatter')
    expect(readLearning(tmpDir, 'corrupt')).toBeNull()
  })

  test('returns null for a file with only one --- fence', () => {
    const dir = path.join(tmpDir, '.groundwork', 'learnings')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'half-fence.md'), '---\nconcept: half-fence\n')
    expect(readLearning(tmpDir, 'half-fence')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// upsertLearning — create new entry
// ---------------------------------------------------------------------------

describe('upsertLearning — create', () => {
  test('creates a .md file in .groundwork/learnings/', () => {
    upsertLearning(tmpDir, {
      concept: 'prod-binary-deploy',
      session_id: 'ses_abc',
      detail: 'first encounter',
    })
    const filePath = resolveLearningPath(tmpDir, 'prod-binary-deploy')
    expect(existsSync(filePath)).toBe(true)
  })

  test('new entry has recurrence=1', () => {
    const fm = upsertLearning(tmpDir, {
      concept: 'prod-binary-deploy',
      session_id: 'ses_abc',
      detail: 'first encounter',
    })
    expect(fm.recurrence).toBe(1)
  })

  test('new entry has status LEARNING', () => {
    const fm = upsertLearning(tmpDir, {
      concept: 'prod-binary-deploy',
      session_id: 'ses_abc',
      detail: 'first encounter',
    })
    expect(fm.status).toBe('LEARNING')
  })

  test('new entry has first_learned set to today', () => {
    const fm = upsertLearning(tmpDir, {
      concept: 'prod-binary-deploy',
      session_id: 'ses_abc',
      detail: 'first encounter',
    })
    const todayStr = new Date().toISOString().slice(0, 10)
    expect(fm.first_learned).toBe(todayStr)
  })

  test('frontmatter round-trips through readLearning', () => {
    upsertLearning(tmpDir, {
      concept: 'prod-binary-deploy',
      session_id: 'ses_abc',
      detail: 'pkill killed prod serve',
      procedure: 'Use systemctl instead',
      whyNaiveFails: 'pkill is too broad',
      invalidateWhen: 'Switch to Docker',
    })

    const entry = readLearning(tmpDir, 'prod-binary-deploy')
    expect(entry).not.toBeNull()
    expect(entry!.frontmatter.concept).toBe('prod-binary-deploy')
    expect(entry!.frontmatter.status).toBe('LEARNING')
    expect(entry!.frontmatter.recurrence).toBe(1)
    expect(typeof entry!.frontmatter.recurrence).toBe('number')
    expect(entry!.frontmatter.promoted_to).toBe('')
  })

  test('body contains section headers and procedure text', () => {
    upsertLearning(tmpDir, {
      concept: 'prod-binary-deploy',
      session_id: 'ses_abc',
      detail: 'pkill killed prod serve',
      procedure: 'Use systemctl instead',
    })
    const entry = readLearning(tmpDir, 'prod-binary-deploy')
    expect(entry!.body).toContain('## Distilled procedure')
    expect(entry!.body).toContain('Use systemctl instead')
    expect(entry!.body).toContain('## Recurrence log')
    expect(entry!.body).toContain('pkill killed prod serve')
  })

  test('recurrence log line includes session_id and detail', () => {
    upsertLearning(tmpDir, {
      concept: 'embed-manifest-error',
      session_id: 'ses_xyz',
      detail: 'embed-manifest error on deploy',
    })
    const entry = readLearning(tmpDir, 'embed-manifest-error')
    expect(entry!.body).toContain('ses_xyz')
    expect(entry!.body).toContain('embed-manifest error on deploy')
  })
})

// ---------------------------------------------------------------------------
// upsertLearning — update existing entry
// ---------------------------------------------------------------------------

describe('upsertLearning — update', () => {
  test('upsert same concept twice → recurrence=2', () => {
    upsertLearning(tmpDir, { concept: 'retry-loop', session_id: 'ses_1', detail: 'first' })
    const fm = upsertLearning(tmpDir, { concept: 'retry-loop', session_id: 'ses_2', detail: 'second' })
    expect(fm.recurrence).toBe(2)
  })

  test('upsert same concept twice → two recurrence-log lines', () => {
    upsertLearning(tmpDir, { concept: 'retry-loop', session_id: 'ses_1', detail: 'first occurrence' })
    upsertLearning(tmpDir, { concept: 'retry-loop', session_id: 'ses_2', detail: 'second occurrence' })

    const entry = readLearning(tmpDir, 'retry-loop')
    expect(entry!.body).toContain('ses_1')
    expect(entry!.body).toContain('first occurrence')
    expect(entry!.body).toContain('ses_2')
    expect(entry!.body).toContain('second occurrence')
  })

  test('body sections preserved on second upsert without new text', () => {
    upsertLearning(tmpDir, {
      concept: 'retry-loop',
      session_id: 'ses_1',
      detail: 'first',
      procedure: 'Original procedure text',
    })
    upsertLearning(tmpDir, { concept: 'retry-loop', session_id: 'ses_2', detail: 'second' })

    const entry = readLearning(tmpDir, 'retry-loop')
    expect(entry!.body).toContain('Original procedure text')
  })

  test('body section updated when new procedure text provided on second upsert', () => {
    upsertLearning(tmpDir, {
      concept: 'retry-loop',
      session_id: 'ses_1',
      detail: 'first',
      procedure: 'Old procedure',
    })
    upsertLearning(tmpDir, {
      concept: 'retry-loop',
      session_id: 'ses_2',
      detail: 'second',
      procedure: 'Updated procedure',
    })

    const entry = readLearning(tmpDir, 'retry-loop')
    expect(entry!.body).toContain('Updated procedure')
    expect(entry!.body).not.toContain('Old procedure')
  })
})

// ---------------------------------------------------------------------------
// toSlug deduplication — "Prod Binary Deploy!" and "prod-binary-deploy" → same file
// ---------------------------------------------------------------------------

describe('slug deduplication', () => {
  test('variant concept strings map to the same file', () => {
    const p1 = resolveLearningPath(tmpDir, 'Prod Binary Deploy!')
    const p2 = resolveLearningPath(tmpDir, 'prod-binary-deploy')
    expect(p1).toBe(p2)
  })

  test('upsert with display name then read with slug alias merges correctly', () => {
    upsertLearning(tmpDir, { concept: 'Prod Binary Deploy!', session_id: 'ses_1', detail: 'first' })
    const fm = upsertLearning(tmpDir, { concept: 'prod-binary-deploy', session_id: 'ses_2', detail: 'second' })
    expect(fm.recurrence).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// listLearnings
// ---------------------------------------------------------------------------

describe('listLearnings', () => {
  test('returns empty array when directory does not exist', () => {
    expect(listLearnings(tmpDir)).toEqual([])
  })

  test('returns one entry after one upsert', () => {
    upsertLearning(tmpDir, { concept: 'embed-manifest', session_id: 'ses_1', detail: 'test' })
    const list = listLearnings(tmpDir)
    expect(list).toHaveLength(1)
    expect(list[0].slug).toBe('embed-manifest')
  })

  test('returns all entries', () => {
    upsertLearning(tmpDir, { concept: 'concept-a', session_id: 's1', detail: 'd1' })
    upsertLearning(tmpDir, { concept: 'concept-b', session_id: 's2', detail: 'd2' })
    upsertLearning(tmpDir, { concept: 'concept-c', session_id: 's3', detail: 'd3' })
    const list = listLearnings(tmpDir)
    expect(list).toHaveLength(3)
    const slugs = list.map((e: { slug: string }) => e.slug).sort()
    expect(slugs).toEqual(['concept-a', 'concept-b', 'concept-c'])
  })

  test('each entry includes frontmatter with recurrence as integer', () => {
    upsertLearning(tmpDir, { concept: 'my-concept', session_id: 's1', detail: 'd1' })
    const list = listLearnings(tmpDir)
    expect(list[0].frontmatter.recurrence).toBe(1)
    expect(typeof list[0].frontmatter.recurrence).toBe('number')
  })

  test('skips corrupt files gracefully', () => {
    upsertLearning(tmpDir, { concept: 'good-concept', session_id: 's1', detail: 'ok' })
    const dir = path.join(tmpDir, '.groundwork', 'learnings')
    writeFileSync(path.join(dir, 'corrupt.md'), 'no fences here')
    const list = listLearnings(tmpDir)
    // Only the valid entry is returned
    expect(list).toHaveLength(1)
    expect(list[0].slug).toBe('good-concept')
  })
})

// ---------------------------------------------------------------------------
// promoteLearning
// ---------------------------------------------------------------------------

describe('promoteLearning', () => {
  test('sets status to PROMOTED and records promoted_to path', () => {
    upsertLearning(tmpDir, { concept: 'prod-binary-deploy', session_id: 's1', detail: 'test' })
    const fm = promoteLearning(tmpDir, 'prod-binary-deploy', 'skills/nexus-dev/SKILL.md')!
    expect(fm.status).toBe('PROMOTED')
    expect(fm.promoted_to).toBe('skills/nexus-dev/SKILL.md')
  })

  test('promotion persists on readLearning', () => {
    upsertLearning(tmpDir, { concept: 'prod-binary-deploy', session_id: 's1', detail: 'test' })
    promoteLearning(tmpDir, 'prod-binary-deploy', 'skills/nexus-dev/SKILL.md')
    const entry = readLearning(tmpDir, 'prod-binary-deploy')
    expect(entry!.frontmatter.status).toBe('PROMOTED')
    expect(entry!.frontmatter.promoted_to).toBe('skills/nexus-dev/SKILL.md')
  })

  test('returns null for non-existent entry', () => {
    const result = promoteLearning(tmpDir, 'does-not-exist', 'somewhere/SKILL.md')
    expect(result).toBeNull()
  })

  test('slug alias works for promoteLearning', () => {
    upsertLearning(tmpDir, { concept: 'Prod Binary Deploy!', session_id: 's1', detail: 'test' })
    const fm = promoteLearning(tmpDir, 'prod-binary-deploy', 'skills/deploy/SKILL.md')!
    expect(fm.status).toBe('PROMOTED')
  })

  test('body is preserved after promotion', () => {
    upsertLearning(tmpDir, {
      concept: 'prod-binary-deploy',
      session_id: 's1',
      detail: 'test',
      procedure: 'My important procedure',
    })
    promoteLearning(tmpDir, 'prod-binary-deploy', 'skills/deploy/SKILL.md')
    const entry = readLearning(tmpDir, 'prod-binary-deploy')
    expect(entry!.body).toContain('My important procedure')
  })
})
