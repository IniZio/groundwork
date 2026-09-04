import { z } from 'zod'

const AdvisorVerdictEnum = z.enum(['APPROVE','CORRECTION','STOP','GAPS','REPLAN'])

const AdvisorVerdictObject = z.looseObject({
  verdict: AdvisorVerdictEnum,
  rubric: z.string().optional(),
  citation: z.string().optional(),
  axes: z.object({
    correctness: z.number().min(0).max(1).optional(),
    completeness: z.number().min(0).max(1).optional(),
    over_engineering: z.number().min(0).max(1).optional(),
  }).optional(),
})

export const GateSchema = z.looseObject({
  session: z.string(),              // UUID
  motive: z.string(),               // slug
  created_at: z.string().optional(), // ISO timestamp
  advisor: z.union([AdvisorVerdictEnum, AdvisorVerdictObject]).optional(),
  verifier: z.string().optional(),
  qa: z.string().optional(),
})

export type Gate = z.infer<typeof GateSchema>
