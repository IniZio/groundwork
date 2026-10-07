import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");
const MAIN = path.join(ROOT, "src/cli/main.ts");
const HR_MAIN = path.join(ROOT, "plugins/house-rules/src/cli/main.ts");
const BASES = ["spec", "ticket", "motive", "design"];
const HUMAN_FORBIDDEN = ["Acceptance criteria", "Files", "Commands", "Ledger", "Requirements", "Execution notes"];
const tmps: string[] = [];
afterAll(() => {
  for (const d of tmps) rmSync(d, { recursive: true, force: true });
});

const childEnv = { ...process.env } as Record<string, string>;
delete childEnv.CLAUDE_PROJECT_DIR;
delete childEnv.GROUNDWORK_DB;

function makeRepo(): string {
  const tmp = mkdtempSync(path.join(tmpdir(), "gw-doc-placement-"));
  tmps.push(tmp);
  spawnSync("git", ["init", "-q"], { cwd: tmp, env: childEnv });
  const r = spawnSync("bun", [MAIN, "recipe"], { cwd: tmp, env: childEnv, encoding: "utf8", timeout: 15000 });
  expect(r.status).toBe(0);
  writeFileSync(path.join(tmp, ".house-rules.json"), r.stdout);
  return tmp;
}

function scaffold(tmp: string, type: string) {
  const r = spawnSync(
    "bun",
    [HR_MAIN, "new", type, "slug=demo", "nn=01", "name=Demo", "title=Demo", "created=2026-01-01",
      "status=active", "folds_into=none", "reason=sample", "--repo", tmp],
    { cwd: tmp, env: childEnv, encoding: "utf8", timeout: 15000 },
  );
  const rel = r.stdout.trim();
  return { status: r.status, stderr: r.stderr, rel, text: r.status === 0 ? readFileSync(path.join(tmp, rel), "utf8") : "" };
}

describe("doc placement via deployed CLI", () => {
  for (const base of BASES) {
    it(`${base}: agent view in .groundwork, human view in doc/`, () => {
      const tmp = makeRepo();
      const agent = scaffold(tmp, base);
      expect(agent.status, agent.stderr).toBe(0);
      expect(agent.rel.startsWith(".groundwork/work/demo/")).toBe(true);
      expect(agent.text).toContain("## Acceptance criteria");

      const human = scaffold(tmp, `${base}-human`);
      expect(human.status, human.stderr).toBe(0);
      expect(human.rel.startsWith("doc/demo/")).toBe(true);
      for (const h of HUMAN_FORBIDDEN) {
        expect(new RegExp(`^##+ ${h}`, "m").test(human.text), `heading ${h}`).toBe(false);
      }
      expect(/\$GW|bun test/.test(human.text)).toBe(false);
    }, 40000);
  }
});

describe("pr-body template", () => {
  const text = readFileSync(path.join(ROOT, "templates/doc-types/pr-body.md"), "utf8");
  it("has the three sections", () => {
    for (const h of ["## What changed", "## Evidence", "## Residual risk"]) expect(text).toContain(h);
  });
  it("has no baseline-check claims", () => {
    expect(/tests? pass|lint|typecheck|tsc|CI (is )?green|bun test/i.test(text)).toBe(false);
  });
});
