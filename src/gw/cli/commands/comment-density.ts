import { existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { type GwEnvelope, errEnvelope, okEnvelope } from '../envelope.js'

export const COMMENT_DENSITY_SUBCOMMANDS = ['report', 'remediate-plan'] as const

function parseFlags(args: string[]): { flags: Record<string, string | true>; positionals: string[] } {
  const flags: Record<string, string | true> = {}
  const positionals: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith('--')) {
      const next = args[i + 1]
      if (next && !next.startsWith('--')) { flags[a.slice(2)] = next; i++ }
      else flags[a.slice(2)] = true
    } else { positionals.push(a) }
  }
  return { flags, positionals }
}

function gitFiles(cwd: string): string[] {
  const tracked = spawnSync('git', ['diff', '--name-only', 'HEAD'], { cwd, encoding: 'utf8' })
  const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd, encoding: 'utf8' })
  const lines: string[] = []
  if (tracked.stdout) lines.push(...tracked.stdout.split('\n').filter(Boolean))
  if (untracked.stdout) lines.push(...untracked.stdout.split('\n').filter(Boolean))
  return [...new Set(lines)]
}

interface ManifestFile {
  path: string
  totalLines: number
  commentLines: number
  commentsPer100: number
  reasons: Array<{ kind: 'over-cap' | 'restating'; lines: number[]; detail: string }>
}

interface Manifest {
  cap: { file: number; aggregate: number }
  aggregatePer100: number
  files: ManifestFile[]
}

async function runReport(args: string[], cwd: string): Promise<GwEnvelope> {
  if (process.env['GROUNDWORK_COMMENT_DENSITY'] === '0') {
    const empty: Manifest = { cap: { file: 5, aggregate: 2 }, aggregatePer100: 0, files: [] }
    return okEnvelope('comment-density report', empty)
  }

  const { flags } = parseFlags(args)
  const { isExcluded, analyzeFile, analyzeFiles, FILE_CAP, AGGREGATE_CAP } = await import(
    '../../../../hooks/lib/comment-density.mjs'
  )
  const { findAllRestatingComments } = await import('../../../../hooks/lib/comment-restate.mjs')

  let relPaths: string[]
  if (flags['files'] && typeof flags['files'] === 'string') {
    relPaths = flags['files'].split(',').filter(Boolean)
  } else {
    relPaths = gitFiles(cwd)
  }

  const entries: Array<{ path: string; content: string }> = []
  const relToAbs: Map<string, string> = new Map()

  for (const rel of relPaths) {
    const abs = join(cwd, rel)
    if (isExcluded(abs)) continue
    if (!existsSync(abs)) continue
    let content: string
    try { content = readFileSync(abs, 'utf8') } catch { continue }
    entries.push({ path: abs, content })
    relToAbs.set(abs, rel)
  }

  const { files: fileResults, aggregatePer100 } = analyzeFiles(entries)

  const flaggedFiles: ManifestFile[] = []
  for (const fr of fileResults) {
    if (fr.excluded) continue
    const content = entries.find(e => e.path === fr.path)?.content ?? ''
    const restating = findAllRestatingComments(content)

    const reasons: ManifestFile['reasons'] = []
    if (fr.commentsPer100 > FILE_CAP) {
      reasons.push({
        kind: 'over-cap',
        lines: fr.lines,
        detail: `${fr.commentsPer100.toFixed(1)}/100 exceeds cap of ${FILE_CAP}/100`,
      })
    }
    if (restating.length > 0) {
      reasons.push({
        kind: 'restating',
        lines: restating.map((r: { line: number }) => r.line + 1),
        detail: restating.map((r: { reason: string }) => r.reason).join('; '),
      })
    }
    if (reasons.length === 0) continue

    flaggedFiles.push({
      path: fr.path,
      totalLines: fr.totalLines,
      commentLines: fr.commentLines,
      commentsPer100: fr.commentsPer100,
      reasons,
    })
  }

  const manifest: Manifest = {
    cap: { file: FILE_CAP, aggregate: AGGREGATE_CAP },
    aggregatePer100,
    files: flaggedFiles,
  }
  return okEnvelope('comment-density report', manifest)
}

async function runRemediatePlan(args: string[], cwd: string): Promise<GwEnvelope> {
  const { flags } = parseFlags(args)
  const motive = typeof flags['motive'] === 'string' ? flags['motive'] : ''
  if (!motive) {
    return errEnvelope('comment-density remediate-plan', 'MISSING_ARG', '--motive <slug> is required', 2)
  }
  const wave = typeof flags['wave'] === 'string' ? parseInt(flags['wave'], 10) : 1

  let raw: string
  if (typeof flags['manifest'] === 'string') {
    try { raw = readFileSync(flags['manifest'], 'utf8') } catch (e) {
      return errEnvelope('comment-density remediate-plan', 'READ_ERROR', `Cannot read manifest: ${(e as Error).message}`, 1)
    }
  } else {
    raw = readFileSync(0, 'utf8')
  }

  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch {
    return errEnvelope('comment-density remediate-plan', 'PARSE_ERROR', 'Manifest is not valid JSON', 1)
  }

  let manifest: Manifest
  if (parsed && typeof parsed === 'object' && 'ok' in (parsed as object)) {
    manifest = (parsed as GwEnvelope & { data: Manifest }).data as Manifest
  } else {
    manifest = parsed as Manifest
  }

  const lines: string[] = []
  const briefLines: string[] = []
  briefLines.push('# Agent brief template (paste into Task prompt per file):')

  for (let i = 0; i < manifest.files.length; i++) {
    const f = manifest.files[i]
    const n = String(i + 1).padStart(3, '0')
    const relPath = relative(cwd, f.path)
    const reasonKinds = [...new Set(f.reasons.map(r => r.kind))].join(',')
    const allLines = f.reasons.flatMap(r => r.lines).sort((a, b) => a - b)
    const acceptance = `${f.path} ≤5/100;no restating comments;existing tests green`

    lines.push(
      `gw ledger add --motive ${motive} CD-${n} --wave ${wave} --kind impl` +
      ` --desc "haiku cleanup: ${relPath} — ${reasonKinds} — model=haiku"` +
      ` --acceptance "${acceptance}" --covers-ac AC10 --decisions D-9`
    )

    briefLines.push(
      `# FILE: ${f.path} | LINES: ${allLines.join(',')} | REASON: ${reasonKinds}` +
      ` | CAP: 5/100 | INSTRUCTION: reduce comment density to ≤5/100 and remove restating comments;` +
      ` touch ONLY this file; run existing tests to verify green`
    )
  }

  lines.push('')
  lines.push(...briefLines)

  return okEnvelope('comment-density remediate-plan', { content: lines.join('\n') })
}

export async function run(args: string[], cwd: string): Promise<GwEnvelope> {
  const [subcmd, ...rest] = args
  if (subcmd === 'report') return runReport(rest, cwd)
  if (subcmd === 'remediate-plan') return runRemediatePlan(rest, cwd)
  return errEnvelope(
    'comment-density',
    'UNKNOWN_SUBCOMMAND',
    `Unknown subcommand: "${subcmd}". Use: ${COMMENT_DENSITY_SUBCOMMANDS.join(', ')}`,
    2,
  )
}
