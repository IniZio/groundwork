// Type declarations for ledger-io.mjs

/**
 * Atomically write a string to a file using a temp-file + rename strategy.
 */
export declare function atomicWriteFileSync(filePath: string, data: string): void

/**
 * Atomically write a JSON-serialised object to a file.
 */
export declare function atomicWriteJsonSync(filePath: string, obj: object): void

/**
 * Execute `fn` under a lock file, retrying on contention.
 * Returns whatever `fn` returns.
 */
export declare function withLock<T>(
  targetPath: string,
  fn: () => T,
  opts?: { retries?: number; delayMs?: number; staleMs?: number }
): T

/**
 * Read the ledger at `ledgerPath`, apply `fn` to it, and atomically write the result back.
 */
export declare function mutateLedger(ledgerPath: string, fn: (ledger: object) => object): void

/**
 * Read and parse the ledger JSON at `ledgerPath`.
 */
export declare function readLedger(ledgerPath: string): object

/**
 * Resolve the canonical ledger path for the current or specified session.
 */
export declare function resolveLedgerPath(opts?: { projectDir?: string; sessionId?: string }): string

/**
 * Remove stale session ledger files from `projectDir/.groundwork/runs/`.
 */
export declare function pruneStaleSessionLedgers(projectDir: string): void
