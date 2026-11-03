import type { JSONSchemaType } from "ajv";

/** Fields of one transcript line the hooks read. Everything else Claude Code writes is tolerated and dropped. */
export interface RawEntry {
  type?: string;
  timestamp?: string;
  cwd?: string;
}

/** The content array of an entry, either under `message` or at the top level. String content carries no blocks. */
export interface RawContent {
  message?: { content?: RawBlock[] };
  content?: RawBlock[];
}

export interface RawBlock {
  type: string;
  id?: string;
  name?: string;
  tool_use_id?: string;
  input?: { file_path?: string; command?: string };
}

export const entrySchema: JSONSchemaType<RawEntry> = {
  type: "object",
  properties: {
    type: { type: "string", nullable: true },
    timestamp: { type: "string", nullable: true },
    cwd: { type: "string", nullable: true },
  },
  additionalProperties: true,
};

const blockSchema: JSONSchemaType<RawBlock> = {
  type: "object",
  properties: {
    type: { type: "string" },
    id: { type: "string", nullable: true },
    name: { type: "string", nullable: true },
    tool_use_id: { type: "string", nullable: true },
    input: {
      type: "object",
      nullable: true,
      properties: {
        file_path: { type: "string", nullable: true },
        command: { type: "string", nullable: true },
      },
      additionalProperties: true,
    },
  },
  required: ["type"],
  additionalProperties: true,
};

export const contentSchema: JSONSchemaType<RawContent> = {
  type: "object",
  properties: {
    message: {
      type: "object",
      nullable: true,
      properties: { content: { type: "array", nullable: true, items: blockSchema } },
      additionalProperties: true,
    },
    content: { type: "array", nullable: true, items: blockSchema },
  },
  additionalProperties: true,
};
