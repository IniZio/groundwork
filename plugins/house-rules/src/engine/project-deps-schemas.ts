import type { JSONSchemaType } from "ajv";

/** The fields of a package.json the engine reads. Everything else is tolerated. */
export interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const dependencyMap = {
  type: "object",
  nullable: true,
  required: [],
  additionalProperties: { type: "string" },
} as const;

export const manifestSchema: JSONSchemaType<Manifest> = {
  type: "object",
  properties: { dependencies: dependencyMap, devDependencies: dependencyMap },
  additionalProperties: true,
};
