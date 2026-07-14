/**
 * Groundwork ledger I/O — safe, atomic, locked read-modify-write for
 * `.groundwork/run.json`. Shared by the `ledger` CLI (orchestrator-facing) and
 * the stop-gate hook so the two writers never race.
 *
 * Patterns adopted from plugins already proven on this machine rather than
 * invented here:
 *  - Atomic write: OMC's `atomicWriteJsonSync` shape — write a uniquely-named
 *    temp file, fsync it, rename over the target (atomic on POSIX), best-effort
 *    fsync the directory. A reader never observes a torn file.
 *  - Locking: the official security-guidance plugin's exclusive-lock RMW — an
 *    O_EXCL lockfile guards the read→mutate→write window so concurrent writers
 *    (orchestrator CLI + stop-gate hook) serialize. Dependency-free.
 *
 * Everything here is best-effort and never silently corrupts: a failed lock or
 * parse surfaces to the caller, which decides whether to fail open.
 */

import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

/** Synchronous sleep with no busy-wait and no dependency (Atomics.wait). */
function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  } catch {
    /* SharedArrayBuffer unavailable — fall through, caller retries immediately */
  }
}

/** Write `data` to `filePath` atomically (temp + fsync + rename). Throws on failure. */
export function atomicWriteFileSync(filePath, data) {
  const dir = path.dirname(filePath)
  mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp.${randomUUID()}`)
  const fd = openSync(tmp, 'w')
  try {
    writeFileSync(fd, data)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tmp, filePath)
  // Best-effort: durably record the rename in the directory entry.
  try {
    const dfd = openSync(dir, 'r')
    try {
      fsyncSync(dfd)
    } finally {
      closeSync(dfd)
    }
  } catch {
    /* not fatal */
  }
}

/** Serialize an object to the canonical ledger format and write it atomically. */
export function atomicWriteJsonSync(filePath, obj) {
  atomicWriteFileSync(filePath, `${JSON.stringify(obj, null, 2)}\n`)
}

/**
 * Run `fn` while holding an exclusive lock on `${targetPath}.lock`. Retries on
 * contention; steals a lock older than `staleMs` (a crashed holder must never
 * wedge the gate forever). Always releases. Throws on lock timeout.
 */
export function withLock(targetPath, fn, { retries = 100, delayMs = 20, staleMs = 5000 } = {}) {
  const lockPath = `${targetPath}.lock`
  mkdirSync(path.dirname(targetPath), { recursive: true })
  let fd = null
  for (let i = 0; fd === null; i++) {
    try {
      fd = openSync(lockPath, 'wx') // O_CREAT | O_EXCL
    } catch (e) {
      if (e?.code !== 'EEXIST') throw e
      // Break a stale lock left by a crashed holder.
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > staleMs) {
          unlinkSync(lockPath)
          continue
        }
      } catch {
        /* lock vanished between stat and unlink — retry */
      }
      if (i >= retries) throw new Error(`ledger lock timeout: ${lockPath}`)
      sleepSync(delayMs)
    }
  }
  try {
    return fn()
  } finally {
    try {
      closeSync(fd)
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(lockPath)
    } catch {
      /* ignore */
    }
  }
}

/**
 * Locked read-modify-write of the ledger. Reads fresh JSON inside the lock (so a
 * concurrent write is never clobbered), applies `fn(ledger)`, and atomically
 * writes the result. `fn` may mutate `ledger` in place (return undefined) or
 * return a replacement object; returning `null` skips the write. A missing or
 * unparseable ledger is passed to `fn` as `null`.
 */
export function mutateLedger(ledgerPath, fn) {
  return withLock(ledgerPath, () => {
    let ledger = null
    try {
      ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
    } catch {
      ledger = null
    }
    const returned = fn(ledger)
    const next = returned === undefined ? ledger : returned
    if (next != null) atomicWriteJsonSync(ledgerPath, next)
    return next
  })
}

/** Read and parse the ledger without locking. Returns null on any failure. */
export function readLedger(ledgerPath) {
  try {
    return JSON.parse(readFileSync(ledgerPath, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Resolve the ledger file path for a given project directory and session id.
 *
 * Strategy:
 *  - sessionId must match /^[A-Za-z0-9_-]{1,128}$/ (path-traversal guard);
 *    invalid/absent sessionId → fall back to the legacy path.
 *  - With a valid sessionId: return `.groundwork/runs/<sessionId>.json`.
 *    BUT for back-compat: if that per-session file does NOT yet exist AND the
 *    legacy `.groundwork/run.json` exists AND (legacy has no session_id OR
 *    legacy.session_id === sessionId), return the legacy path so in-flight old
 *    runs keep working.
 *  - Without a sessionId: return the legacy path `.groundwork/run.json`.
 */
export function resolveLedgerPath({ projectDir, sessionId } = {}) {
  const legacyPath = path.join(projectDir, '.groundwork', 'run.json')
  if (!sessionId || typeof sessionId !== 'string') return legacyPath

  const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/
  if (!SAFE_ID.test(sessionId)) return legacyPath

  const perSessionPath = path.join(projectDir, '.groundwork', 'runs', `${sessionId}.json`)

  // Per-session file already exists → use it (new session or resumed).
  if (existsSync(perSessionPath)) return perSessionPath

  // Per-session file doesn't exist yet — check legacy back-compat:
  if (existsSync(legacyPath)) {
    let legacy = null
    try { legacy = JSON.parse(readFileSync(legacyPath, 'utf8')) } catch { /* ignore */ }
    const legacyOwner = legacy?.session_id
    if (!legacyOwner || legacyOwner === sessionId) return legacyPath
  }

  // New run — use per-session path.
  return perSessionPath
}

/**
 * Best-effort prune of stale per-session ledger files under `.groundwork/runs/`.
 * Removes files that are inactive (active:false) OR older than 7 days (mtime).
 * Never throws.
 */
export function pruneStaleSessionLedgers(projectDir) {
  const runsDir = path.join(projectDir, '.groundwork', 'runs')
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
  try {
    const files = readdirSync(runsDir).filter((f) => f.endsWith('.json'))
    for (const f of files) {
      const fp = path.join(runsDir, f)
      try {
        const st = statSync(fp)
        if (Date.now() - st.mtimeMs > sevenDaysMs) { unlinkSync(fp); continue }
        const obj = JSON.parse(readFileSync(fp, 'utf8'))
        if (obj.active === false) unlinkSync(fp)
      } catch {
        /* ignore per-file errors */
      }
    }
  } catch {
    /* runsDir doesn't exist or not readable — nothing to prune */
  }
}
