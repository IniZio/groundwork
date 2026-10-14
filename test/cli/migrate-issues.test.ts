import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WORKING_TYPES } from "../../src/hooks/doc-registry.js";
import { runMigrateIssues } from "../../src/cli/migrate-issues.js";
import { parseFrontmatter, validateFrontmatter, type FmSchema } from "../../plugins/house-rules/src/engine/frontmatter.js";

const REPO = path.resolve(import.meta.dir, "../..");
const FIX = path.join(REPO, "test/fixtures/migrate-issues");
const LEGACY = path.join(FIX, "legacy");
const CONVERTED = path.join(FIX, "converted");

// Real ticket files copied verbatim into test/fixtures/migrate-issues (legacy/ = before conversion, converted/ = already converted); no ticket content is written by hand.
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
    cpSync(path.join(LEGACY, rel), dest);
  }
  cpSync(path.join(REPO, "README.md"), path.join(root, ".groundwork/work", README_REL));
  return root;
}
const abs = (root: string, rel: string): string => path.join(root, ".groundwork/work", rel);
const read = (root: string, rel: string): string => readFileSync(abs(root, rel), "utf8");
const snapshot = (root: string): Record<string, { text: string; mtime: number }> =>
  Object.fromEntries(ALL.map(r => [r, { text: read(root, r), mtime: statSync(abs(root, r)).mtimeMs }]));
const created = (root: string, rel: string): string => statSync(abs(root, rel)).mtime.toISOString().slice(0, 10);

// Independent of the implementation: strip frontmatter, H1 and header lines before the first H2. Parent prose stays.
// After that, a leading run of 2 or more blank lines is reduced to one, and a checkbox list under ## Parent gets an AC heading.
function expectedBody(original: string): string[] {
  let lines = original.split("\n");
  if (lines[0] === "---") lines = lines.slice(lines.indexOf("---", 1) + 1);
  const h2 = lines.findIndex(l => l.startsWith("## "));
  const end = h2 === -1 ? lines.length : h2;
  const h1 = lines.findIndex((l, i) => i < end && l.startsWith("# "));
  const header = /^(\*\*)?(Status|Type|Source|Blocked by):(\*\*)?( |$)/;
  const kept = lines.filter((l, i) => i !== h1 && !(i > h1 && i < end && header.test(l)));
  while (kept[0] === "" && kept[1] === "") kept.shift();
  const box = kept.findIndex(l => l.startsWith("- ["));
  const owner = kept.slice(0, Math.max(box, 0)).filter(l => l.startsWith("## ")).at(-1);
  if (box !== -1 && owner === "## Parent") kept.splice(box, 0, "## Acceptance criteria", "");
  return kept;
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

  test("a Parent section of prose gives the motive slug as parent and stays in the body", () => {
    const rel = "retro-2026-10-06/tickets/01-junior-hand-back-waits-for-children.md";
    const fm = splitFm(read(r, rel)).fm;
    expect(fm).toEqual([
      'title: "Junior-orchestrator hand-back waits for its children"',
      "status: todo",
      "assignee: agent",
      "priority: none",
      "tags: []",
      'parent: "[[retro-2026-10-06]]"',
      "blocked_by: []",
      'source: ""',
      `created: ${created(r, rel)}`,
    ]);
    expect(read(r, rel)).toContain("## Parent");
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

describe("migrate issues: parent resolution on real retro tickets", () => {
  const DIR = "retro-2026-10-06/tickets";
  const T01 = `${DIR}/01-junior-hand-back-waits-for-children.md`;
  const T06 = `${DIR}/06-upstream-drift-check.md`;
  function retroRoot(): string {
    const d = mk("mig-issues-retro-");
    for (const rel of [T01, T06]) {
      const dest = path.join(d, ".groundwork/work", rel);
      mkdirSync(path.dirname(dest), { recursive: true });
      cpSync(path.join(LEGACY, rel), dest);
    }
    return d;
  }
  // Every non-blank original line outside the frontmatter, H1 and header lines must survive in order.
  function expectLinesInOrder(original: string, converted: string, skip: (l: string) => boolean): void {
    const out = converted.split("\n");
    let at = 0;
    for (const l of original.split("\n")) {
      if (l === "" || skip(l)) continue;
      const i = out.indexOf(l, at);
      if (i === -1) throw new Error(`line lost or out of order: ${JSON.stringify(l)}`);
      at = i + 1;
    }
  }
  const header = /^(# |\*\*(Status|Type|Source|Blocked by):\*\*)/;

  test("tickets 01 and 06 get the motive slug as parent and keep every body line in order", () => {
    const d = retroRoot();
    const orig: Record<string, string> = { [T01]: read(d, T01), [T06]: read(d, T06) };
    runMigrateIssues(d, true);
    for (const rel of [T01, T06]) {
      const { fm, body } = splitFm(read(d, rel));
      expect(fm).toContain('parent: "[[retro-2026-10-06]]"');
      expect(fm.filter(l => l.startsWith("parent:")).length).toBe(1);
      expect(body).toEqual(expectedBody(orig[rel]));
      expectLinesInOrder(orig[rel], read(d, rel), l => header.test(l));
      expect(body).toContain("## Parent");
    }
  });

  test("a Parent section holding only a wikilink to the motive is removed and sets the parent", () => {
    const d = retroRoot();
    const file = abs(d, T06);
    const prose = readFileSync(file, "utf8").split("\n").find(l => l.startsWith("Retro of session"))!;
    const text = readFileSync(file, "utf8");
    writeFileSync(file, text.replace(prose, "[[retro-2026-10-06]]"));
    const orig = text.replace(prose, "[[retro-2026-10-06]]");
    runMigrateIssues(d, true);
    const { fm, body } = splitFm(read(d, T06));
    expect(fm).toContain('parent: "[[retro-2026-10-06]]"');
    expect(body).not.toContain("## Parent");
    expect(body).not.toContain("[[retro-2026-10-06]]");
    expectLinesInOrder(orig, read(d, T06), l => header.test(l) || l === "## Parent" || l === "[[retro-2026-10-06]]");
  });

  test("a Parent section holding only a .groundwork/work path or a sibling ticket number resolves to its slug", () => {
    const d = retroRoot();
    const f06 = abs(d, T06);
    const f01 = abs(d, T01);
    const t06 = readFileSync(f06, "utf8");
    const t01 = readFileSync(f01, "utf8");
    const prose06 = t06.split("\n").find(l => l.startsWith("Retro of session"))!;
    const prose01 = t01.split("\n").find(l => l.startsWith("Retro of session"))!;
    writeFileSync(f06, t06.replace(prose06, ".groundwork/work/retro-2026-10-06/README.md"));
    writeFileSync(f01, t01.replace(prose01, "06"));
    runMigrateIssues(d, true);
    expect(splitFm(read(d, T06)).fm).toContain('parent: "[[retro-2026-10-06]]"');
    expect(splitFm(read(d, T01)).fm).toContain('parent: "[[06-upstream-drift-check]]"');
    expect(read(d, T01)).not.toContain("## Parent");
  });
});

describe("migrate issues: blocker resolution", () => {
  test("a blocker with no sibling file warns and stays as a bare link", () => {
    const solo = mk("mig-issues-solo-");
    const rel = "moor-retro-requests/tickets/05-stacked-pr-workflow.md";
    const dest = path.join(solo, ".groundwork/work/other-motive/tickets/05-stacked-pr-workflow.md");
    mkdirSync(path.dirname(dest), { recursive: true });
    cpSync(path.join(LEGACY, rel), dest);
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
    expect(read(cliRoot, FIXTURES[2])).toBe(readFileSync(path.join(LEGACY, FIXTURES[2]), "utf8"));
  });
});

describe("migrate issues: normalise already-converted issues", () => {
  const HEADING = "## Acceptance criteria";
  const CASES = [
    { rel: "human-agent-handoff/tickets/01-human-agent-split.md", insertAt: 25 },
    { rel: "delegation-enforcement/tickets/01-shared-session-base-helper.md", insertAt: 15 },
  ];
  function oneRoot(rel: string): string {
    const d = mk("mig-issues-norm-");
    const dest = path.join(d, ".groundwork/work", rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    cpSync(path.join(CONVERTED, rel), dest);
    return d;
  }

  for (const c of CASES) {
    test(`${c.rel}: heading goes directly above the checkbox list and nothing else changes`, () => {
      const d = oneRoot(c.rel);
      const input = read(d, c.rel).split("\n");
      expect(input[c.insertAt].startsWith("- [")).toBe(true);
      const res = runMigrateIssues(d, true);
      expect(res.code).toBe(0);
      const output = read(d, c.rel).split("\n");
      expect(output[c.insertAt]).toBe(HEADING);
      expect(output[c.insertAt + 1]).toBe("");
      expect(output.filter(l => l === HEADING).length).toBe(1);
      expect([...output.slice(0, c.insertAt), ...output.slice(c.insertAt + 2)]).toEqual(input);
      expect(res.lines.some(l => l.startsWith("normalise ") && l.includes(c.rel))).toBe(true);
      expect(res.lines.at(-1)).toContain("0 converted");
      expect(res.lines.at(-1)).toContain("1 normalised");
    });

    test(`${c.rel}: a second run changes nothing and reports 0 normalised`, () => {
      const d = oneRoot(c.rel);
      runMigrateIssues(d, true);
      const once = read(d, c.rel);
      const second = runMigrateIssues(d, true);
      expect(read(d, c.rel)).toBe(once);
      expect(second.lines.at(-1)).toContain("0 converted");
      expect(second.lines.at(-1)).toContain("0 normalised");
    });
  }

  test("extra blank lines after the frontmatter collapse to one and nothing else changes", () => {
    const rel = "moor-retro-requests/tickets/13-slice-id-pattern-matches-spdx.md";
    const d = oneRoot(rel);
    const input = read(d, rel).split("\n");
    const end = input.indexOf("---", 1);
    expect(input.slice(end + 1, end + 4)).toEqual(["", "", ""]);
    const res = runMigrateIssues(d, true);
    const output = read(d, rel).split("\n");
    const dropped = input.slice(end + 1).findIndex(l => l !== "") - 1;
    expect(dropped).toBe(2);
    expect(output.slice(0, end + 1)).toEqual(input.slice(0, end + 1));
    expect(output[end + 1]).toBe("");
    expect(output[end + 2]).toBe("## Problem");
    expect(output.slice(end + 1)).toEqual(input.slice(end + 1 + dropped));
    expect(output).not.toContain(HEADING);
    expect(res.lines.some(l => l.startsWith("normalise ") && l.includes(rel))).toBe(true);
    const second = runMigrateIssues(d, true);
    expect(read(d, rel)).toBe(output.join("\n"));
    expect(second.lines.at(-1)).toContain("0 normalised");
  });

  test("a checkbox list under a Parent section gets the heading directly above the first checkbox", () => {
    const rel = "retro-2026-10-06/tickets/01-junior-hand-back-waits-for-children.md";
    const d = oneRoot(rel);
    const input = read(d, rel).split("\n");
    const box = input.findIndex(l => l.startsWith("- [ ]"));
    expect(input.lastIndexOf("## Parent", box)).toBeGreaterThan(-1);
    const first = runMigrateIssues(d, true);
    const output = read(d, rel).split("\n");
    expect(output[box]).toBe(HEADING);
    expect(output[box + 1]).toBe("");
    expect(output[box + 2]).toBe(input[box]);
    expect(output.filter(l => l === HEADING).length).toBe(1);
    expect([...output.slice(0, box), ...output.slice(box + 2)]).toEqual(input);
    expect(first.lines.at(-1)).toContain("1 normalised");
  });

  test("a second run on a Parent ticket changes nothing and reports 0 normalised", () => {
    const rel = "retro-2026-10-06/tickets/01-junior-hand-back-waits-for-children.md";
    const d = oneRoot(rel);
    runMigrateIssues(d, true);
    const once = read(d, rel);
    const second = runMigrateIssues(d, true);
    expect(read(d, rel)).toBe(once);
    expect(second.lines.at(-1)).toContain("0 normalised");
  });

  test("a checkbox list under another heading stays byte-identical", () => {
    const rel = "retro-2026-10-06/tickets/01-junior-hand-back-waits-for-children.md";
    const d = oneRoot(rel);
    const input = read(d, rel).replace("## Parent", "## Goal");
    writeFileSync(abs(d, rel), input);
    const res = runMigrateIssues(d, true);
    expect(read(d, rel)).toBe(input);
    expect(res.lines.at(-1)).toContain("0 normalised");
  });

  test("a dry run lists normalised files apart from converted ones and writes nothing", () => {
    const d = oneRoot(CASES[0].rel);
    const legacy = "moor-retro-requests/tickets/13-slice-id-pattern-matches-spdx.md";
    const src = readFileSync(path.join(CONVERTED, legacy), "utf8").split("\n");
    const body = src.slice(src.indexOf("---", 1) + 1);
    const dest = path.join(d, ".groundwork/work", legacy);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, ["# 13: Slice-id pattern", "", "Status: needs-triage", ...body].join("\n"));
    const rels = [CASES[0].rel, legacy];
    const before = rels.map(r => read(d, r));
    const res = runMigrateIssues(d, false);
    expect(rels.map(r => read(d, r))).toEqual(before);
    expect(res.lines.some(l => l.startsWith("would normalise ") && l.includes(CASES[0].rel))).toBe(true);
    expect(res.lines.some(l => l.startsWith("would convert ") && l.includes(legacy))).toBe(true);
    expect(res.lines.some(l => l.startsWith("would convert ") && l.includes(CASES[0].rel))).toBe(false);
    expect(res.lines.some(l => l.startsWith("normalise:") && l.includes(CASES[0].rel))).toBe(true);
    expect(res.lines.at(-1)).toContain("1 converted");
    expect(res.lines.at(-1)).toContain("1 normalised");
  });
});
