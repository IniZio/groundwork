/**
 * Parity guard: TICKET_TYPES in hooks/lib/ticket-types.mjs must stay in sync
 * with TicketType in src/gw/schema/ticket.ts.  This test fails on divergence
 * so drift is loud, not silent.
 */
import { describe, it, expect } from 'vitest'
import { TicketType } from '../../src/gw/schema/ticket.js'
import { TICKET_TYPES } from '../../hooks/lib/ticket-types.mjs'

describe('ticket-type parity: hooks/lib/ticket-types.mjs vs src/gw/schema/ticket.ts', () => {
  it('TICKET_TYPES matches TicketType.options (same values, any order)', () => {
    expect([...TICKET_TYPES].sort()).toEqual([...TicketType.options].sort())
  })
})
