/**
 * journal-emit.ts — writes journal events to the append-only JSONL shard store
 * from the gw CLI layer.
 *
 * Mirrors the contract of hooks/lib/journal-io.mjs (same file format and path
 * formula).  Kept as a separate module so hooks/ (plain .mjs) and src/gw/
 * (TypeScript) can evolve independently — hooks/ cannot import from src/.
 *
 * Fail-open design: any write error is reported to stderr and ignored.  The
 * caller has already committed its primary write (ledger, etc.) before calling
 * here, so a journal failure must not roll that back.
 */
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'

const SAFE_SESSION = /^[a-zA-Z0-9_-]{1,128}$/

function resolveShardPath(projectDir: string, sessionId: string): string {
  const safeId = SAFE_SESSION.test(sessionId) ? sessionId : 'default'
  const d = new Date().toISOString().slice(0, 10)
  return join(projectDir, '.groundwork', 'journal', `${d}-${safeId}.jsonl`)
}

function appendLine(shardPath: string, line: string): void {
  mkdirSync(dirname(shardPath), { recursive: true })
  const buf = Buffer.from(line + '\n', 'utf8')
  const fd = openSync(shardPath, 'a')
  try {
    writeSync(fd, buf)
  } finally {
    closeSync(fd)
  }
}

/**
 * Emit one AC_COVERAGE journal event using the "array-covers form":
 *   data: { slice, covers: ['AC-1', 'AC-2'] }
 *
 * This matches the form accepted by motive-compile.mjs:399-407 and by
 * readOrderedEvents (hooks/lib/journal-order.mjs) which feeds motive-map.mjs.
 *
 * Idempotency: re-emitting the same (slice, covers) pair appends a duplicate
 * event.  motive-compile.mjs uses a Set for sliceCompositeId so duplicate
 * events for the same pair are no-ops at the fold level.
 *
 * Fail-open: any I/O error is printed to stderr and ignored.
 */
export function emitAcCoverageEvent(opts: {
  projectDir: string
  sessionId: string
  motive: string
  sliceId: string
  coversAc: string[]
}): void {
  try {
    const { projectDir, sessionId, motive, sliceId, coversAc } = opts
    const event: Record<string, unknown> = {
      ts: new Date().toISOString(),
      session: sessionId,
      motive,
      type: 'AC_COVERAGE',
      msg: `${sliceId} covers ${coversAc.join(', ')}`,
      source: 'cli:ledger',
      data: { slice: sliceId, covers: coversAc },
    }
    appendLine(resolveShardPath(projectDir, sessionId), JSON.stringify(event))
  } catch (err) {
    process.stderr.write(
      `journal-emit: AC_COVERAGE write failed: ${(err as Error)?.message ?? String(err)}\n`,
    )
  }
}
