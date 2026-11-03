import type { JSONSchemaType } from "ajv";

export interface Pr {
  number: number;
  title: string;
  mergeable: string;
  baseRefName: string;
  url: string;
}

export const prListSchema: JSONSchemaType<Pr[]> = {
  type: "array",
  items: {
    type: "object",
    properties: {
      number: { type: "integer" },
      title: { type: "string" },
      mergeable: { type: "string" },
      baseRefName: { type: "string" },
      url: { type: "string" },
    },
    required: ["number", "title", "mergeable", "baseRefName", "url"],
    additionalProperties: true,
  },
};
