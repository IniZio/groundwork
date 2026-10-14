import { describe, expect, test, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

const SCRIPT = join(import.meta.dir, "..", "..", "scripts", "doc-conformance.ts");
const GOOD = `---\ntitle: Good\nstatus: todo\n---\n\nBody.\n\n## Acceptance criteria\n\n- [ ] works\n`;
const BAD = `---\ntitle: Bad\nstatus: todo\n---\n\nBody with no criteria.\n`;

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

function repo(files: Record<string, string>, gitignore?: string): string {
  const d = mkdtempSync(join(tmpdir(), "docconf-"));
  dirs.push(d);
  Bun.spawnSync(["git", "init", "-q"], { cwd: d });
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(d, p)), { recursive: true });
    writeFileSync(join(d, p), c);
  }
  if (gitignore !== undefined) writeFileSync(join(d, ".gitignore"), gitignore);
  return d;
}

function run(root: string, ...extra: string[]) {
  const r = Bun.spawnSync(["bun", SCRIPT, "--root", root, ...extra], { env: { ...process.env, CLAUDE_PROJECT_DIR: "" } });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

const G = ".groundwork/work/m/tickets/01-good.md";
const B = ".groundwork/work/m/tickets/02-bad.md";

describe("doc-conformance script", () => {
  test("one conforming and one non-conforming issue: exact summary, exit 1, bad file listed with missing-heading message", () => {
    const r = run(repo({ [G]: GOOD, [B]: BAD }));
    expect(r.code).toBe(1);
    expect(r.out).toContain("checked 2, conforming 1, non-conforming 1, untyped 0 (50% of typed conforming)");
    expect(r.out).toContain(B);
    expect(r.out).toContain('is missing required heading "Acceptance criteria"');
    expect(r.out).not.toContain(`${G}\n`);
  });

  test("all-conforming fixture exits 0", () => {
    const r = run(repo({ [G]: GOOD }));
    expect(r.code).toBe(0);
    expect(r.out).toContain("checked 1, conforming 1, non-conforming 0, untyped 0 (100% of typed conforming)");
  });

  test("repo without .groundwork checks 0 files and exits 0", () => {
    const r = run(repo({ "README.md": "# hi\n" }));
    expect(r.code).toBe(0);
    expect(r.out).toContain("checked 0");
  });

  test("positive twin: the same repo with a bad issue under .groundwork is counted and fails", () => {
    const r = run(repo({ "README.md": "# hi\n", [B]: BAD }));
    expect(r.code).toBe(1);
    expect(r.out).toContain("checked 1, conforming 0, non-conforming 1, untyped 0 (0% of typed conforming)");
  });

  test("--json emits counts and a files list with message and severity", () => {
    const r = run(repo({ [G]: GOOD, [B]: BAD }), "--json");
    expect(r.code).toBe(1);
    const j = JSON.parse(r.out);
    expect(j.checked).toBe(2);
    expect(j.conforming).toBe(1);
    expect(j.nonConforming).toBe(1);
    expect(j.percentConforming).toBe(50);
    expect(j.files).toHaveLength(1);
    expect(j.files[0].path).toBe(B);
    expect(j.files[0].findings[0].message).toContain("Acceptance criteria");
    expect(typeof j.files[0].findings[0].severity).toBe("string");
  });

  test("a gitignored .groundwork directory is still scanned", () => {
    const r = run(repo({ [G]: GOOD, [B]: BAD }, ".groundwork/\n"));
    expect(r.code).toBe(1);
    expect(r.out).toContain("checked 2, conforming 1, non-conforming 1, untyped 0 (50% of typed conforming)");
  });

  test("a file matching no doc type is counted as untyped, not as conforming", () => {
    const stray = ".groundwork/scratch-notes.md";
    const r = run(repo({ [G]: GOOD, [stray]: "# loose notes\n" }));
    expect(r.code).toBe(0);
    expect(r.out).toContain("checked 2, conforming 1, non-conforming 0, untyped 1 (100% of typed conforming)");
    const j = JSON.parse(run(repo({ [G]: GOOD, [stray]: "# loose notes\n" }), "--json").out);
    expect(j.untyped).toBe(1);
    expect(j.untypedPaths).toEqual([stray]);
    expect(j.conforming).toBe(1);
  });
});
