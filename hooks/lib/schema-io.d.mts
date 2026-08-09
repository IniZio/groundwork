// Type declarations for schema-io.mjs

interface AjvError {
  instancePath: string
  message?: string
  [key: string]: unknown
}

/**
 * Ajv validate function: callable as a boolean predicate with an `.errors`
 * property populated on validation failure.
 */
export interface ValidateFunction {
  (data: unknown): boolean
  errors?: AjvError[] | null
}

/**
 * Load and compile a JSON schema by name (cached).
 * Returns an Ajv validate function with `errors` on failure.
 */
export declare function loadSchema(name: string): ValidateFunction

/**
 * Convert Ajv error objects into human-readable `field: problem` lines.
 * Returns an empty array when errors is null/empty.
 */
export declare function ajvErrorsToLines(errors: object[] | null | undefined, prefix?: string): string[]
