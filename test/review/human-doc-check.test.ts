import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
let seq = 0;
function write(name: string, content: string) {
  const dir = path.join(tmp, String(seq++));
  mkdirSync(dir);
  const p = path.join(dir, name);
  writeFileSync(p, content);
  return p;
}

describe("human-doc-check", () => {
  test("dirty pr body flags baseline claim and code-blocked path", () => {
    const doc = tpl("pr-body.md").replace(
      "## Proof",
      "Ran make lint and all tests pass. The parser lives in `src/foo.ts` now.\n\n## Proof",
    );
    const r = run(write("dirty.md", doc));
    expect(r.status).toBe(1);
    const lines = r.stdout.split("\n");
    expect(lines).toContain('- "Ran make lint and all tests pass." — states the CI baseline');
    expect(lines).toContain('- "src/foo.ts" — code-blocked path; use a commit-pinned GitHub permalink');
    expect(lines.filter((l) => l.startsWith("- ")).length).toBe(2);
  });

  test("agent-only heading is flagged", () => {
    const doc = tpl("pr-body.md").replace("## Proof", "## Files\n\nstuff\n\n## Proof");
    const r = run(write("heading.md", doc));
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('- "## Files" — agent-only content');
  });

  test("path inside a non-mermaid fence is flagged", () => {
    const r = run(write("fence.md", "## What\n\n```\nsrc/foo/bar.ts\n```\n"));
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('- "src/foo/bar.ts" — code-blocked path');
  });

  for (const name of ["pr-body.md"]) {
    test(`clean template ${name} passes`, () => {
      const r = run(path.join(TPL, name));
      expect(r.stdout.trim()).toBe("PASS");
      expect(r.status).toBe(0);
    });
  }

  describe("pr-body prose length", () => {
    const prose = (n: number) => Array.from({ length: n }, (_, i) => `Line ${i + 1} of prose.`).join("\n");
    const fenced = "```ts\n" + Array.from({ length: 30 }, (_, i) => `const a${i} = ${i};`).join("\n") + "\n```";

    test("12 prose lines plus a 30-line fenced block passes", () => {
      const r = run(write("pr-body.md", `${prose(12)}\n\n${fenced}\n`));
      expect(r.stdout.trim()).toBe("PASS");
      expect(r.status).toBe(0);
    });

    test("13 prose lines is flagged", () => {
      const r = run(write("pr-body.md", `${prose(13)}\n`));
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("pr-body prose 13 lines > 12");
    });

    test("13 prose lines in a file not named pr-body.md is not flagged", () => {
      const r = run(write("notes.md", `${prose(13)}\n`));
      expect(r.stdout).not.toContain("pr-body prose");
      expect(r.status).toBe(0);
    });

    test("real template copied to pr-body.md passes", () => {
      const r = run(write("pr-body.md", tpl("pr-body.md")));
      expect(r.stdout.trim()).toBe("PASS");
      expect(r.status).toBe(0);
    });
  });

  test("missing arg and unreadable file exit 2", () => {
    expect(spawnSync("bun", [SCRIPT], { encoding: "utf8", env }).status).toBe(2);
    expect(run(path.join(tmp, "nope.md")).status).toBe(2);
  });
});
