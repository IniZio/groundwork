import { describe, test, expect } from "bun:test";
import { join, resolve } from "node:path";

const MAIN = resolve(import.meta.dir, "../../src/cli/main.ts");
const FIXTURES = resolve(import.meta.dir, "../fixtures/pr-body");

function prose(file: string, ...flags: string[]) {
  const r = Bun.spawnSync(["bun", MAIN, "prose", join(FIXTURES, file), ...flags]);
  return { status: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

describe("house-rules prose", () => {
  test("the dense moor 956 body fails with the sentence, colon, semicolon and heading findings", () => {
    const r = prose("moor-956-dense.md", "--pr");
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/sentence has 69 words; the limit is 25/);
    expect(r.out).toContain("a semicolon joins clauses");
    expect(r.out).toContain("a colon joins clauses mid-sentence");
    expect(r.out).toContain('- "## Scope" — PR body has no "## Scope" heading');
    expect(r.out).toContain('- "## Checks" — heading is not allowed');
    expect(r.out).not.toContain("PASS");
  });

  test("the plain moor 421 body passes once it uses the allowed headings", () => {
    const r = prose("moor-421-reheaded.md", "--pr");
    expect(r.out).toBe("PASS\n");
    expect(r.status).toBe(0);
  });

  test("the original 421 headings fail only under --pr", () => {
    expect(prose("moor-421-plain.md").out).toBe("PASS\n");
    const r = prose("moor-421-plain.md", "--pr");
    expect(r.status).toBe(1);
    expect(r.out).toContain('"## Limits" — heading is not allowed');
  });

  test("--pr is rejected on other subcommands", () => {
    const r = Bun.spawnSync(["bun", MAIN, "config", "--pr"]);
    expect(r.exitCode).toBe(2);
  });
});
