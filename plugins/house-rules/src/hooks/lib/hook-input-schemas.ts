import type { JSONSchemaType } from "ajv";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

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

export type Edits = EditItem[];
export type JsonString = string;
export type JsonBoolean = boolean;

export const jsonObjectSchema: JSONSchemaType<JsonObject> = { type: "object" } as JSONSchemaType<JsonObject>;
export const stringSchema: JSONSchemaType<JsonString> = { type: "string" };
export const booleanSchema: JSONSchemaType<JsonBoolean> = { type: "boolean" };

export const backgroundTaskSchema: JSONSchemaType<BackgroundTask> = {
  type: "object",
  properties: {
    id: { type: "string", nullable: true },
    status: { type: "string", nullable: true },
    type: { type: "string", nullable: true },
  },
};

const editItemSchema: JSONSchemaType<EditItem> = {
  type: "object",
  properties: {
    old_string: { type: "string" },
    new_string: { type: "string" },
    replace_all: { type: "boolean", nullable: true },
  },
  required: ["old_string", "new_string"],
};

export const editsSchema: JSONSchemaType<Edits> = { type: "array", items: editItemSchema };
