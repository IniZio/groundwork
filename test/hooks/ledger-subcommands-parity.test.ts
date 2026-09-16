/**
 * Parity guard: LEDGER_SUBCOMMANDS in hooks/lib/ledger-subcommands.mjs must stay
 * in sync with LEDGER_SUBCOMMANDS in src/gw/cli/commands/ledger.ts.
 * Drift is loud, not silent.
 */
import { describe, it, expect } from 'vitest'
import { LEDGER_SUBCOMMANDS as TS_SUBCOMMANDS } from '#src/gw/cli/commands/ledger.js'
import { LEDGER_SUBCOMMANDS as MJS_SUBCOMMANDS } from '../../hooks/lib/ledger-subcommands.mjs'

describe('ledger-subcommands parity: hooks/lib/ledger-subcommands.mjs vs src/gw/cli/commands/ledger.ts', () => {
  it('MJS list matches TS source (same values, same order)', () => {
    expect([...MJS_SUBCOMMANDS]).toEqual([...TS_SUBCOMMANDS])
  })
})
