import { describe, expect, it } from "bun:test";
import { readHookInput } from "../../src/hooks/lib/hook-input.js";

describe("readHookInput", () => {
  it("reads a valid payload", () => {
    const got = readHookInput(JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      tool_input: { file_path: "/a.ts", old_string: "x", new_string: "y", replace_all: true },
      transcript_path: "/t.jsonl",
      cwd: "/repo",
    }));
    expect(got.hook_event_name).toBe("PreToolUse");
    expect(got.tool_input?.file_path).toBe("/a.ts");
    expect(got.tool_input?.replace_all).toBe(true);
    expect(got.cwd).toBe("/repo");
  });

  it("leaves hook_event_name absent when the payload omits it", () => {
    const got = readHookInput(JSON.stringify({ tool_name: "Bash", cwd: "/repo" }));
    expect(got.hook_event_name).toBeUndefined();
    expect(got.tool_name).toBe("Bash");
  });

  it("reads a wrong-typed tool_input as absent and keeps the other fields", () => {
    const got = readHookInput(JSON.stringify({ tool_name: "Edit", tool_input: "oops", cwd: "/repo" }));
    expect(got.tool_input).toBeUndefined();
    expect(got.tool_name).toBe("Edit");
    expect(got.cwd).toBe("/repo");
    expect(readHookInput(JSON.stringify({ tool_input: ["a"] })).tool_input).toBeUndefined();
  });

  it("reads one wrong-typed tool_input field as absent and keeps its siblings", () => {
    const got = readHookInput(JSON.stringify({ tool_input: { file_path: 5, content: "c" } }));
    expect(got.tool_input?.file_path).toBeUndefined();
    expect(got.tool_input?.content).toBe("c");
  });

  it("reads null fields as absent", () => {
    const got = readHookInput(JSON.stringify({ cwd: null, tool_input: { command: null } }));
    expect(got.cwd).toBeUndefined();
    expect(got.tool_input?.command).toBeUndefined();
    expect("cwd" in got).toBe(false);
  });

  it("drops a malformed edits list as a whole", () => {
    const got = readHookInput(JSON.stringify({ tool_input: { edits: [{ old_string: "a" }], file_path: "/a" } }));
    expect(got.tool_input?.edits).toBeUndefined();
    expect(got.tool_input?.file_path).toBe("/a");
  });

  it("keeps the valid background_tasks entries when one is malformed", () => {
    const got = readHookInput(JSON.stringify({
      background_tasks: [
        { id: "a1", status: "running", type: "subagent" },
        { id: 7, status: "running" },
        { id: "a2", status: "running" },
      ],
    }));
    expect(got.background_tasks).toEqual([
      { id: "a1", status: "running", type: "subagent" },
      { id: "a2", status: "running" },
    ]);
  });

  it("keeps unknown tool_input fields and drops unknown payload fields", () => {
    const got = readHookInput(JSON.stringify({ tool_name: "Write", brand_new_field: { a: 1 }, tool_input: { content: "c", future: 1 } }));
    expect(got).toMatchObject({ tool_input: { content: "c", future: 1 } });
    expect("brand_new_field" in got).toBe(false);
  });

  it("yields an empty payload for text that is not a JSON object", () => {
    for (const bad of ["null", "\"x\"", "3", "[1]", "not json", ""]) expect(readHookInput(bad)).toEqual({});
  });
});
