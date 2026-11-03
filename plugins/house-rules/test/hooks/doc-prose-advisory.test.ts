import { describe, test, expect } from "bun:test";
import { makeRepo, runPluginHook } from "./commit-sandbox.js";

const LONG = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ") + ".";

interface WriteInput { file_path: string; content?: string; old_string?: string; new_string?: string }

function advise(repo: string, tool_name: string, tool_input: WriteInput) {
  const r = runPluginHook("PostToolUse", "doc-prose-advisory.ts", repo, { tool_name, tool_input });
  const out = r.stdout.trim() === "" ? null : JSON.parse(r.stdout).hookSpecificOutput;
  return { out, exit: r.exit };
}

describe("doc prose advisory", () => {
  test("a Write of docs/x.md with a 30-word sentence names it in additionalContext", () => {
    const repo = makeRepo({ rules: { "pr-body": "error" } });
    const r = advise(repo, "Write", { file_path: `${repo}/docs/x.md`, content: `# Title\n\n${LONG}\n` });
    expect(r.exit).toBe(0);
    expect(r.out.hookEventName).toBe("PostToolUse");
    expect(r.out.additionalContext).toContain("sentence has 30 words");
    expect(r.out.additionalContext).toContain("word0 word1");
    expect(r.out).not.toHaveProperty("permissionDecision");
  });

  test("a doc page does not need the PR headings", () => {
    const repo = makeRepo({ rules: { "pr-body": "error" } });
    expect(advise(repo, "Write", { file_path: `${repo}/doc/y.md`, content: "# Title\n\nShort.\n" }).out).toBeNull();
  });

  test("an Edit is checked on its new_string, and README.md counts", () => {
    const repo = makeRepo({ rules: { "pr-body": "error" } });
    const r = advise(repo, "Edit", { file_path: `${repo}/README.md`, old_string: "a", new_string: "One; two." });
    expect(r.out.additionalContext).toContain("semicolon");
  });

  test("a file outside doc paths, or a repo without the rule, gets no advisory", () => {
    const repo = makeRepo({ rules: { "pr-body": "error" } });
    expect(advise(repo, "Write", { file_path: `${repo}/notes/x.md`, content: LONG }).out).toBeNull();
    const off = makeRepo({ rules: {} });
    expect(advise(off, "Write", { file_path: `${off}/docs/x.md`, content: LONG }).out).toBeNull();
  });
});
