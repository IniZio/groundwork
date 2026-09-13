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

// ---------------------------------------------------------------------------
// Phase checkpoint types (T1 — motive phase-checkpoint-gate)
// ---------------------------------------------------------------------------

/** Phase tier: BLOCKS (human verification required) or AUTO_ADVANCES (directive-only). */
export const PhaseTierEnum = z.enum(['BLOCKS', 'AUTO_ADVANCES'])
export type PhaseTier = z.infer<typeof PhaseTierEnum>

/** Phase verdict written by the checkpoint CLI command. */
export const PhaseVerdictEnum = z.enum(['APPROVE', 'REJECT', 'PENDING'])
export type PhaseVerdict = z.infer<typeof PhaseVerdictEnum>

/** Single phase checkpoint entry — one per phase in the gate.phases map. */
export const PhaseCheckpointSchema = z.object({
  deliverable: z.string(),
  tier: PhaseTierEnum,
  verdict: PhaseVerdictEnum.optional(),
  verified_by: z.string().optional(),
  verified_at: z.string().optional(),
  artifacts: z.array(z.string()).optional(),
})
export type PhaseCheckpoint = z.infer<typeof PhaseCheckpointSchema>

/**
 * Map of phase key → PhaseCheckpoint.
 * Phase keys: 'plan', 'design', 'wave-<n>', 'completion'.
 */
export const PhaseCheckpointsSchema = z.record(z.string(), PhaseCheckpointSchema)
export type PhaseCheckpoints = z.infer<typeof PhaseCheckpointsSchema>

export const GateSchema = z.looseObject({
  session: z.string(),              // UUID
  motive: z.string(),               // slug
  created_at: z.string().optional(), // ISO timestamp
  advisor: z.union([AdvisorVerdictEnum, AdvisorVerdictObject]).optional(),
  verifier: z.string().optional(),
  qa: z.string().optional(),
  phases: PhaseCheckpointsSchema.optional(),
})

export type Gate = z.infer<typeof GateSchema>
