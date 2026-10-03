import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'


function addPath(raw: string, cwd: string, files: Set<string>): void {
  if (!raw || raw.includes('$')) return
  const stripped = raw.replace(/^["']|["']$/g, '')
  if (!stripped) return
  const resolved = stripped.startsWith('/') ? stripped : path.join(cwd, stripped)
  if (resolved === '/dev/null') return
  if (resolved.startsWith('/tmp/')) return
  if (resolved.startsWith('/dev/shm/')) return
  files.add(resolved)
}

function extractBashTargets(cmd: string, cwd: string, files: Set<string>): void {
  for (const line of cmd.split('\n')) {
    let m: RegExpMatchArray | null

    m = line.match(/\bcat\s+>>?\s+(["']?[^\s'"<>&|$;]+["']?)\s*<</)
    if (m) { addPath(m[1], cwd, files); continue }

    m = line.match(/\btee\s+(?:-a\s+)?(["']?[^\s'"<>&|$;]+["']?)\s*(?:$|[|&])/)
    if (m) { addPath(m[1], cwd, files); continue }

    m = line.match(/\bsed\s+(?:-i\S*|-i\s)\s+\S+\s+(["']?[^\s'"<>&|$;]+["']?)\s*(?:$|[|&])/)
    if (m) { addPath(m[1], cwd, files); continue }

    m = line.match(/\b(?:cp|mv)\s+(?:-\S+\s+)*\S+\s+(["']?[^\s'"<>&|$;]+["']?)\s*(?:$|[|&])/)
    if (m) { addPath(m[1], cwd, files); continue }

    m = line.match(/(?:^|[^<])>>?\s+(["']?[^\s'"<>&|$;]+["']?)(?:\s|$)/)
    if (m) { addPath(m[1], cwd, files); continue }
  }
}

// realpath, or for a missing file the nearest existing ancestor's realpath plus the rest.
function real(p: string): string {
  let cur = p
  const rest: string[] = []
  for (;;) {
    try { return path.join(realpathSync(cur), ...rest) } catch { /* climb */ }
    const parent = path.dirname(cur)
    if (parent === cur) return p
    rest.unshift(path.basename(cur))
    cur = parent
  }
}

/** Repo-relative files a transcript's main thread touched. Never throws. */
export function sessionTouchedFiles(transcriptPath: string, repoRoot: string): Set<string> {
  const out = new Set<string>()
  let raw: string
  try { raw = readFileSync(transcriptPath, 'utf8') } catch { return out }
  const abs = new Set<string>()
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      const obj = JSON.parse(t) as Record<string, unknown>
      if (obj.type !== 'assistant' || obj.isSidechain === true) continue
      const msg = (obj.message ?? obj) as Record<string, unknown>
      if (!Array.isArray(msg.content)) continue
      const cwd = typeof obj.cwd === 'string' ? obj.cwd : ''
      for (const blk of msg.content as Record<string, unknown>[]) {
        if (!blk || blk.type !== 'tool_use') continue
        const inp = blk.input as Record<string, unknown> | undefined
        if (blk.name === 'Edit' || blk.name === 'Write' || blk.name === 'MultiEdit') {
          if (inp && typeof inp.file_path === 'string' && inp.file_path) abs.add(inp.file_path)
        } else if (blk.name === 'Bash') {
          extractBashTargets(inp && typeof inp.command === 'string' ? inp.command : '', cwd, abs)
        }
      }
    } catch { continue }
  }
  const root = real(repoRoot)
  for (const f of abs) {
    const rel = path.relative(root, real(f))
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) out.add(rel)
  }
  return out
}
