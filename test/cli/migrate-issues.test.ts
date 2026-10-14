import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WORKING_TYPES } from "../../src/hooks/doc-registry.js";
import { runMigrateIssues } from "../../src/cli/migrate-issues.js";
import { parseFrontmatter, validateFrontmatter, type FmSchema } from "../../plugins/house-rules/src/engine/frontmatter.js";

const REPO = path.resolve(import.meta.dir, "../..");
const WORK = path.join(REPO, ".groundwork/work");

// Real ticket files copied verbatim; no ticket content is written by hand.
const FIXTURES = [
  "moor-retro-requests/tickets/01-module-boundary-rule.md",
  "moor-retro-requests/tickets/04-pr-body-link-rendering.md",
  "moor-retro-requests/tickets/05-stacked-pr-workflow.md",
  "retro-2026-10-06/tickets/01-junior-hand-back-waits-for-children.md",
  "pre-release-hardening/tickets/03-stacked-prs-follow-up-motive.md",
  "anti-slop-port/tickets/03-dockerfile-prefix-misclassifies-ts.md",
];
const README_REL = "moor-retro-requests/tickets/README.md";
const ALL = [...FIXTURES, README_REL];

const tmps: string[] = [];
function mk(prefix: string): string {
  const d = mkdtempSync(path.join(tmpdir(), prefix));
  tmps.push(d);
  return d;
}
function buildRoot(): string {
  const root = mk("mig-issues-");
  for (const rel of FIXTURES) {
    const dest = path.join(root, ".groundwork/work", rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    cpSync(path.join(WORK, rel), dest);
  }
  cpSync(path.join(REPO, "README.md"), path.join(root, ".groundwork/work", README_REL));
  return root;
}
const abs = (root: string, rel: string): string => path.join(root, ".groundwork/work", rel);
const read = (root: string, rel: string): string => readFileSync(abs(root, rel), "utf8");
const snapshot = (root: string): Record<string, { text: string; mtime: number }> =>
  Object.fromEntries(ALL.map(r => [r, { text: read(root, r), mtime: statSync(abs(root, r)).mtimeMs }]));
const created = (root: string, rel: string): string => statSync(abs(root, rel)).mtime.toISOString().slice(0, 10);

// Independent of the implementation: strip frontmatter, H1, header lines before the first H2, and the Parent paragraph.
function expectedBody(original: string): string[] {
  let lines = original.split("\n");
  if (lines[0] === "---") lines = lines.slice(lines.indexOf("---", 1) + 1);
  const h2 = lines.findIndex(l => l.startsWith("## "));
  const end = h2 === -1 ? lines.length : h2;
  const h1 = lines.findIndex((l, i) => i < end && l.startsWith("# "));
  const header = /^(\*\*)?(Status|Type|Source|Blocked by):(\*\*)?( |$)/;
  const out = lines.filter((l, i) => i !== h1 && !(i > h1 && i < end && header.test(l)));
  const p = out.findIndex(l => l === "## Parent");
  if (p === -1) return out;
  let q = p + 1;
  while (out[q] === "") q++;
  return [...out.slice(0, p), ...out.slice(q + 1)];
}
function splitFm(text: string): { fm: string[]; body: string[] } {
  const lines = text.split("\n");
  expect(lines[0]).toBe("---");
  const end = lines.indexOf("---", 1);
  return { fm: lines.slice(1, end), body: lines.slice(end + 1) };
}

let root: string;
let dry: { lines: string[]; code: number };
let before: Record<string, { text: string; mtime: number }>;
beforeAll(() => {
  root = buildRoot();
  before = snapshot(root);
  dry = runMigrateIssues(root, false);
});
afterAll(() => {
  for (const d of tmps) rmSync(d, { recursive: true, force: true });
});

describe("migrate issues: dry run", () => {
  test("changes no file content or mtime, and reports the planned changes", () => {
    expect(dry.code).toBe(0);
    const after = snapshot(root);
    expect(after).toEqual(before);
    expect(dry.lines.some(l => l.includes(".groundwork/work/moor-retro-requests/tickets/05-stacked-pr-workflow.md") && l.includes("needs-triage -> triage"))).toBe(true);
    expect(dry.lines.at(-1)).toContain(`${FIXTURES.length} converted`);
    expect(existsSync(path.join(root, ".groundwork/backup"))).toBe(false);
  });

  test("a non-ticket file in a tickets directory is reported skipped and left byte-identical", () => {
    expect(dry.lines.some(l => l.startsWith("skip ") && l.includes("README.md"))).toBe(true);
    expect(read(root, README_REL)).toBe(before[README_REL].text);
  });
});

describe("migrate issues: apply", () => {
  let r: string;
  let orig: Record<string, { text: string; mtime: number }>;
  let first: { lines: string[]; code: number };
  beforeAll(() => {
    r = buildRoot();
    orig = snapshot(r);
    first = runMigrateIssues(r, true);
  });

  test("keeps every body line in order and drops the H1", () => {
    expect(first.code).toBe(0);
    for (const rel of FIXTURES) {
      const { body } = splitFm(read(r, rel));
      expect(body).toEqual(expectedBody(orig[rel].text));
      expect(body.some(l => l.startsWith("# "))).toBe(false);
    }
  });

  test("README is untouched", () => {
    expect(read(r, README_REL)).toBe(orig[README_REL].text);
  });

  test("converts a needs-triage task ticket with a resolved blocker", () => {
    const rel = "moor-retro-requests/tickets/05-stacked-pr-workflow.md";
    expect(splitFm(read(r, rel)).fm).toEqual([
      'title: "Stacked-PR restack, retarget and lease-push support"',
      "status: triage",
      "priority: none",
      "tags: [enhancement]",
      'parent: "[[moor-retro-requests]]"',
      'blocked_by: ["[[04-pr-body-link-rendering]]"]',
      'source: "moor-95 retro, 2026-10-12 (rank 5)"',
      `created: ${created(r, rel)}`,
    ]);
  });

  test("converts a bold-format ready-for-agent ticket and takes the parent from its Parent section", () => {
    const rel = "retro-2026-10-06/tickets/01-junior-hand-back-waits-for-children.md";
    const fm = splitFm(read(r, rel)).fm;
    const parentText = orig[rel].text.split("\n").find(l => l.startsWith("Retro of session"))!;
    expect(fm).toEqual([
      'title: "Junior-orchestrator hand-back waits for its children"',
      "status: todo",
      "assignee: agent",
      "priority: none",
      "tags: []",
      `parent: ${JSON.stringify(`[[${parentText}]]`)}`,
      "blocked_by: []",
      'source: ""',
      `created: ${created(r, rel)}`,
    ]);
    expect(parentText).toContain('"');
    expect(read(r, rel)).not.toContain("## Parent");
  });

  test("converts a ready-for-human ticket to todo with a human assignee", () => {
    const rel = "pre-release-hardening/tickets/03-stacked-prs-follow-up-motive.md";
    expect(splitFm(read(r, rel)).fm).toEqual([
      'title: "Stacked PR planning (follow-up motive stacked-prs)"',
      "status: todo",
      "assignee: human",
      "priority: none",
      "tags: [enhancement]",
      'parent: "[[pre-release-hardening]]"',
      "blocked_by: []",
      'source: ""',
      `created: ${created(r, rel)}`,
    ]);
  });

  test("converts a resolved ticket to done and keeps unrelated header-style lines", () => {
    const rel = "anti-slop-port/tickets/03-dockerfile-prefix-misclassifies-ts.md";
    const text = read(r, rel);
    const fm = splitFm(text).fm;
    expect(fm[0]).toBe('title: "`dockerfile.ts` classified as Dockerfile; TS rules skip it"');
    expect(fm.slice(1, 4)).toEqual(["status: done", "priority: none", "tags: [enhancement]"]);
    expect(text).toContain("Priority: first (DECISION event 659)");
  });

  test("the converted frontmatter validates against the issue schema", () => {
    for (const rel of FIXTURES) {
      const parsed = parseFrontmatter(read(r, rel));
      if (!parsed.ok) throw new Error(`${rel}: ${parsed.error}`);
      expect(validateFrontmatter(WORKING_TYPES.issue.frontmatter as FmSchema, parsed.data)).toEqual([]);
    }
  });

  test("writes a tar.gz backup whose extracted bytes equal the originals", () => {
    const line = first.lines.find(l => l.startsWith("backup: "))!;
    expect(line).toBeDefined();
    const archive = line.slice("backup: ".length);
    expect(path.isAbsolute(archive)).toBe(true);
    expect(archive).toMatch(/\.groundwork\/backup\/migrate-issues-.*\.tar\.gz$/);
    expect(existsSync(archive)).toBe(true);
    const out = mk("mig-issues-extract-");
    const x = Bun.spawnSync(["tar", "-xzf", archive, "-C", out]);
    expect(x.exitCode).toBe(0);
    for (const rel of FIXTURES) {
      const p = path.join(out, ".groundwork/work", rel);
      expect(readFileSync(p, "utf8")).toBe(orig[rel].text);
    }
    expect(existsSync(path.join(out, ".groundwork/work", README_REL))).toBe(false);
  });

  test("a second apply writes nothing, makes no backup, and reports 0 converted", () => {
    const afterFirst = snapshot(r);
    const backups = Bun.spawnSync(["ls", path.join(r, ".groundwork/backup")]).stdout.toString();
    const second = runMigrateIssues(r, true);
    expect(second.code).toBe(0);
    expect(snapshot(r)).toEqual(afterFirst);
    expect(Bun.spawnSync(["ls", path.join(r, ".groundwork/backup")]).stdout.toString()).toBe(backups);
    expect(second.lines.some(l => l.startsWith("backup: "))).toBe(false);
    expect(second.lines.at(-1)).toContain("0 converted");
    expect(second.lines.some(l => l.includes("already converted"))).toBe(true);
  });
});

describe("migrate issues: blocker resolution", () => {
  test("a blocker with no sibling file warns and stays as a bare link", () => {
    const solo = mk("mig-issues-solo-");
    const rel = "moor-retro-requests/tickets/05-stacked-pr-workflow.md";
    const dest = path.join(solo, ".groundwork/work/other-motive/tickets/05-stacked-pr-workflow.md");
    mkdirSync(path.dirname(dest), { recursive: true });
    cpSync(path.join(WORK, rel), dest);
    const res = runMigrateIssues(solo, false);
    expect(res.code).toBe(0);
    expect(res.lines.some(l => l.startsWith("warning ") && l.includes("04"))).toBe(true);
    expect(res.lines.some(l => l.includes('[[04]]'))).toBe(true);
    expect(res.lines.at(-1)).toContain("1 warnings");
    runMigrateIssues(solo, true);
    expect(readFileSync(dest, "utf8")).toContain('blocked_by: ["[[04]]"]');
  });
});

describe("migrate issues: deployed path", () => {
  test("`gw migrate issues --root` runs as a dry run through the CLI entry point", () => {
    const cliRoot = buildRoot();
    const env: Record<string, string | undefined> = { ...process.env };
    delete env.CLAUDE_PROJECT_DIR;
    const r = Bun.spawnSync([process.execPath, path.join(REPO, "src/cli/main.ts"), "migrate", "issues", "--root", cliRoot], { env: env as Record<string, string> });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toContain("moor-retro-requests/tickets/05-stacked-pr-workflow.md");
    expect(read(cliRoot, FIXTURES[2])).toBe(readFileSync(path.join(WORK, FIXTURES[2]), "utf8"));
  });
});
