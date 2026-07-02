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

import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
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
