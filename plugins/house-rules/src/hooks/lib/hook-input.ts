import { Ajv, type JSONSchemaType } from "ajv";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

export interface EditItem {
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

/** One entry of the Stop payload's background_tasks list. */
export interface BackgroundTask {
  id?: string;
  status?: string;
  type?: string;
}

/**
 * The tool_input fields the hooks read. Other fields the tool carried are kept verbatim,
 * because guard.ts echoes tool_input back as updatedInput, which replaces the tool's input.
 */
export interface ToolInput {
  file_path?: string;
  content?: string;
  old_string?: string;
  new_string?: string;
  replace_all?: boolean;
  command?: string;
  edits?: EditItem[];
  [extra: string]: JsonValue | EditItem[] | undefined;
}

/** The payload fields the hooks read. A field that is absent, null or the wrong type is absent here. */
export interface HookInput {
  hook_event_name?: string;
  event?: string;
  tool_name?: string;
  tool_input?: ToolInput;
  transcript_path?: string;
  agent_transcript_path?: string;
  session_id?: string;
  agent_id?: string;
  cwd?: string;
  background_tasks?: BackgroundTask[];
}

const editItemSchema: JSONSchemaType<EditItem> = {
  type: "object",
  properties: {
    old_string: { type: "string" },
    new_string: { type: "string" },
    replace_all: { type: "boolean", nullable: true },
  },
  required: ["old_string", "new_string"],
};

const backgroundTaskSchema: JSONSchemaType<BackgroundTask> = {
  type: "object",
  properties: {
    id: { type: "string", nullable: true },
    status: { type: "string", nullable: true },
    type: { type: "string", nullable: true },
  },
};

const editsSchema: JSONSchemaType<EditItem[]> = { type: "array", items: editItemSchema };

const ajv = new Ajv();
const isJsonObject = ajv.compile<JsonObject>({ type: "object" });
const isString = ajv.compile<string>({ type: "string" });
const isBoolean = ajv.compile<boolean>({ type: "boolean" });
const isBackgroundTask = ajv.compile(backgroundTaskSchema);
const isEdits = ajv.compile(editsSchema);

const PAYLOAD_STRINGS = [
  "hook_event_name", "event", "tool_name", "transcript_path",
  "agent_transcript_path", "session_id", "agent_id", "cwd",
] as const;
const TOOL_STRINGS = ["file_path", "content", "old_string", "new_string", "command"] as const;
const TOOL_KNOWN = new Set<string>([...TOOL_STRINGS, "replace_all", "edits"]);

/** A malformed edits list reads as absent as a whole: guard.ts applies and rewrites the full list, so a partial one would misstate the edit. */
function readToolInput(raw: JsonObject): ToolInput {
  const out: ToolInput = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!TOOL_KNOWN.has(key)) out[key] = value;
  }
  for (const key of TOOL_STRINGS) {
    const value = raw[key];
    if (isString(value)) out[key] = value;
  }
  if (isBoolean(raw.replace_all)) out.replace_all = raw.replace_all;
  if (isEdits(raw.edits)) out.edits = raw.edits;
  return out;
}

function readPayload(raw: JsonObject): HookInput {
  const out: HookInput = {};
  for (const key of PAYLOAD_STRINGS) {
    const value = raw[key];
    if (isString(value)) out[key] = value;
  }
  if (isJsonObject(raw.tool_input)) out.tool_input = readToolInput(raw.tool_input);
  if (Array.isArray(raw.background_tasks)) {
    out.background_tasks = [];
    for (const task of raw.background_tasks) if (isBackgroundTask(task)) out.background_tasks.push(task);
  }
  return out;
}

/** Parse one hook stdin payload. Text that is not a JSON object yields an empty payload. */
export function readHookInput(text: string): HookInput {
  let raw: JsonValue;
  try { raw = JSON.parse(text); } catch { return {}; }
  return isJsonObject(raw) ? readPayload(raw) : {};
}
