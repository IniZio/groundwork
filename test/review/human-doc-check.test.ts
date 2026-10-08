import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");
const SCRIPT = path.join(ROOT, "src/review/human-doc-check.ts");
const TPL = path.join(ROOT, "templates/doc-types");
const tmp = mkdtempSync(path.join(tmpdir(), "hdc-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const env = { ...process.env } as Record<string, string>;
delete env.CLAUDE_PROJECT_DIR;

function run(file: string) {
  return spawnSync("bun", [SCRIPT, file], { encoding: "utf8", env });
}
const tpl = (name: string) => readFileSync(path.join(TPL, name), "utf8");
function write(name: string, content: string) {
  const p = path.join(tmp, name);
  writeFileSync(p, content);
  return p;
}

describe("human-doc-check", () => {
  test("dirty pr body flags baseline claim and code-blocked path", () => {
    const doc = tpl("pr-body.md").replace(
      "## Evidence",
      "Ran make lint and all tests pass. The parser lives in `src/foo.ts` now.\n\n## Evidence",
    );
    const r = run(write("dirty.md", doc));
    expect(r.status).toBe(1);
    const lines = r.stdout.split("\n");
    expect(lines).toContain('- "Ran make lint and all tests pass." — states the CI baseline');
    expect(lines).toContain('- "src/foo.ts" — code-blocked path; use a commit-pinned GitHub permalink');
    expect(lines.filter((l) => l.startsWith("- ")).length).toBe(2);
  });

  test("agent-only heading is flagged", () => {
    const doc = tpl("pr-body.md").replace("## Evidence", "## Files\n\nstuff\n\n## Evidence");
    const r = run(write("heading.md", doc));
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('- "## Files" — agent-only content');
  });

  test("path inside a non-mermaid fence is flagged", () => {
    const r = run(write("fence.md", "## What\n\n```\nsrc/foo/bar.ts\n```\n"));
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('- "src/foo/bar.ts" — code-blocked path');
  });

  for (const name of ["pr-body.md", "motive-human.md", "spec-human.md", "design-human.md", "ticket-human.md"]) {
    test(`clean template ${name} passes`, () => {
      const r = run(path.join(TPL, name));
      expect(r.stdout.trim()).toBe("PASS");
      expect(r.status).toBe(0);
    });
  }

  test("missing arg and unreadable file exit 2", () => {
    expect(spawnSync("bun", [SCRIPT], { encoding: "utf8", env }).status).toBe(2);
    expect(run(path.join(tmp, "nope.md")).status).toBe(2);
  });
});
