// Type declarations for pacing.mjs

export interface PacingGrant {
  range: number
  granted_at: string
  granted_by: string
  reason?: string
}

export interface Pacing {
  policy: string
  budget: number
  exempt_kinds: string[]
  grant?: PacingGrant
}

export declare function resolveUnit(doc: object, sliceId: string): number | string | null

export declare function resolvedUnits(doc: object): number

export declare function inFlightUnit(doc: object): number | string | null

export declare function isExhausted(doc: object): boolean

export declare function checkPace(
  doc: object,
  sliceId: string,
): { allowed: boolean; reason?: string; remedy?: string }
