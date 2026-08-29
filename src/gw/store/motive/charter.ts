import { readFile, writeFile } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { MotiveSchema } from '../../schema/index.js'

// Path function: <repoRoot>/<tracker>/motives/<motive>/index.md
export function charterPath(repoRoot: string, tracker: string, motive: string): string {
  return path.join(repoRoot, tracker, 'motives', motive, 'index.md')
}

export interface CharterNote {
  fm: Record<string, unknown>
  body: string
}

// Read an index.md from the new layout; throws if file not found
export async function readCharter(opts: {
  repoRoot: string
  tracker: string
  motive: string
}): Promise<CharterNote> {
  const filePath = charterPath(opts.repoRoot, opts.tracker, opts.motive)
  const raw = await readFile(filePath, 'utf8')
  const { data, content } = matter(raw)
  const fm = MotiveSchema.parse(data) as Record<string, unknown>
  return { fm, body: content }
}

// Write index.md; creates directories as needed (mkdirSync recursive)
export async function writeCharter(opts: {
  repoRoot: string
  tracker: string
  motive: string
  fm: Record<string, unknown>
  body: string
}): Promise<void> {
  const filePath = charterPath(opts.repoRoot, opts.tracker, opts.motive)
  mkdirSync(path.dirname(filePath), { recursive: true })
  const output = matter.stringify(opts.body, opts.fm)
  await writeFile(filePath, output, 'utf8')
}

// Parse existing motive.md raw text → CharterNote
export function fromLegacyCharter(raw: string): CharterNote {
  const { data, content } = matter(raw)
  const fm = MotiveSchema.parse(data) as Record<string, unknown>
  return { fm, body: content }
}
