import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");
const SCRIPT = path.join(ROOT, "src/review/pr-links.ts");
const tmp = mkdtempSync(path.join(tmpdir(), "prl-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const env = { ...process.env } as Record<string, string>;
delete env.CLAUDE_PROJECT_DIR;

const SHA = "a".repeat(40);
const REPO = "acme/widgets";
let seq = 0;
function fixture(content: string) {
  const dir = path.join(tmp, String(seq++));
  mkdirSync(dir);
  const p = path.join(dir, "pr-body.md");
  writeFileSync(p, content);
  return p;
}
function run(file: string) {
  return spawnSync("bun", [SCRIPT, file, "--repo", REPO, "--pr", "7"], { encoding: "utf8", env, cwd: tmp });
}
const blob = (p: string, frag = "") => `https://github.com/${REPO}/blob/${SHA}/${p}${frag}`;
const anchor = (hex: string) => `https://github.com/${REPO}/pull/7/files#diff-${hex}`;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

describe("pr-links", () => {
  test("adds anchor with correct sha256 of path", () => {
    const f = fixture(`See [the parser](${blob("src/a.ts", "#L3")}).\n`);
    const r = run(f);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("pr-links: 1 anchors added");
    expect(readFileSync(f, "utf8")).toBe(
      `See [the parser](${blob("src/a.ts", "#L3")}) ([diff](${anchor(sha256("src/a.ts"))})).\n`,
    );
  });

  test("sha256 matches known value", () => {
    const f = fixture(`[x](${blob("a")})\n`);
    run(f);
    expect(readFileSync(f, "utf8")).toContain(
      "#diff-ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
    );
  });

  test("idempotent on second run", () => {
    const f = fixture(`[x](${blob("src/a.ts")})\n`);
    run(f);
    const once = readFileSync(f, "utf8");
    const r = run(f);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("pr-links: 0 anchors added");
    expect(readFileSync(f, "utf8")).toBe(once);
  });

  test("other-repo and non-blob links unchanged", () => {
    const body = [
      `[o](https://github.com/other/repo/blob/${SHA}/src/a.ts)`,
      `[t](https://github.com/${REPO}/tree/${SHA}/src)`,
      `[i](https://github.com/${REPO}/issues/3)`,
      "",
    ].join("\n");
    const f = fixture(body);
    const r = run(f);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("pr-links: 0 anchors added");
    expect(readFileSync(f, "utf8")).toBe(body);
  });

  test("bare ref exits 1 and prints the line", () => {
    const body = `fine [x](${blob("a.ts")})\nsee src/foo/bar.ts:42 for details\n`;
    const f = fixture(body);
    const r = run(f);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("2: see src/foo/bar.ts:42 for details");
    expect(readFileSync(f, "utf8")).toBe(body);
  });

  test("bare path@sha:line exits 1", () => {
    const r = run(fixture(`at src/a.ts@abcdef1:9 here\n`));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("src/a.ts@abcdef1:9");
  });

  test("line fragments kept on blob link", () => {
    const f = fixture(`[r](${blob("src/a.ts", "#L10-L20")})\n`);
    run(f);
    const got = readFileSync(f, "utf8");
    expect(got).toContain(`(${blob("src/a.ts", "#L10-L20")})`);
    expect(got).toContain(anchor(sha256("src/a.ts")));
  });
});
