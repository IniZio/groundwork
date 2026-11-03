import { describe, expect, test } from "bun:test";
import { parseTranscript, parseTranscriptLine } from "../../src/hooks/lib/transcript.js";

const line = JSON.stringify;

describe("parseTranscriptLine", () => {
  test("a valid assistant entry becomes a typed record", () => {
    const entry = parseTranscriptLine(
      line({
        type: "assistant",
        timestamp: "2026-01-02T03:04:05.000Z",
        cwd: "/repo",
        message: {
          content: [
            { type: "text", text: "hi" },
            { type: "tool_use", id: "t1", name: "Write", input: { file_path: "/repo/a.ts", content: "x" } },
            { type: "tool_use", id: "t2", name: "Bash", input: { command: "ls" } },
          ],
        },
      }),
    );
    expect(entry).toEqual({
      type: "assistant",
      timestamp: "2026-01-02T03:04:05.000Z",
      timeMs: Date.parse("2026-01-02T03:04:05.000Z"),
      cwd: "/repo",
      blocks: [
        { kind: "tool_use", id: "t1", name: "Write", filePath: "/repo/a.ts", command: undefined },
        { kind: "tool_use", id: "t2", name: "Bash", filePath: undefined, command: "ls" },
      ],
    });
  });

  test("a tool_result block carries its tool_use_id", () => {
    const entry = parseTranscriptLine(line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1" }] } }));
    expect(entry?.blocks).toEqual([{ kind: "tool_result", toolUseId: "t1" }]);
  });

  test("content at the top level is read when there is no message", () => {
    const entry = parseTranscriptLine(line({ type: "assistant", content: [{ type: "tool_use", name: "Edit", input: { file_path: "/a" } }] }));
    expect(entry?.blocks[0]).toMatchObject({ kind: "tool_use", name: "Edit", filePath: "/a" });
  });

  test("string content yields an entry with no blocks and keeps its timestamp", () => {
    const entry = parseTranscriptLine(line({ type: "user", timestamp: "2026-01-02T03:04:05Z", message: { content: "hello" } }));
    expect(entry?.blocks).toEqual([]);
    expect(entry?.timeMs).toBe(Date.parse("2026-01-02T03:04:05Z"));
  });

  test("unknown extra fields are tolerated", () => {
    const entry = parseTranscriptLine(
      line({ type: "assistant", futureField: { a: 1 }, message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", novel: true, input: { command: "ls", timeout: 5 } }] } }),
    );
    expect(entry?.blocks).toEqual([{ kind: "tool_use", id: undefined, name: "Bash", filePath: undefined, command: "ls" }]);
  });

  test("malformed JSON, non-objects and blank lines are skipped", () => {
    expect(parseTranscriptLine("{not json")).toBeNull();
    expect(parseTranscriptLine("[1,2]")).toBeNull();
    expect(parseTranscriptLine("42")).toBeNull();
    expect(parseTranscriptLine("   ")).toBeNull();
  });

  test("a wrong-typed field skips the entry", () => {
    expect(parseTranscriptLine(line({ type: "assistant", timestamp: 12345 }))).toBeNull();
    expect(parseTranscriptLine(line({ type: 7 }))).toBeNull();
    expect(parseTranscriptLine(line({ type: "assistant", message: { content: [{ type: "tool_use", name: 5 }] } }))).toBeNull;
  });

  test("a wrong-typed block field drops the entry's blocks but keeps the entry", () => {
    const entry = parseTranscriptLine(line({ type: "assistant", timestamp: "2026-01-02T03:04:05Z", message: { content: [{ type: "tool_use", name: 5 }] } }));
    expect(entry?.blocks).toEqual([]);
    expect(entry?.type).toBe("assistant");
  });

  test("an unparseable timestamp string gives NaN milliseconds", () => {
    const entry = parseTranscriptLine(line({ type: "user", timestamp: "garbage" }));
    expect(entry?.timestamp).toBe("garbage");
    expect(entry?.timeMs).toBeNaN();
  });
});

describe("parseTranscript", () => {
  test("keeps valid lines in order and skips bad ones", () => {
    const raw = [line({ type: "user" }), "oops", "", line({ type: "assistant" })].join("\n");
    expect(parseTranscript(raw).map((e) => e.type)).toEqual(["user", "assistant"]);
  });
});
