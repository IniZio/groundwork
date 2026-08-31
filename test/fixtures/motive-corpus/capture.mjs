#!/usr/bin/env node
/**
 * capture.mjs — regenerate test/fixtures/motive-corpus/ from the live .groundwork/ tree.
 *
 * Run from the repo root: node test/fixtures/motive-corpus/capture.mjs
 *
 * This overwrites the committed fixture with a fresh point-in-time snapshot of
 * the FIXTURE_SLUGS motives. Run it only when you intentionally want to update
 * the golden corpus; otherwise the fixture stays frozen.
 *
 * Never hand-edit the generated files under .groundwork/ — edit the source in
 * the live .groundwork/ tree, then re-run this script.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FIXTURE_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(FIXTURE_DIR, '..', '..', '..')
const LIVE_JOURNAL = path.join(REPO, '.groundwork', 'journal')
const LIVE_MOTIVES = path.join(REPO, '.groundwork', 'motives')

// ── Slug set to capture (must match FIXTURE_SLUGS in index.mjs) ──────────────
const SELECTED_MOTIVES = [
  'groundwork-development',
  'obsidian-native-groundwork',
]

// ── Wipe and recreate fixture .groundwork ─────────────────────────────────────
const fixtureGw = path.join(FIXTURE_DIR, '.groundwork')
try { rmSync(fixtureGw, { recursive: true, force: true }) } catch {}
const fixtureJournal = path.join(fixtureGw, 'journal')
mkdirSync(fixtureJournal, { recursive: true })
for (const slug of SELECTED_MOTIVES) {
  mkdirSync(path.join(fixtureGw, 'motives', slug, 'tickets'), { recursive: true })
}

// ── Extract journal events per motive ─────────────────────────────────────────
const eventsByMotive = Object.fromEntries(SELECTED_MOTIVES.map(m => [m, []]))
const shards = readdirSync(LIVE_JOURNAL).filter(f => f.endsWith('.jsonl')).sort()
for (const shard of shards) {
  const lines = readFileSync(path.join(LIVE_JOURNAL, shard), 'utf8').split('\n')
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line)
      if (Object.prototype.hasOwnProperty.call(eventsByMotive, e.motive)) {
        eventsByMotive[e.motive].push(line)
      }
    } catch {}
  }
}
for (const [motive, lines] of Object.entries(eventsByMotive)) {
  writeFileSync(path.join(fixtureJournal, `${motive}.jsonl`), lines.join('\n') + '\n')
  console.log(`  journal: ${lines.length} events for ${motive}`)
}

// ── Copy charters ─────────────────────────────────────────────────────────────
for (const slug of SELECTED_MOTIVES) {
  const src = path.join(LIVE_MOTIVES, slug, 'motive.md')
  const dst = path.join(fixtureGw, 'motives', slug, 'motive.md')
  try { copyFileSync(src, dst); console.log(`  charter: ${slug}`) }
  catch { console.log(`  charter: ${slug} — not found, skipped`) }
}

// ── Copy tickets ──────────────────────────────────────────────────────────────
for (const slug of SELECTED_MOTIVES) {
  const srcDir = path.join(LIVE_MOTIVES, slug, 'tickets')
  const dstDir = path.join(fixtureGw, 'motives', slug, 'tickets')
  mkdirSync(dstDir, { recursive: true })
  try {
    const files = readdirSync(srcDir).filter(f => f.endsWith('.md'))
    for (const f of files) copyFileSync(path.join(srcDir, f), path.join(dstDir, f))
    console.log(`  tickets: ${files.length} files for ${slug}`)
  } catch { console.log(`  tickets: ${slug} — none`) }
}

console.log('\ncapture complete.')
