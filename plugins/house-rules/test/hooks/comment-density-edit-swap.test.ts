import { describe, it, expect } from "bun:test";
import { commentDensityEditCheck } from "../../rules/comment-density/edit-check.js";
import { reconstructPostEdit } from "../../src/hooks/lib/comment-density.js";
import { getParser } from "../../src/hooks/lib/tree-sitter-loader.js";
import { parserForPath } from "../../src/hooks/languages/parse.js";
import { diffTextToHunks } from "../../src/hooks/lib/work-scope.js";
import type { PendingEdit, EditCheckEnv } from "../../src/engine/types.js";

async function run(pre: string, oldStr: string, newStr: string, withSession = false) {
  const r = reconstructPostEdit("Edit", { file_path: "/tmp/x.ts", old_string: oldStr, new_string: newStr }, pre);
  if (!r) throw new Error("reconstruct failed");
  const edit: PendingEdit = {
    path: "/tmp/x.ts",
    tool: "edit",
    lang: "typescript",
    pre,
    post: r.post,
    changedRows: r.changedRows,
    session: withSession
      ? { commit: "x", addedRows: [], baseText: pre, preHunks: diffTextToHunks(pre, pre), postHunks: diffTextToHunks(pre, r.post) }
      : null,
    repoRoot: null,
    cwd: null,
  };
  const env = { parserFactory: parserForPath(getParser, "x.ts"), sourceFile: async () => null } as unknown as EditCheckEnv;
  return commentDensityEditCheck(edit, env);
}

describe("comment-density edit-check net-new accounting", () => {
  it("1:1 comment swap in a budget-0 file is kept", async () => {
    const pre = "const a = 1;\n// bound sandbox <project>/<name>, and virtiofs shows it at the same path.\nconst b = 2;\n";
    const res = await run(
      pre,
      "// bound sandbox <project>/<name>, and virtiofs shows it at the same path.",
      "// bound sandbox <project>/<name>; the guest mounts it writable at /workspace.",
    );
    expect(res.edits).toBeUndefined();
  });

  it("2-line block edited into 2 different lines is 0 net-new", async () => {
    const pre = "const a = 1;\n// first old line\n// second old line\nconst b = 2;\n";
    const res = await run(pre, "// first old line\n// second old line", "// first new line\n// second new line");
    expect(res.edits).toBeUndefined();
  });

  it("1 comment replaced by 2 is still enforced (net-new 1)", async () => {
    const pre = "const a = 1;\n// old line\nconst b = 2;\n";
    const res = await run(pre, "// old line", "// new line one\n// new line two");
    expect(res.edits).toBeDefined();
    expect(res.edits![0].text).toContain("new line one");
    expect(res.edits![0].text).not.toContain("new line two");
  });

  it("code-only old_string plus an added comment is enforced", async () => {
    const pre = "const a = 1;\nconst b = 2;\n";
    const res = await run(pre, "const b = 2;", "// why b\nconst b = 2;");
    expect(res.edits).toBeDefined();
    expect(res.edits![0].text).not.toContain("why b");
  });

  it("session path: 1 replaced by 2 keeps the swap, strips the extra", async () => {
    const pre = "const a = 1;\n// alpha old words here\nconst b = 2;\n";
    const res = await run(pre, "// alpha old words here", "// beta new text\n// gamma extra narration", true);
    expect(res.edits).toBeDefined();
    expect(res.edits![0].text).toContain("beta new text");
    expect(res.edits![0].text).not.toContain("gamma extra");
  });

  it("session path: pure swap is kept", async () => {
    const pre = "const a = 1;\n// alpha old words here\nconst b = 2;\n";
    const res = await run(pre, "// alpha old words here", "// beta new text", true);
    expect(res.edits).toBeUndefined();
  });

  it("non-session extra comment ABOVE the edited one: edited survives, extra stripped", async () => {
    const pre = "const a = 1;\n// compute the user total here\nconst b = 2;\n";
    const res = await run(pre, "// compute the user total here", "// narration extra stuff\n// compute the user total now");
    expect(res.edits).toBeDefined();
    expect(res.edits![0].text).toContain("compute the user total now");
    expect(res.edits![0].text).not.toContain("narration extra stuff");
  });

  it("over-budget pure swap in a many-comment file is kept", async () => {
    const pre = "const a = 1;\n// one\n// two\n// three\n// alpha old words here\nconst b = 2;\n";
    const res = await run(pre, "// alpha old words here", "// beta new text", true);
    expect(res.edits).toBeUndefined();
  });
});
