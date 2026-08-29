/**
 * src/gw/hook/types.ts — Shared interface for all gw hook implementations.
 */
export interface HookResult {
  /** Raw bytes to write to process.stdout */
  stdout: string
  /** Raw bytes to write to process.stderr */
  stderr: string
  /** Process exit code (hooks always exit 0 except errors) */
  exit: number
}

/**
 * HookFn — the standard signature every hook module exports as `run`.
 * @param input  - Parsed stdin JSON (or {} on parse failure)
 * @param env    - process.env snapshot at invocation time
 */
export type HookFn = (
  input: unknown,
  env: Record<string, string | undefined>,
) => Promise<HookResult>
