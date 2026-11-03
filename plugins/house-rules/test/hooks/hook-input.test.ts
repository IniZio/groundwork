import { describe, expect, it } from "bun:test";
import { hookInput, parseJson } from "../../src/hooks/lib/hook-input.js";

describe("hookInput", () => {
  it("reads a valid payload", () => {
    const got = hookInput({
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      tool_input: { file_path: "/a.ts", old_string: "x", new_string: "y", replace_all: true },
      transcript_path: "/t.jsonl",
      cwd: "/repo",
    });
    expect(got.hook_event_name).toBe("PreToolUse");
    expect(got.tool_input?.file_path).toBe("/a.ts");
    expect(got.tool_input?.replace_all).toBe(true);
    expect(got.cwd).toBe("/repo");
  });

  it("leaves hook_event_name absent when the payload omits it", () => {
    const got = hookInput({ tool_name: "Bash", cwd: "/repo" });
    expect(got.hook_event_name).toBeUndefined();
    expect(got.tool_name).toBe("Bash");
  });

  it("reads a wrong-typed tool_input as absent and keeps the other fields", () => {
    const got = hookInput({ tool_name: "Edit", tool_input: "oops", cwd: "/repo" });
    expect(got.tool_input).toBeUndefined();
    expect(got.tool_name).toBe("Edit");
    expect(got.cwd).toBe("/repo");
    expect(hookInput({ tool_input: ["a"] }).tool_input).toBeUndefined();
  });

  it("reads one wrong-typed tool_input field as absent and keeps its siblings", () => {
    const got = hookInput({ tool_input: { file_path: 5, content: "c" } });
    expect(got.tool_input?.file_path).toBeUndefined();
    expect(got.tool_input?.content).toBe("c");
  });

  it("reads null fields as absent", () => {
    const got = hookInput({ cwd: null, tool_input: { command: null } });
    expect(got.cwd).toBeUndefined();
    expect(got.tool_input?.command).toBeUndefined();
  });

  it("drops a malformed edits list as a whole", () => {
    const got = hookInput({ tool_input: { edits: [{ old_string: "a" }], file_path: "/a" } });
    expect(got.tool_input?.edits).toBeUndefined();
    expect(got.tool_input?.file_path).toBe("/a");
  });

  it("keeps unknown extra fields", () => {
    const got = hookInput({ tool_name: "Write", brand_new_field: { a: 1 }, tool_input: { content: "c", future: 1 } });
    expect(got).toMatchObject({ brand_new_field: { a: 1 }, tool_input: { content: "c", future: 1 } });
  });

  it("yields an empty payload for anything that is not an object", () => {
    for (const bad of [null, undefined, "x", 3, [1]]) expect(hookInput(bad)).toEqual({});
  });
});

describe("parseJson", () => {
  it("parses JSON text and yields an empty payload for invalid text", () => {
    expect(parseJson('{"cwd":"/r"}')).toEqual({ cwd: "/r" });
    expect(parseJson("not json")).toEqual({});
  });
});
