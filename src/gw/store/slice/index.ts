/**
 * src/gw/store/slice/index.ts — Slice-as-note store.
 *
 * Reads and writes slice notes as Markdown+YAML-frontmatter files.
 * Wikilink encoding contract:
 *
 *   blocked_by — wikilinks resolve to slice notes in the same motive directory.
 *     Obsidian backlinks show all notes that block or are blocked by a slice.
 *
 *   covers_ac — wikilinks use [[motive#AC-n]] heading anchor format, making the
 *     motive charter the backlink target for AC coverage.
 *
 *   decisions — wikilinks resolve to decision notes in decisions/ subfolder.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import matter from 'gray-matter'
import { SliceSchema, type Slice, sliceNotePath, motiveDir } from '../../schema/index.js'
import { wikilink } from '../../fm/wikilink.js'
import { writeSeal, verifyNote, SLICE_MACHINE_KEYS } from '../seal/index.js'

// ---------------------------------------------------------------------------
// Wikilink encode/decode helpers
// ---------------------------------------------------------------------------

/** Encode blocked_by ids as wikilinks to slice notes in same motive dir. */
function encodeBlockedBy(ids: string[]): string[] {
  return ids.map(id => wikilink(id))
}

/** Decode blocked_by wikilinks → plain slice ids. */
function decodeBlockedBy(links: string[]): string[] {
  return links.map(l => l.replace(/^\[\[/, '').replace(/\]\]$/, ''))
}

/**
 * Encode covers_ac ids as motive-anchored wikilinks [[motive#AC-n]].
 * The motive charter is the backlink target for AC coverage.
 */
function encodeCoverstAc(ids: string[], motive: string): string[] {
  return ids.map(id => wikilink(`${motive}#${id}`))
}

/**
 * Decode covers_ac wikilinks → plain AC ids.
 * [[motive#AC-1]] → "AC-1" (anchor after #). No # → strip [[ and ]].
 */
function decodeCoverstAc(links: string[]): string[] {
  return links.map(l => {
    const inner = l.replace(/^\[\[/, '').replace(/\]\]$/, '')
    const hashIdx = inner.indexOf('#')
    return hashIdx !== -1 ? inner.slice(hashIdx + 1) : inner
  })
}

/** Encode decisions ids as wikilinks to decision notes in decisions/ subfolder. */
function encodeDecisions(ids: string[]): string[] {
  return ids.map(id => wikilink(id))
}

/** Decode decisions wikilinks → plain ids. */
function decodeDecisions(links: string[]): string[] {
  return links.map(l => l.replace(/^\[\[/, '').replace(/\]\]$/, ''))
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Write a slice as a note file. Encodes blocked_by/covers_ac/decisions as
 * wikilinks. Also writes seal sidecar.
 *
 * @param label  Filename label (default = slice.id)
 * @param slug   Optional human slug appended to filename
 * @returns      Absolute path of written note
 */
export function writeSlice(opts: {
  repoRoot: string
  tracker: string
  motive: string
  slice: Slice
  label?: string
  slug?: string
}): string {
  const { repoRoot, tracker, motive, slice, label, slug } = opts
  const effectiveLabel = label ?? slice.id
  const notePath = sliceNotePath(repoRoot, tracker, motive, effectiveLabel, slug)

  // Ensure motive directory exists
  const dir = motiveDir(repoRoot, tracker, motive)
  mkdirSync(dir, { recursive: true })

  // Build frontmatter: spread all slice fields, then encode wikilink arrays
  const fm: Record<string, unknown> = { ...slice }

  if (slice.blocked_by && slice.blocked_by.length > 0) {
    fm['blocked_by'] = encodeBlockedBy(slice.blocked_by)
  }
  if (slice.covers_ac && slice.covers_ac.length > 0) {
    fm['covers_ac'] = encodeCoverstAc(slice.covers_ac, motive)
  }
  if (slice.decisions && slice.decisions.length > 0) {
    fm['decisions'] = encodeDecisions(slice.decisions)
  }

  // js-yaml rejects undefined values — strip them before stringifying
  const fmClean = Object.fromEntries(
    Object.entries(fm).filter(([, v]) => v !== undefined),
  ) as Record<string, unknown>

  const content = matter.stringify('\n', fmClean)
  writeFileSync(notePath, content, 'utf8')

  writeSeal(notePath, dir, fmClean, SLICE_MACHINE_KEYS)

  return notePath
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Read a slice from a note path. Decodes wikilinks back to plain ids.
 * Throws if file doesn't exist or frontmatter fails SliceSchema parse.
 */
export function readSlice(notePath: string): Slice & { sealed: true | false | null } {
  const raw = readFileSync(notePath, 'utf8')
  const { data } = matter(raw)

  // Decode wikilink arrays
  if (Array.isArray(data['blocked_by'])) {
    data['blocked_by'] = decodeBlockedBy(data['blocked_by'] as string[])
  }
  if (Array.isArray(data['covers_ac'])) {
    data['covers_ac'] = decodeCoverstAc(data['covers_ac'] as string[])
  } else if (typeof data['covers_ac'] === 'string') {
    data['covers_ac'] = decodeCoverstAc([data['covers_ac'] as string])
  }
  if (Array.isArray(data['decisions'])) {
    data['decisions'] = decodeDecisions(data['decisions'] as string[])
  } else if (typeof data['decisions'] === 'string') {
    data['decisions'] = decodeDecisions([data['decisions'] as string])
  }

  const parsed = SliceSchema.parse(data)
  const mDir = dirname(notePath)
  const sealed = verifyNote(notePath, mDir, 'slice')
  return { ...parsed, sealed }
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

/**
 * List all slice notes in a motive dir.
 * Excludes: files named exactly "motive.md" and files starting with "gate-".
 * Returns parsed Slice[] with decoded wikilinks.
 */
export function listSlices(repoRoot: string, tracker: string, motive: string): Slice[] {
  const dir = motiveDir(repoRoot, tracker, motive)
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }

  const slices: Slice[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue
    if (entry === 'motive.md') continue
    if (entry.startsWith('gate-')) continue
    try {
      slices.push(readSlice(join(dir, entry)))
    } catch {
      // skip unparseable files
    }
  }
  return slices
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/** Filter listSlices by session UUID. */
export function bySession(
  repoRoot: string,
  tracker: string,
  motive: string,
  session: string,
): Slice[] {
  return listSlices(repoRoot, tracker, motive).filter(s => s.session === session)
}

/**
 * Frontier: pending slices whose blocked_by are all complete/skipped, and
 * which are unclaimed or claimed by the given session.
 */
export function frontier(
  repoRoot: string,
  tracker: string,
  motive: string,
  session: string,
): Slice[] {
  const all = listSlices(repoRoot, tracker, motive)
  const terminalSet = new Set(
    all.filter(s => s.status === 'complete' || s.status === 'skipped').map(s => s.id),
  )
  return all.filter(
    s =>
      s.status === 'pending' &&
      (s.blocked_by ?? []).every(id => terminalSet.has(id)) &&
      (s.claimed_by === undefined || s.claimed_by === session),
  )
}

// ---------------------------------------------------------------------------
// Legacy ledger migration
// ---------------------------------------------------------------------------

/** Shape of a slice record inside the legacy JSON ledger. */
interface LegacySlice {
  id?: string
  wave?: number | null
  status?: string
  kind?: string
  question?: string
  desc?: string
  blocked_by?: string[]
  acceptance?: string[]
  ticket?: string
  created_by?: string
  covers_ac?: string[]
  decisions?: string[]
  claimed_by?: string
  claimed_at?: string
  completed_at?: string
  session_id?: string
  schema_version?: string
}

interface LegacyLedger {
  slices: LegacySlice[]
}

/**
 * Materialize slice notes from a legacy JSON ledger file.
 *
 * Maps:
 *   session_id → session
 *   blocked_by plain ids → wikilinks in frontmatter (decoded on read-back)
 *
 * @param ledgerPath  Absolute path to the .json ledger file
 * @param motive      Slug for the motive directory
 * @param outRoot     Root dir for writing (caller-controlled)
 * @param tracker     Tracker subdirectory (e.g. "next")
 * @returns           Written slices and their paths
 */
export function fromLegacyLedger(opts: {
  ledgerPath: string
  motive: string
  outRoot: string
  tracker: string
}): { slices: Slice[]; paths: string[] } {
  const { ledgerPath, motive, outRoot, tracker } = opts
  const raw = readFileSync(ledgerPath, 'utf8')
  const ledger = JSON.parse(raw) as LegacyLedger

  const slices: Slice[] = []
  const paths: string[] = []

  for (const ls of ledger.slices) {
    if (!ls.id) continue

    const sliceData: Record<string, unknown> = {
      ...ls,
      session: ls.session_id,
    }
    // Remove legacy field name
    delete sliceData['session_id']

    const parsed = SliceSchema.parse(sliceData)
    const notePath = writeSlice({ repoRoot: outRoot, tracker, motive, slice: parsed })
    slices.push(parsed)
    paths.push(notePath)
  }

  return { slices, paths }
}
