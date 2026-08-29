import { wikilink } from '../../fm/index.js'
import matter from 'gray-matter'
import { readFile, writeFile } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

// Plain interface — NOT a Zod schema
export interface OpenItemFm {
  id: string
  kind: 'TBD' | 'TBR'
  status: 'open' | 'resolved'
  resolved_by?: string
  refs?: string[]
  motive?: string
}

export interface OpenItemNote {
  fm: OpenItemFm
  body: string
}

export function openItemPath(
  repoRoot: string,
  tracker: string,
  motive: string,
  id: string,
): string {
  return path.join(repoRoot, tracker, 'motives', motive, 'open-items', `${id}.md`)
}

export async function readOpenItem(opts: {
  repoRoot: string
  tracker: string
  motive: string
  id: string
}): Promise<OpenItemNote> {
  const filePath = openItemPath(opts.repoRoot, opts.tracker, opts.motive, opts.id)
  const raw = await readFile(filePath, 'utf8')
  const { data, content } = matter(raw)
  return { fm: data as OpenItemFm, body: content }
}

export async function writeOpenItem(opts: {
  repoRoot: string
  tracker: string
  motive: string
  fm: OpenItemFm
  body: string
}): Promise<void> {
  const dest = openItemPath(opts.repoRoot, opts.tracker, opts.motive, opts.fm.id)
  mkdirSync(path.dirname(dest), { recursive: true })
  await writeFile(dest, matter.stringify(opts.body, opts.fm as unknown as Record<string, unknown>), 'utf8')
}

/** Normalize a raw ref string (e.g. "D8", "D-8") to a wikilink "[[D-8]]" */
function normalizeRef(ref: string): string {
  const trimmed = ref.trim()
  if (trimmed.startsWith('[[')) return trimmed
  // Legacy D1..D8 → D-n
  const legacy = /^D(\d+)$/.exec(trimmed)
  if (legacy) return wikilink(`D-${legacy[1]}`)
  // Canonical D-n
  if (/^D-\d+$/.test(trimmed)) return wikilink(trimmed)
  return wikilink(trimmed)
}

/**
 * Parse TBD/TBR bullets from the "## Open items" section of a charter string.
 * Returns one OpenItemNote per valid TBD/TBR bullet found.
 */
export function fromLegacyOpenItems(charterRaw: string, motiveSlug?: string): OpenItemNote[] {
  // Split on ## headings; find the Open items section
  const parts = charterRaw.split(/^## /m)
  const openPart = parts.find(p => /^Open items/i.test(p))
  if (!openPart) return []

  // Strip the heading line
  const sectionBody = openPart.replace(/^[^\n]+\n/, '')
  const lines = sectionBody.split('\n')

  const notes: OpenItemNote[] = []
  let current: { id: string; statement: string; refs: string[] } | null = null

  const flushCurrent = () => {
    if (!current) return
    const kind: 'TBD' | 'TBR' = /^TBR/i.test(current.id) ? 'TBR' : 'TBD'
    const fm: OpenItemFm = {
      id: current.id,
      kind,
      status: 'open',
    }
    if (current.refs.length > 0) {
      fm.refs = current.refs.map(normalizeRef)
    }
    if (motiveSlug !== undefined) {
      fm.motive = wikilink(motiveSlug)
    }
    notes.push({ fm, body: current.statement })
    current = null
  }

  for (const line of lines) {
    const bulletMatch = /^- ((?:TBD|TBR)-\S+): (.+)/i.exec(line)
    if (bulletMatch) {
      flushCurrent()
      current = { id: bulletMatch[1], statement: bulletMatch[2], refs: [] }
      continue
    }
    if (current) {
      const refsMatch = /^\s+refs:\s*(.+)/.exec(line)
      if (refsMatch) {
        const refParts = refsMatch[1].split(/[,\s]+/).filter(Boolean)
        current.refs.push(...refParts)
      }
    }
  }
  flushCurrent()

  return notes
}
