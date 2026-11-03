import { readFileSync } from "node:fs";
import { hasBlocks, isEntry } from "./generated/transcript-validators.mjs";
import type { RawBlock } from "./transcript-schemas.js";

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
