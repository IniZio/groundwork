import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateReadme, checkAll, generateAll } from "../../scripts/gen-rule-readmes.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hr-readme-test-"));
}

function writeStubRule(
  rulesDir: string,
  ruleId: string,
  opts: {
    valid?: Array<{ why: string; code?: string; filename?: string }>;
    invalid?: Array<{ why: string; code?: string; filename?: string; findings?: Array<{ message?: string }> }>;
  } = {},
): string {
  const ruleDir = path.join(rulesDir, ruleId);
  fs.mkdirSync(ruleDir, { recursive: true });

  // index.ts — plain object export, no cross-module imports so dynamic import works in tmp
  const indexContent = `
const rule = {
  id: '${ruleId}',
  meta: { description: 'A stub rule for testing.' },
  vehicles: ['diff'],
  check: () => [],
};
export default rule;
`;
  fs.writeFileSync(path.join(ruleDir, "index.ts"), indexContent, "utf8");

  // cases.ts
  const valid = opts.valid ?? [{ why: "valid case why", code: "const x = 1;", filename: "foo.ts" }];
  const invalid = opts.invalid ?? [
    { why: "invalid case why", code: "let y;", filename: "bar.ts", findings: [{ message: "no bare let" }] },
  ];

  const casesContent = `export const cases = ${JSON.stringify({ valid, invalid }, null, 2)};\n`;
  fs.writeFileSync(path.join(ruleDir, "cases.ts"), casesContent, "utf8");

  return ruleDir;
}

// ---------------------------------------------------------------------------
// AC #1: README content structure
// ---------------------------------------------------------------------------

describe("generateReadme", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("includes generated-file banner, id, description, and case whys", async () => {
    const ruleDir = writeStubRule(tmpDir, "stub-rule");
    const readme = await generateReadme(ruleDir, "stub-rule");

    expect(readme).toContain("<!-- This file is generated. Do not edit manually. -->");
    expect(readme).toContain("# stub-rule");
    expect(readme).toContain("A stub rule for testing.");
    // stub-rule is not in BUILTIN_POLICY
    expect(readme).toContain("Not in policy.");
    expect(readme).toContain("valid case why");
    expect(readme).toContain("invalid case why");
  });

  it("shows severity and autofix for rules in BUILTIN_POLICY", async () => {
    // comment-density is in BUILTIN_POLICY with severity: error, autofix: true
    const ruleDir = path.join(tmpDir, "comment-density");
    fs.mkdirSync(ruleDir, { recursive: true });

    const indexContent = `
const rule = {
  id: 'comment-density',
  meta: { description: 'Checks comment density.' },
  vehicles: ['tree-sitter'],
  check: () => [],
};
export default rule;
`;
    fs.writeFileSync(path.join(ruleDir, "index.ts"), indexContent, "utf8");
    const casesContent = `export const cases = ${JSON.stringify({
      valid: [{ why: "enough comments", code: "// ok", filename: "a.ts" }],
      invalid: [{ why: "too sparse", code: "const x = 1;", filename: "b.ts", findings: [{ message: "density too low" }] }],
    })};\n`;
    fs.writeFileSync(path.join(ruleDir, "cases.ts"), casesContent, "utf8");

    const readme = await generateReadme(ruleDir, "comment-density");
    expect(readme).toContain("**Severity**: error");
    expect(readme).toContain("**Autofix**: yes");
  });

  it("uses filename extension as fenced code language", async () => {
    const ruleDir = writeStubRule(tmpDir, "stub-rule", {
      valid: [{ why: "valid", code: "const x = 1;", filename: "main.ts" }],
      invalid: [{ why: "invalid", code: "let y;", filename: "main.ts", findings: [] }],
    });
    const readme = await generateReadme(ruleDir, "stub-rule");
    expect(readme).toContain("```ts");
  });
});

// ---------------------------------------------------------------------------
// AC #2: --check exit codes and printed lines
// ---------------------------------------------------------------------------

describe("checkAll", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exits 1 and names rule for stale README", async () => {
    const ruleDir = writeStubRule(tmpDir, "stub-rule");
    // Generate a fresh README first
    await generateAll(tmpDir);
    // Edit one byte to make it stale
    const readmePath = path.join(ruleDir, "README.md");
    const content = fs.readFileSync(readmePath, "utf8");
    fs.writeFileSync(readmePath, content + " ", "utf8");

    const { exitCode, lines } = await checkAll(tmpDir);
    expect(exitCode).toBe(1);
    expect(lines.some((l) => l === "stub-rule: README stale")).toBe(true);
  });

  it("exits 1 and names rule for missing README", async () => {
    writeStubRule(tmpDir, "stub-rule");
    // Do NOT generate README

    const { exitCode, lines } = await checkAll(tmpDir);
    expect(exitCode).toBe(1);
    expect(lines.some((l) => l === "stub-rule: README missing")).toBe(true);
  });

  it("exits 1 and names rule for empty valid cases", async () => {
    writeStubRule(tmpDir, "stub-rule", {
      valid: [],
      invalid: [{ why: "bad", code: "let x;", filename: "a.ts", findings: [{ message: "bad" }] }],
    });

    const { exitCode, lines } = await checkAll(tmpDir);
    expect(exitCode).toBe(1);
    expect(lines.some((l) => l === "stub-rule: valid cases empty")).toBe(true);
  });

  it("exits 1 and names rule for empty invalid cases", async () => {
    writeStubRule(tmpDir, "stub-rule", {
      valid: [{ why: "good", code: "const x = 1;", filename: "a.ts" }],
      invalid: [],
    });

    const { exitCode, lines } = await checkAll(tmpDir);
    expect(exitCode).toBe(1);
    expect(lines.some((l) => l === "stub-rule: invalid cases empty")).toBe(true);
  });

  it("exits 0 and prints rules checked line when all fresh", async () => {
    writeStubRule(tmpDir, "stub-rule");
    await generateAll(tmpDir);

    const { exitCode, lines } = await checkAll(tmpDir);
    expect(exitCode).toBe(0);
    expect(lines[0]).toMatch(/^rules checked: \d+$/);
  });

  it("exits 0 with rules checked: 0 for empty rules dir", async () => {
    const { exitCode, lines } = await checkAll(tmpDir);
    expect(exitCode).toBe(0);
    expect(lines).toEqual(["rules checked: 0"]);
  });
});
