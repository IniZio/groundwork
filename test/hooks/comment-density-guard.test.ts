import { describe, it, expect } from "bun:test";
import { check } from "../../src/hooks/comment-density-guard.js";

// 25 code lines, 0 comments — clean baseline
const CODE_25 = Array.from({ length: 25 }, (_, i) => `const v${i} = ${i};`).join("\n");

// 25 lines: 20 code + 5 comment lines → 5/25 * 100 = 20 > 5 — over-cap
const OVER_CAP_25 = [
  ...Array.from({ length: 20 }, (_, i) => `const v${i} = ${i};`),
  "// comment one",
  "// comment two",
  "// comment three",
  "// comment four",
  "// comment five",
].join("\n");

// 25 lines: 20 code + 2 exempt annotations, 1 plain comment → 1/25 * 100 = 4 ≤ 5 — clean
const WITH_ANNOTATIONS_25 = [
  ...Array.from({ length: 20 }, (_, i) => `const v${i} = ${i};`),
  "// @ts-expect-error legacy type mismatch",
  "// eslint-disable-next-line no-console",
  "// TODO(owner): remove this",
  "// https://example.com/spec",
  "// plain narration comment",
].join("\n");

// 21 lines: 20 code + 3 plain comments → 3/21 * 100 = 14.3 > 5 — over-cap
const OVER_CAP_EDIT_NEW = [
  ...Array.from({ length: 20 }, (_, i) => `const x${i} = ${i};`),
  "// narration A",
  "// narration B",
  "// narration C",
].join("\n");

function write(filePath: string, content: string) {
  return { tool_name: "Write", tool_input: { file_path: filePath, content } };
}

function edit(filePath: string, old_string: string, new_string: string) {
  return { tool_name: "Edit", tool_input: { file_path: filePath, old_string, new_string } };
}

function multiedit(filePath: string, edits: { old_string: string; new_string: string }[]) {
  return { tool_name: "MultiEdit", tool_input: { file_path: filePath, edits } };
}

function safeContext(r: { stdout: string }): string | null {
  const s = r.stdout.trim();
  if (!s) return null;
  try {
    const parsed = JSON.parse(s) as { hookSpecificOutput?: { additionalContext?: string } };
    return parsed.hookSpecificOutput?.additionalContext ?? null;
  } catch {
    return `parse-error(${s.slice(0, 80)})`;
  }
}

describe("comment-density-guard", () => {
  it("CLEAN: Write with no comments → empty stdout, exit 0", () => {
    const r = check(write("/tmp/cdg-test.ts", CODE_25));
    expect(r.stdout).toBe("");
    expect(r.exit).toBe(0);
  });

  it("VIOLATION: Write over-cap → additionalContext contains 'over-cap', exit 0", () => {
    const r = check(write("/tmp/cdg-over.ts", OVER_CAP_25));
    expect(r.exit).toBe(0);
    const ctx = safeContext(r);
    expect(ctx).not.toBeNull();
    expect(ctx!).toContain("over-cap");
    // Advisory — no permissionDecision
    const parsed = JSON.parse(r.stdout.trim()) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("permissionDecision");
    const hso = parsed.hookSpecificOutput as Record<string, unknown>;
    expect(hso).not.toHaveProperty("permissionDecision");
  });

  it("VIOLATION: printed stdout contains the file path", () => {
    const r = check(write("/tmp/cdg-pathtest.ts", OVER_CAP_25));
    expect(safeContext(r)!).toContain("cdg-pathtest.ts");
  });

  it("WHITELIST: @-tagged annotations and TODO(owner) are not counted — stays clean", () => {
    const r = check(write("/tmp/cdg-annot.ts", WITH_ANNOTATIONS_25));
    // Only 1 plain comment among 25 lines → 4/100 ≤ 5 → clean
    expect(r.stdout).toBe("");
    expect(r.exit).toBe(0);
  });

  it("WHITELIST: eslint-disable and @ts-expect-error individually exempt", () => {
    const content = [
      ...Array.from({ length: 20 }, (_, i) => `const v${i} = ${i};`),
      "// @ts-expect-error needed",
      "// eslint-disable-next-line no-unused-vars",
      "// @ts-ignore temporary",
    ].join("\n");
    const r = check(write("/tmp/cdg-eslint.ts", content));
    expect(r.stdout).toBe("");
    expect(r.exit).toBe(0);
  });

  it("VIOLATION: Edit new_string over-cap → warns", () => {
    const r = check(edit("/tmp/cdg-edit.ts", "const x = 1;", OVER_CAP_EDIT_NEW));
    expect(r.exit).toBe(0);
    expect(safeContext(r)!).toContain("over-cap");
  });

  it("CLEAN: MultiEdit new_strings under cap → empty stdout", () => {
    const r = check(multiedit("/tmp/cdg-multi.ts", [
      { old_string: "a", new_string: CODE_25 },
    ]));
    expect(r.stdout).toBe("");
    expect(r.exit).toBe(0);
  });

  it("VIOLATION: MultiEdit new_strings over cap → warns", () => {
    const r = check(multiedit("/tmp/cdg-multi-over.ts", [
      { old_string: "a", new_string: OVER_CAP_25 },
    ]));
    expect(r.exit).toBe(0);
    expect(safeContext(r)!).toContain("over-cap");
  });

  it("CLEAN: non-guarded tool (Bash) → empty stdout, exit 0", () => {
    const r = check({ tool_name: "Bash", tool_input: { command: "echo hi" } });
    expect(r.stdout).toBe("");
    expect(r.exit).toBe(0);
  });

  it("CLEAN: malformed stdin → empty stdout, exit 0", () => {
    const r = check("not-json");
    expect(r.stdout).toBe("");
    expect(r.exit).toBe(0);
  });

  it("CLEAN: kill switch (GROUNDWORK_COMMENT_DENSITY=0) → empty stdout, exit 0", () => {
    const orig = process.env.GROUNDWORK_COMMENT_DENSITY;
    process.env.GROUNDWORK_COMMENT_DENSITY = "0";
    try {
      const r = check(write("/tmp/cdg-kill.ts", OVER_CAP_25));
      expect(r.stdout).toBe("");
      expect(r.exit).toBe(0);
    } finally {
      if (orig === undefined) delete process.env.GROUNDWORK_COMMENT_DENSITY;
      else process.env.GROUNDWORK_COMMENT_DENSITY = orig;
    }
  });

  it("CLEAN: fewer than MIN_ADDED_LINES → no check, empty stdout", () => {
    // 5 lines even if 100% comments — below minimum floor
    const tiny = "// c1\n// c2\n// c3\n// c4\n// c5";
    const r = check(write("/tmp/cdg-tiny.ts", tiny));
    expect(r.stdout).toBe("");
    expect(r.exit).toBe(0);
  });

  // Bite proof: disabling the effective count breaks the VIOLATION tests
  it("BITE-PROOF: countEffective detects over-cap in OVER_CAP_25", () => {
    // If we remove all `//` detection, per100 would be 0 → allow.
    // This test verifies the detection by checking the violation fires.
    const r = check(write("/tmp/cdg-bite.ts", OVER_CAP_25));
    const ctx = safeContext(r);
    expect(ctx).not.toBeNull();
    // Must cite line numbers (proof detection ran)
    expect(ctx!).toMatch(/\[[\d,]+\]/);
  });
});
