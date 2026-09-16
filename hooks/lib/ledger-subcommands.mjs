/**
 * Ledger subcommand list — single source of truth for the .mjs hook layer.
 *
 * IMPORTANT: This list MUST match LEDGER_SUBCOMMANDS in src/gw/cli/commands/ledger.ts.
 * test/hooks/ledger-subcommands-parity.test.ts fails on divergence — drift is loud,
 * not silent.  Do NOT add values here without updating the TypeScript source,
 * and vice-versa.
 */
export const LEDGER_SUBCOMMANDS = [
  'init', 'stamp-motive', 'status', 'add', 'set', 'complete', 'rm', 'show', 'view',
  'gate', 'abandon', 'fog', 'frontier', 'claim', 'await-human',
  'autopilot', 'checkpoint', 'hold', 'scope-token', 'milestone-signoff', 'help',
]
