import type { AnySchema } from "ajv";

export interface TextBlock { type: "text"; text: string }
export interface ToolUseBlock { type: "tool_use"; id: string; name: string; input?: { metadata?: { kind?: string } } }
export interface ToolResultBlock { type: "tool_result"; tool_use_id: string; content?: string | { text?: string }[] }
/** Any block type the hook does not read; kept so one unknown block does not drop the line. */
export interface OtherBlock { type: string }
export type Block = TextBlock | ToolUseBlock | ToolResultBlock | OtherBlock;

export interface TranscriptEntry {
  type?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  message?: { content?: string | Block[] };
}

export interface HookInput {
  hook_event_name?: string;
  event?: string;
  transcript_path?: string;
  agent_transcript_path?: string;
  session_id?: string;
  agent_id?: string;
}

const str = { type: "string" };

const blockSchema = {
  type: "object",
  required: ["type"],
  properties: {
    type: str,
    text: str,
    id: str,
    name: str,
    tool_use_id: str,
    input: {
      type: "object",
      properties: { metadata: { type: "object", properties: { kind: str } } },
    },
    content: {
      anyOf: [str, { type: "array", items: { type: "object", properties: { text: str } } }],
    },
  },
};

export const entrySchema: AnySchema = {
  type: "object",
  properties: {
    type: str,
    isSidechain: { type: "boolean" },
    isMeta: { type: "boolean" },
    message: {
      type: "object",
      properties: { content: { anyOf: [str, { type: "array", items: blockSchema }] } },
    },
  },
};

export const hookInputSchema: AnySchema = {
  type: "object",
  properties: {
    hook_event_name: str,
    event: str,
    transcript_path: str,
    agent_transcript_path: str,
    session_id: str,
    agent_id: str,
  },
};
