import { z } from 'zod'

/** Normalise legacy "D1".."D8" → "D-1".."D-8"; pass canonical "D-n" unchanged */
const DecisionIdSchema = z.string().transform(raw => {
  // Already canonical: D-n (n ≥ 1)
  if (/^D-\d+$/.test(raw)) return raw
  // Legacy: D1..D8
  const m = /^D(\d+)$/.exec(raw)
  if (m) return `D-${m[1]}`
  return raw  // unknown format — pass through unchanged
})

export const DecisionSchema = z.looseObject({
  id: DecisionIdSchema,  // required; normalised on parse
  status: z.enum(['proposed','accepted','deprecated','superseded']).optional(),
  date: z.string().optional(),          // ISO date YYYY-MM-DD
  deciders: z.array(z.string()).optional(),
  title: z.string().optional(),         // may duplicate H1
})

export type Decision = z.infer<typeof DecisionSchema>
