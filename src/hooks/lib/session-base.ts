import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

function parseTs(s: string): number {
  const n = s.replace(' ', 'T')
  return Date.parse(/[+-]\d\d:\d\d$|Z$/.test(n) ? n : n + 'Z')
}

function firstTimestamp(transcriptPath: string): string | null {
  let raw: string
  try { raw = readFileSync(transcriptPath, 'utf8') } catch { return null }
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      const ts = (JSON.parse(t) as Record<string, unknown>).timestamp
      if (typeof ts === 'string' && ts) return ts
    } catch { continue }
  }
  return null
}

function git(repoRoot: string, args: string[]): string | null {
  const r = spawnSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', timeout: 5000 })
  return r.status === 0 ? r.stdout.trim() : null
}

/** Newest commit strictly before the transcript's first timestamp (parity with house-rules sessionBase, except when committer dates go backwards along history, where rev-list picks the first qualifying commit in walk order rather than the newest by %ct); HEAD when transcript missing/unreadable/timestampless, EMPTY_TREE-equivalent only when no commit precedes it. */
export function sessionBase(transcriptPath: string | undefined, repoRoot: string): string {
  const head = git(repoRoot, ['rev-parse', 'HEAD']) ?? 'HEAD'
  const ts = transcriptPath ? firstTimestamp(transcriptPath) : null
  if (!ts) return head
  const tsMs = parseTs(ts)
  if (isNaN(tsMs)) return head
  const maxCt = Math.ceil(tsMs / 1000) - 1
  const found = git(repoRoot, ['rev-list', '-1', `--min-age=${maxCt}`, 'HEAD'])
  if (found === null) return head
  return found || '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
}
