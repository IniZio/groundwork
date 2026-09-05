import { z } from 'zod'

export const JournalEventType = z.enum([
  'DECISION',
  'TASK_COMPLETE',
  'AC_COVERAGE',
  'AC_RETRACTION',
  'GRAPH_MUTATE',
  'GATE',
  'FAILURE',
  'BASELINE',
  'TBD',
  'TBR',
])

export const JournalEventSchema = z.looseObject({
  ts: z.string(),                   // ISO timestamp
  session: z.string(),              // session id or UUID
  motive: z.string().optional(),    // slug
  type: JournalEventType,
  source: z.string().optional(),    // e.g. "hook:ledger"
  rfc: z.string().optional(),       // DECISION: keep — meaning unclear but present on all events
  msg: z.string().optional(),       // human-readable message (may be H1 title)
  data: z.record(z.string(), z.unknown()).optional().default({}),  // event-specific; passthrough in body
})

export type JournalEvent = z.infer<typeof JournalEventSchema>
