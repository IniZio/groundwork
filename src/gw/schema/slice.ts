import { z } from 'zod'

// covers_ac and decisions: accept "AC-1" or ["AC-1","AC-2"] from frontmatter
const stringOrArray = z.union([
  z.string().transform(s => [s]),
  z.array(z.string()),
]).optional()

export const SliceSchema = z.looseObject({
  id: z.string(),                   // required: "S1", "S1-SCHEMA", etc.
  wave: z.number().int().nullable().optional(),
  status: z.enum(['pending','in_progress','complete','skipped']),
  kind: z.enum(['impl','plan','diagnose','design','fog']).optional().default('impl'),
  question: z.string().optional(),  // only for fog slices
  desc: z.string().optional(),
  blocked_by: z.array(z.string()).optional(),
  acceptance: z.array(z.string()).optional(),  // DECISION: array not prose
  ticket: z.string().optional(),    // no .md, no path — bare filename stem
  created_by: z.string().optional(),
  covers_ac: stringOrArray,
  decisions: stringOrArray,
  claimed_by: z.string().optional(),
  claimed_at: z.string().optional(),   // ISO timestamp
  completed_at: z.string().optional(), // ISO timestamp
  session: z.string().optional(),      // UUID of owning session
  schema_version: z.string().optional(),
})

export type Slice = z.infer<typeof SliceSchema>
