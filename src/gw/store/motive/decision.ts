import { DecisionSchema, motiveDecisionPath } from '../../schema/index.js'
import { wikilink } from '../../fm/index.js'
import matter from 'gray-matter'
import { readFile, writeFile } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

// Input shape for writing a decision note
interface DecisionNoteData {
  id: string
  decision: string
  rationale: string
  alternatives: string[]
  status?: 'proposed' | 'accepted' | 'deprecated' | 'superseded'
  kind?: string
  date?: string
  supersedes?: string
  related?: string[]
  motive?: string
  /** Non-canonical fields from the journal event (e.g. resolves, rfc, blast, retires, …).
   *  Written verbatim into frontmatter so they survive a round-trip through read/compile.
   *  Any key already written as a canonical field is silently skipped. */
  extras?: Record<string, unknown>
}

// Read shape
interface DecisionNote {
  fm: Record<string, unknown>
  body: string
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
  if (data.kind !== undefined) fm.kind = data.kind
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
    if (data.motive.startsWith('[[')) {
      fm.motive = data.motive
    } else {
      // Build a path-qualified wikilink that resolves unambiguously when the vault root is
      // .groundwork/ — stem-only [[motive]] is ambiguous (every motive dir has motive.md);
      // [[motives/<slug>/motive|<slug>]] resolves to the exact motive.md via vault-relative path.
      fm.motive = wikilink(`motives/${data.motive}/motive`, data.motive)
    }
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

  if (data.extras) {
    for (const [k, v] of Object.entries(data.extras)) {
      if (!(k in fm)) fm[k] = v
    }
  }

  const dest = motiveDecisionPath(repoRoot, tracker, motive, normalizedId)
  mkdirSync(path.dirname(dest), { recursive: true })
  await writeFile(dest, matter.stringify(body, fm), 'utf8')
}

const CANONICAL_DATA_KEYS = new Set(['id', 'decision', 'rationale', 'alternatives', 'status', 'kind'])

export function fromLegacyDecision(event: {
  ts: string
  motive?: string
  data?: Record<string, unknown>
  rfc?: string
}): DecisionNoteData {
  const d = event.data ?? {}
  const id = String(d.id ?? '')
  const date = event.ts ? event.ts.slice(0, 10) : undefined
  const alternatives = Array.isArray(d.alternatives) ? d.alternatives.map(String) : []
  const status = (d.status as 'proposed' | 'accepted' | 'deprecated' | 'superseded' | undefined) ?? 'proposed'
  const kind = d.kind !== undefined ? String(d.kind) : undefined

  const extras: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(d)) {
    if (!CANONICAL_DATA_KEYS.has(k)) extras[k] = v
  }
  if (event.rfc !== undefined && !('rfc' in extras)) extras.rfc = event.rfc

  return {
    id,
    decision: String(d.decision ?? ''),
    rationale: String(d.rationale ?? ''),
    alternatives,
    status,
    kind,
    date,
    motive: event.motive,
    extras: Object.keys(extras).length > 0 ? extras : undefined,
  }
}
