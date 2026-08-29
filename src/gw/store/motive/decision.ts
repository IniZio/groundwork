import { DecisionSchema, motiveDecisionPath } from '../../schema/index.js'
import { wikilink } from '../../fm/index.js'
import matter from 'gray-matter'
import { readFile, writeFile } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

// Input shape for writing a decision note
export interface DecisionNoteData {
  id: string
  decision: string
  rationale: string
  alternatives: string[]
  status?: 'proposed' | 'accepted' | 'deprecated' | 'superseded'
  date?: string
  supersedes?: string
  related?: string[]
  motive?: string
}

// Read shape
export interface DecisionNote {
  fm: Record<string, unknown>
  body: string
}

export function decisionNotePath(
  repoRoot: string,
  tracker: string,
  motive: string,
  id: string,
): string {
  return motiveDecisionPath(repoRoot, tracker, motive, id)
}

export async function readDecision(opts: {
  repoRoot: string
  tracker: string
  motive: string
  id: string
}): Promise<DecisionNote> {
  const normalizedId = DecisionSchema.parse({ id: opts.id }).id
  const filePath = motiveDecisionPath(opts.repoRoot, opts.tracker, opts.motive, normalizedId)
  const raw = await readFile(filePath, 'utf8')
  const { data, content } = matter(raw)
  return { fm: data as Record<string, unknown>, body: content }
}

export async function writeDecision(opts: {
  repoRoot: string
  tracker: string
  motive: string
  data: DecisionNoteData
}): Promise<void> {
  const { repoRoot, tracker, motive, data } = opts
  const normalizedId = DecisionSchema.parse({ id: data.id }).id

  const fm: Record<string, unknown> = {
    id: normalizedId,
  }
  if (data.status !== undefined) fm.status = data.status
  if (data.date !== undefined) fm.date = data.date
  fm.rationale = data.rationale
  fm.alternatives = data.alternatives
  if (data.supersedes !== undefined) {
    fm.supersedes = data.supersedes.startsWith('[[') ? data.supersedes : wikilink(data.supersedes)
  }
  if (data.related !== undefined) {
    fm.related = data.related.map(r => (r.startsWith('[[') ? r : wikilink(r)))
  }
  if (data.motive !== undefined) {
    fm.motive = data.motive.startsWith('[[') ? data.motive : wikilink(data.motive)
  }

  const altBullets =
    data.alternatives.length > 0 ? data.alternatives.map(a => `- ${a}`).join('\n') : ''
  const body = [
    '## Decision',
    '',
    data.decision,
    '',
    '## Rationale',
    '',
    data.rationale,
    '',
    '## Alternatives Considered',
    '',
    altBullets,
    '',
  ].join('\n')

  const dest = motiveDecisionPath(repoRoot, tracker, motive, normalizedId)
  mkdirSync(path.dirname(dest), { recursive: true })
  await writeFile(dest, matter.stringify(body, fm), 'utf8')
}

export function fromLegacyDecision(event: {
  ts: string
  motive?: string
  data?: Record<string, unknown>
}): DecisionNoteData {
  const d = event.data ?? {}
  const id = String(d.id ?? '')
  const date = event.ts ? event.ts.slice(0, 10) : undefined
  const alternatives = Array.isArray(d.alternatives) ? d.alternatives.map(String) : []
  return {
    id,
    decision: String(d.decision ?? ''),
    rationale: String(d.rationale ?? ''),
    alternatives,
    status: 'accepted',
    date,
    motive: event.motive,
  }
}
