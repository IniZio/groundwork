import { readFileSync } from "node:fs";
import { Ajv, type JSONSchemaType } from "ajv";

/** Fields of one transcript line the hooks read. Everything else Claude Code writes is tolerated and dropped. */
interface RawEntry {
  type?: string;
  timestamp?: string;
  cwd?: string;
}

/** The content array of an entry, either under `message` or at the top level. String content carries no blocks. */
interface RawContent {
  message?: { content?: RawBlock[] };
  content?: RawBlock[];
}

interface RawBlock {
  type: string;
  id?: string;
  name?: string;
  tool_use_id?: string;
  input?: { file_path?: string; command?: string };
}

const entrySchema: JSONSchemaType<RawEntry> = {
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

const contentSchema: JSONSchemaType<RawContent> = {
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

const ajv = new Ajv();
const isEntry = ajv.compile(entrySchema);
const hasBlocks = ajv.compile(contentSchema);

export interface ToolUseBlock {
  kind: "tool_use";
  id?: string;
  name?: string;
  filePath?: string;
  command?: string;
}

export interface ToolResultBlock {
  kind: "tool_result";
  toolUseId?: string;
}

export type TranscriptBlock = ToolUseBlock | ToolResultBlock;

export interface TranscriptEntry {
  type?: string;
  /** The raw `timestamp` string, present only when it is a non-empty string. */
  timestamp?: string;
  /** `Date.parse(timestamp)`; NaN when absent or unparseable. */
  timeMs: number;
  cwd: string;
  /** tool_use and tool_result blocks of the entry's content array, in order. */
  blocks: TranscriptBlock[];
}

function toBlock(raw: RawBlock): TranscriptBlock | null {
  if (raw.type === "tool_use") {
    return { kind: "tool_use", id: raw.id, name: raw.name, filePath: raw.input?.file_path, command: raw.input?.command };
  }
  if (raw.type === "tool_result") return { kind: "tool_result", toolUseId: raw.tool_use_id };
  return null;
}

/** One transcript line as a typed record, or null when it is not JSON or its fields have the wrong types. */
export function parseTranscriptLine(line: string): TranscriptEntry | null {
  const text = line.trim();
  if (!text) return null;
  let json: unknown;
  try { json = JSON.parse(text); } catch { return null; }
  if (!isEntry(json)) return null;

  const blocks: TranscriptBlock[] = [];
  if (hasBlocks(json)) {
    for (const item of (json.message ? json.message.content : json.content) ?? []) {
      const block = toBlock(item);
      if (block) blocks.push(block);
    }
  }
  const timestamp = json.timestamp || undefined;
  return {
    type: json.type,
    timestamp,
    timeMs: timestamp ? Date.parse(timestamp) : NaN,
    cwd: json.cwd ?? "",
    blocks,
  };
}

export function parseTranscript(raw: string): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  for (const line of raw.split("\n")) {
    const entry = parseTranscriptLine(line);
    if (entry) entries.push(entry);
  }
  return entries;
}

/** Entries of a transcript file; null when the file cannot be read. */
export function readTranscript(transcriptPath: string): TranscriptEntry[] | null {
  try { return parseTranscript(readFileSync(transcriptPath, "utf8")); } catch { return null; }
}
