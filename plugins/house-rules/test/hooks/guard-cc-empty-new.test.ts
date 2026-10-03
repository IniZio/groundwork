import { describe, it, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { check } from "../../src/hooks/guard.js";
import type { Rule } from "../../src/engine/types.js";

type E = { old_string: string; new_string: string; replace_all?: boolean };

// Claude Code's Edit apply: empty new_string also swallows the newline after old_string.
function ccApply(text: string, e: E): string {
  let old = e.old_string;
  if (e.new_string === "" && !old.endsWith("\n") && text.includes(old + "\n")) old += "\n";
  if (!text.includes(old)) throw new Error("old_string not found");
  return e.replace_all ? text.split(old).join(e.new_string) : text.replace(old, () => e.new_string);
}

const LINES = [
  'import { x } from "./y";',
  "",
  "export const a = 1;",
  "export const b = 2;",
  "export const c = 3;",
  "export const d = 4;",
  "export const e = 5;",
  "export const f = 6;",
  "export const g = 7;",
  "",
  "// herdr lays worktrees at ~/.herdr/worktrees/<project>/<name>; nexus names the",
  "// bound sandbox <project>/<name>, and virtiofs shows it at the same path.",
  "export function sandboxRefFor(worktree: string): string | undefined {",
  "  return worktree ? x(worktree) : undefined;",
  "}",
];
const PRE = LINES.join("\n") + "\n";
const MID = LINES[11];
const MID_NEW = "// bound sandbox <project>/<name>; the guest mounts it writable at /workspace.";
const BAD_JOIN = /(?:\/\/[^\n]*)export function/;

// Deterministic stripper: removes every whole-line comment the edit added, newline included.
const STRIP: Rule = {
  id: "test-strip-added-comment",
  editCheck: async (edit: any) => {
    const edits: Array<{ start: number; end: number; text: string }> = [];
    for (const m of edit.post.matchAll(/\n\/\/ (?:bound sandbox [^\n]*|herdr lays worktrees somewhere[^\n]*)/g)) {
      if (!edit.pre.includes(m[0].slice(1))) edits.push({ start: m.index!, end: m.index! + m[0].length, text: "" });
    }
    return { findings: [], edits };
  },
} as unknown as Rule;

// Strips only the comment text, leaving the (now blank) line in place.
const STRIP_TEXT: Rule = {
  id: "test-strip-comment-text",
  editCheck: async (edit: any) => {
    const edits: Array<{ start: number; end: number; text: string }> = [];
    for (const m of edit.post.matchAll(/\/\/ bound sandbox (?:gone|one|two)/g)) {
      edits.push({ start: m.index!, end: m.index! + m[0].length, text: "" });
    }
    return { findings: [], edits };
  },
} as unknown as Rule;

async function run(tool: string, tool_input: Record<string, unknown>, content = PRE, rule: Rule = STRIP) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "guard-ccempty-"));
  const fp = path.join(dir, "sandbox.ts");
  writeFileSync(fp, content);
  try {
    const r = await check({ tool_name: tool, cwd: dir, tool_input: { file_path: fp, ...tool_input } }, { rules: [rule] });
    const hso = r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput : {};
    return { hso, fp };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function expectSafe(hso: any, apply: (ti: any) => string, content = PRE) {
  expect(hso.permissionDecision).toBeUndefined();
  const ti = hso.updatedInput;
  expect(ti).toBeDefined();
  const out = apply(ti);
  expect(out).not.toMatch(BAD_JOIN);
  expect(out).toContain("\nexport function sandboxRefFor");
  expect(out.split("\n").length).toBeGreaterThanOrEqual(content.split("\n").length - 2);
}

describe("guard vs Claude Code empty-new_string newline rule", () => {
  it("Edit: strip middle line of 2-line comment block never joins lines", async () => {
    const { hso } = await run("Edit", { old_string: MID, new_string: MID_NEW });
    expectSafe(hso, (ti) => ccApply(PRE, ti));
    expect(hso.updatedInput).toBeDefined();
    expect(ccApply(PRE, hso.updatedInput)).toBe([...LINES.slice(0, 11), ...LINES.slice(12)].join("\n") + "\n");
  });

  // Code line swapped for a comment: the stripper leaves the line blank, so new_string becomes "".
  const G = LINES[8];
  const F = LINES[7];
  const BLANKED = [...LINES.slice(0, 7), ...(["", ""]), ...LINES.slice(9)].join("\n") + "\n";
  const ONLY_G = [...LINES.slice(0, 8), "", ...LINES.slice(9)].join("\n") + "\n";

  it("replace_all: code line swapped for stripped comment keeps the line break", async () => {
    const { hso } = await run("Edit", { old_string: G, new_string: "// bound sandbox gone", replace_all: true }, PRE, STRIP_TEXT);
    expect(hso.permissionDecision).toBeUndefined();
    expect(hso.updatedInput).toBeDefined();
    expect(ccApply(PRE, hso.updatedInput)).toBe(ONLY_G);
  });

  it("MultiEdit: code line swapped for stripped comment keeps the line break", async () => {
    const { hso } = await run("MultiEdit", { edits: [{ old_string: G, new_string: "// bound sandbox gone" }] }, PRE, STRIP_TEXT);
    expect(hso.permissionDecision).toBeUndefined();
    expect(hso.updatedInput).toBeDefined();
    expect(hso.updatedInput.edits.reduce((t: string, e: E) => ccApply(t, e), PRE)).toBe(ONLY_G);
  });

  it("MultiEdit: two stripped edits keep both line breaks", async () => {
    const { hso } = await run("MultiEdit", {
      edits: [{ old_string: F, new_string: "// bound sandbox one" }, { old_string: G, new_string: "// bound sandbox two" }],
    }, PRE, STRIP_TEXT);
    expect(hso.permissionDecision).toBeUndefined();
    expect(hso.updatedInput).toBeDefined();
    expect(hso.updatedInput.edits.reduce((t: string, e: E) => ccApply(t, e), PRE)).toBe(BLANKED);
  });

  it("Edit with replace_all=false: same swap keeps the line break", async () => {
    const { hso } = await run("Edit", { old_string: G, new_string: "// bound sandbox gone" }, PRE, STRIP_TEXT);
    expect(hso.permissionDecision).toBeUndefined();
    expect(hso.updatedInput).toBeDefined();
    expect(ccApply(PRE, hso.updatedInput)).toBe(ONLY_G);
  });

  // Real comment-density rule: a genuinely new whole-line comment is stripped, newline and all.
  const EXTRA = LINES[11] + "\n// extra narration comment";
  const EXPECT_REAL = PRE;
  async function real(tool: string, ti: Record<string, unknown>) {
    const dir = mkdtempSync(path.join(os.tmpdir(), "guard-ccempty-real-"));
    const fp = path.join(dir, "sandbox.ts");
    writeFileSync(fp, PRE);
    try {
      const r = await check({ tool_name: tool, cwd: dir, tool_input: { file_path: fp, ...ti } });
      return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput : {};
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("real rule: Edit adding a comment line before export never joins lines", async () => {
    const hso = await real("Edit", { old_string: LINES[11], new_string: EXTRA });
    expectSafe(hso, (ti) => ccApply(PRE, ti));
    expect(hso.updatedInput).toBeDefined();
    expect(ccApply(PRE, hso.updatedInput)).toBe(EXPECT_REAL);
  });

  it("real rule: replace_all adding a comment line never joins lines", async () => {
    const hso = await real("Edit", { old_string: LINES[11], new_string: EXTRA, replace_all: true });
    expectSafe(hso, (ti) => ccApply(PRE, ti));
  });

  it("real rule: MultiEdit adding a comment line never joins lines", async () => {
    const hso = await real("MultiEdit", { edits: [{ old_string: LINES[11], new_string: EXTRA }] });
    expectSafe(hso, (ti) => ti.edits.reduce((t: string, e: E) => ccApply(t, e), PRE));
  });

  it("unfixable CC mismatch: advisory passthrough, not deny, no rewrite", async () => {
    const content = "foo\nfoo;\n";
    const NOTICE = "test notice: stripped";
    const rule = {
      id: "test-strip-mismatch",
      editCheck: async (edit: any) => {
        const edits: Array<{ start: number; end: number; text: string }> = [];
        for (const m of edit.post.matchAll(/\/\/ bound sandbox gone/g)) {
          edits.push({ start: m.index!, end: m.index! + m[0].length, text: "" });
        }
        return { findings: [], edits, notice: NOTICE };
      },
    } as unknown as Rule;
    const { hso } = await run("Edit", { old_string: "foo", new_string: "// bound sandbox gone", replace_all: true }, content, rule);
    expect(hso.permissionDecision).toBeUndefined();
    expect(hso.updatedInput).toBeUndefined();
    expect(hso.additionalContext).toContain(NOTICE);
  });
});
