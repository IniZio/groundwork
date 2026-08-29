/**
 * src/gw/schema/index.ts — Single import point for all frontmatter schemas.
 *
 * This barrel is the ONLY place frontmatter Zod schemas are defined.
 * No other file under src/ may define z.object() frontmatter schemas.
 * (Enforced by test/gw/schema.test.ts AC8 guard.)
 */

export * from './motive.js'
export * from './slice.js'
export * from './gate.js'
export * from './decision.js'
export * from './ticket.js'
export * from './requirement.js'
export * from './concept.js'
export * from './journal.js'
export * from './layout.js'
