import { Ajv, type JSONSchemaType } from "ajv";

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

/** The tool_input fields the hooks read. Anything else the tool carried is kept as-is. */
export interface ToolInput {
  file_path?: string;
  content?: string;
  old_string?: string;
  new_string?: string;
  replace_all?: boolean;
  command?: string;
  edits?: EditItem[];
}

/** The payload fields the hooks read. A field that is absent or the wrong type is absent here; unknown fields are tolerated. */
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
  additionalProperties: true,
};

const toolInputSchema: JSONSchemaType<ToolInput> = {
  type: "object",
  properties: {
    file_path: { type: "string", nullable: true },
    content: { type: "string", nullable: true },
    old_string: { type: "string", nullable: true },
    new_string: { type: "string", nullable: true },
    replace_all: { type: "boolean", nullable: true },
    command: { type: "string", nullable: true },
    edits: { type: "array", nullable: true, items: editItemSchema },
  },
  additionalProperties: true,
};

const inputSchema: JSONSchemaType<HookInput> = {
  type: "object",
  properties: {
    hook_event_name: { type: "string", nullable: true },
    event: { type: "string", nullable: true },
    tool_name: { type: "string", nullable: true },
    tool_input: { ...toolInputSchema, nullable: true },
    transcript_path: { type: "string", nullable: true },
    agent_transcript_path: { type: "string", nullable: true },
    session_id: { type: "string", nullable: true },
    agent_id: { type: "string", nullable: true },
    cwd: { type: "string", nullable: true },
    background_tasks: {
      type: "array",
      nullable: true,
      items: {
        type: "object",
        properties: {
          id: { type: "string", nullable: true },
          status: { type: "string", nullable: true },
          type: { type: "string", nullable: true },
        },
        additionalProperties: true,
      },
    },
  },
  additionalProperties: true,
};

const ajv = new Ajv({ allErrors: true });
const isObject = ajv.compile<object>({ type: "object" });
const validate = ajv.compile(inputSchema);

/** Remove the offending field so one bad field reads as absent without discarding the rest of the payload. */
function dropFailingFields(data: HookInput): void {
  for (const err of validate.errors ?? []) {
    const segments = err.instancePath.split("/").slice(1);
    const editsAt = segments.indexOf("edits");
    const whole = segments[0] === "background_tasks" ? 1 : editsAt === -1 ? segments.length : editsAt + 1;
    const path = segments.slice(0, whole);
    if (path.length === 1) Reflect.deleteProperty(data, path[0]);
    else if (path.length === 2 && data.tool_input) Reflect.deleteProperty(data.tool_input, path[1]);
  }
}

/** JSON `null` for a field reads as absent. */
function dropNulls(value: object): void {
  for (const [key, v] of Object.entries(value)) {
    if (v === null) Reflect.deleteProperty(value, key);
  }
}

/** Parse one hook payload. Anything that is not a JSON object yields an empty payload. */
export function hookInput(raw: unknown): HookInput {
  if (!isObject(raw) || Array.isArray(raw)) return {};
  const data: HookInput = { ...raw };
  dropNulls(data);
  if (isObject(data.tool_input) && !Array.isArray(data.tool_input)) {
    data.tool_input = { ...data.tool_input };
    dropNulls(data.tool_input);
  }
  if (!validate(data)) {
    dropFailingFields(data);
    validate(data);
  }
  return data;
}

/** Parse stdin text to JSON; text that is not JSON yields an empty payload. */
export function parseJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return {}; }
}
