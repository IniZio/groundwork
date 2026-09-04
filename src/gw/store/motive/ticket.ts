import { readFile, writeFile } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { TicketSchema, ticketPath } from '../../schema/index.js'

interface TicketNote {
  fm: Record<string, unknown>
  body: string
}

// Read ticket; throws if not found
export async function readTicket(opts: {
  repoRoot: string
  tracker: string
  motive: string
  filename: string
}): Promise<TicketNote> {
  const filePath = ticketPath(opts.repoRoot, opts.tracker, opts.motive, opts.filename)
  const raw = await readFile(filePath, 'utf8')
  const { data, content } = matter(raw)
  const fm = TicketSchema.parse(data) as Record<string, unknown>
  return { fm, body: content }
}

// Write ticket; creates directories as needed
export async function writeTicket(opts: {
  repoRoot: string
  tracker: string
  motive: string
  filename: string
  fm: Record<string, unknown>
  body: string
}): Promise<void> {
  const filePath = ticketPath(opts.repoRoot, opts.tracker, opts.motive, opts.filename)
  mkdirSync(path.dirname(filePath), { recursive: true })
  const output = matter.stringify(opts.body, opts.fm)
  await writeFile(filePath, output, 'utf8')
}

// Parse existing ticket raw text → TicketNote
export function fromLegacyTicket(raw: string): TicketNote {
  const { data, content } = matter(raw)
  const fm = TicketSchema.parse(data) as Record<string, unknown>
  return { fm, body: content }
}
