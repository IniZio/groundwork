/**
 * Valid ticket type values — single source of truth for the hook (.mjs) layer.
 *
 * IMPORTANT: This list MUST match TicketType in src/gw/schema/ticket.ts.
 * test/hooks/ticket-type-parity.test.ts fails on divergence — drift is loud,
 * not silent.  Do NOT add values here without updating the TypeScript enum,
 * and vice-versa.
 */
export const TICKET_TYPES = [
  'analysis', 'build', 'chore', 'choose', 'decision', 'design',
  'enhancement', 'feat', 'fix', 'grill', 'model', 'research', 'spec',
]
