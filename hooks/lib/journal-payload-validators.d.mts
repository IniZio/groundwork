// Type declarations for journal-payload-validators.mjs

/**
 * Payload validator table for journal append events.
 * Each entry receives the parsed data object (or {}) and returns an error string or null.
 * Types absent from this map accept any payload.
 */
export declare const APPEND_PAYLOAD_VALIDATORS: Map<string, (data: Record<string, unknown>) => string | null>
