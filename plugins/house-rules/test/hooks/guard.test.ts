import { describe, it, expect, beforeAll } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync as readFS } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import path2 from "node:path";
import os from "node:os";
import { check, buildCtx } from "../../src/hooks/guard.js";
import { reconstructPostEdit, type GetParserFn } from "../../src/hooks/lib/comment-density.js";

const CODE_25 = Array.from({ length: 25 }, (_, i) => `const v${i} = ${i};`).join("\n");

const OVER_CAP_25 = [
  ...Array.from({ length: 20 }, (_, i) => `const v${i} = ${i};`),
  "// comment one",
  "// comment two",
  "// comment three",
  "// comment four",
  "// comment five",
].join("\n");

const WITH_ANNOTATIONS_25 = [
  ...Array.from({ length: 20 }, (_, i) => `const v${i} = ${i};`),
  "// @ts-expect-error legacy type mismatch",
  "// eslint-disable-next-line no-console",
  "// TODO(owner): remove this",
  "// https://example.com/spec",
  "// plain narration comment",
].join("\n");

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

function parseOut(r: { stdout: string }): Record<string, unknown> {
  const s = r.stdout.trim();
  if (!s) return {};
  return JSON.parse(s) as Record<string, unknown>;
}

function getHso(r: { stdout: string }): Record<string, unknown> {
  const parsed = parseOut(r);
  return (parsed.hookSpecificOutput as Record<string, unknown>) ?? {};
}

function safeContext(r: { stdout: string }): string | null {
  const hso = getHso(r);
  return typeof hso.additionalContext === "string" ? hso.additionalContext : null;
}

const failParser: GetParserFn = async () => ({ ok: false, reason: "test-loader-failure" });

describe("comment-density-guard", () => {

  it("CLEAN: Write with no comments → empty stdout, exit 0", async () => {
    const r = await check(write("/tmp/cdg-test.ts", CODE_25));
    expect(r.stdout).toBe("");
    expect(r.exit).toBe(0);
  });

  it("AUTOCORRECT: Write over-cap → updatedInput present, no permissionDecision", async () => {
    const r = await check(write("/tmp/cdg-over.ts", OVER_CAP_25));
    expect(r.exit).toBe(0);
    const hso = getHso(r);
    expect(hso).toHaveProperty("updatedInput");
    expect(hso).not.toHaveProperty("permissionDecision");
    const parsed = parseOut(r);
    expect(parsed).not.toHaveProperty("permissionDecision");
  });

  it("AUTOCORRECT: additionalContext contains file path and correction message", async () => {
    const r = await check(write("/tmp/cdg-pathtest.ts", OVER_CAP_25));
    const ctx = safeContext(r);
    expect(ctx).not.toBeNull();
    expect(ctx!).toContain("cdg-pathtest.ts");
    expect(ctx!).toContain("not another session's edit");
  });

  it("AUTOCORRECT: Write over-cap keeps first comment, strips rest from content", async () => {
    const r = await check(write("/tmp/cdg-over2.ts", OVER_CAP_25));
    const hso = getHso(r);
    expect(hso).toHaveProperty("updatedInput");
    const ui = hso.updatedInput as Record<string, unknown>;
    expect(typeof ui.content).toBe("string");
    const content = ui.content as string;
    const commentCount = content.split("\n").filter(l => l.trim().startsWith("//")).length;
    expect(commentCount).toBe(1);
    const ctx = safeContext(r);
    expect(ctx!).toContain("removed 4 comment(s)");
  });

  it("WHITELIST: @-tagged annotations and TODO(owner) — stays clean", async () => {
    const r = await check(write("/tmp/cdg-annot.ts", WITH_ANNOTATIONS_25));
    expect(r.stdout).toBe("");
    expect(r.exit).toBe(0);
  });

  it("WHITELIST: eslint-disable and @ts-expect-error individually exempt", async () => {
    const content = [
      ...Array.from({ length: 20 }, (_, i) => `const v${i} = ${i};`),
      "// @ts-expect-error needed",
      "// eslint-disable-next-line no-unused-vars",
      "// @ts-ignore temporary",
    ].join("\n");
    const r = await check(write("/tmp/cdg-eslint.ts", content));
    expect(r.stdout).toBe("");
    expect(r.exit).toBe(0);
  });

  it("AUTOCORRECT: Edit new_string over-cap → updatedInput with stripped new_string", async () => {
    const pre = "const x = 1;";
    const r = await check(
      edit("/tmp/cdg-edit.ts", "const x = 1;", OVER_CAP_EDIT_NEW),
      { readFile: () => pre },
    );
    expect(r.exit).toBe(0);
    const hso = getHso(r);
    expect(hso).toHaveProperty("updatedInput");
    const ui = hso.updatedInput as Record<string, unknown>;
    expect(typeof ui.new_string).toBe("string");
    expect(ui.old_string).toBe("const x = 1;");
    const stripped = (ui.new_string as string).split("\n").filter(l => l.trim().startsWith("//")).length;
    expect(stripped).toBeLessThan(3);
  });

  it("CLEAN: MultiEdit new_strings under cap → empty stdout", async () => {
    const r = await check(multiedit("/tmp/cdg-multi.ts", [
      { old_string: "a", new_string: CODE_25 },
    ]), { readFile: () => "a" });
    expect(r.stdout).toBe("");
    expect(r.exit).toBe(0);
  });

  it("AUTOCORRECT: MultiEdit new_strings over cap → updatedInput", async () => {
    const r = await check(multiedit("/tmp/cdg-multi-over.ts", [
      { old_string: "a", new_string: OVER_CAP_25 },
    ]), { readFile: () => "a" });
    expect(r.exit).toBe(0);
    const hso = getHso(r);
    expect(hso).toHaveProperty("updatedInput");
  });

  it("CLEAN: non-guarded tool (Bash) → empty stdout, exit 0", async () => {
    const r = await check({ tool_name: "Bash", tool_input: { command: "echo hi" } });
    expect(r.stdout).toBe("");
    expect(r.exit).toBe(0);
  });

  it("CLEAN: malformed stdin → empty stdout, exit 0", async () => {
    const r = await check("not-json");
    expect(r.stdout).toBe("");
    expect(r.exit).toBe(0);
  });

  it("GROUNDWORK_COMMENT_DENSITY=0 does not skip — guard still corrects", async () => {
    const orig = process.env.GROUNDWORK_COMMENT_DENSITY;
    process.env.GROUNDWORK_COMMENT_DENSITY = "0";
    try {
      const r = await check(write("/tmp/cdg-kill-bite.ts", OVER_CAP_25));
      expect(getHso(r)).toHaveProperty("updatedInput");
    } finally {
      if (orig === undefined) delete process.env.GROUNDWORK_COMMENT_DENSITY;
      else process.env.GROUNDWORK_COMMENT_DENSITY = orig;
    }
  });

  it("NO FLOOR: small file with all comments → strips (no MIN_ADDED_LINES bypass)", async () => {
    const tiny = "// c1\n// c2\n// c3\n// c4\n// c5";
    const r = await check(write("/tmp/cdg-tiny.ts", tiny));
    const hso = getHso(r);
    expect(hso).toHaveProperty("updatedInput");
  });

  it("BITE-PROOF: stripping fires on over-cap TS Write", async () => {
    const r = await check(write("/tmp/cdg-bite.ts", OVER_CAP_25));
    const hso = getHso(r);
    expect(hso).toHaveProperty("updatedInput");
    const ui = hso.updatedInput as Record<string, unknown>;
    const content = ui.content as string;
    const commentCount = content.split("\n").filter(l => l.trim().startsWith("//")).length;
    expect(commentCount).toBeLessThan(5);
  });

  it("AC1: Write .sh with 5 # comments → keeps first, strips 4, no permissionDecision", async () => {
    const lines = [
      "#!/usr/bin/env bash",
      ...Array.from({ length: 19 }, (_, i) => `echo "line ${i}"`),
      "# comment A",
      "# comment B",
      "# comment C",
      "# comment D",
      "# comment E",
    ];
    const content = lines.join("\n");
    const r = await check(write("/tmp/cdg-ac1.sh", content));
    expect(r.exit).toBe(0);
    const hso = getHso(r);
    expect(hso).toHaveProperty("updatedInput");
    expect(hso).not.toHaveProperty("permissionDecision");
    const parsed = parseOut(r);
    expect(parsed).not.toHaveProperty("permissionDecision");
    const ui = hso.updatedInput as Record<string, unknown>;
    const commentLines = (ui.content as string).split("\n").filter(l => l.match(/^#(?!!)/));
    expect(commentLines.length).toBe(1);
    const ctx = safeContext(r);
    expect(ctx!).toContain("removed 4 comment(s)");
  });

  it("AC3: trailing YAML comment stripped, code value preserved", async () => {
    const yamlBase = [
      "apiVersion: v1",
      ...Array.from({ length: 14 }, (_, i) => `key${i}: value${i}`),
      "x: 1  # note",
      "y: 2  # desc",
      "z: 3  # reason",
      "a: 4  # extra",
      "b: 5  # more",
    ].join("\n");
    const r = await check(write("/tmp/cdg-ac3.yaml", yamlBase));
    const hso = getHso(r);
    expect(hso).toHaveProperty("updatedInput");
    const content = (hso.updatedInput as Record<string, unknown>).content as string;
    expect(content).toContain("x: 1");
    expect(content).toContain("y: 2");
    expect(content).not.toContain("# more");
    expect(content).not.toContain("# extra");
  });

  it("AC5: ambiguous replace_all (occurrences differ) → advisory only, no updatedInput", async () => {
    const pre = "// note A\nconst a = 1;\n// note A\nconst b = 2;";
    const budgetFillerLines = Array.from({ length: 20 }, (_, i) => `const v${i} = ${i};`).join("\n");
    const manyComments = [
      "// narration 1",
      "// narration 2",
      "// narration 3",
      "// narration 4",
      "// narration 5",
    ].join("\n");
    const new_string = `${budgetFillerLines}\n${manyComments}`;
    const r = await check(
      { tool_name: "Edit", tool_input: { file_path: "/tmp/cdg-ac5.ts", old_string: "// note A", new_string, replace_all: true } },
      { readFile: () => pre },
    );
    expect(r.exit).toBe(0);
    const hso = getHso(r);
    expect(hso).not.toHaveProperty("updatedInput");
  });

  it("AC7: loader unavailable → no updatedInput, advisory contains 'advisory only', stderr line", async () => {
    const r = await check(
      write("/tmp/cdg-ac7.ts", OVER_CAP_25),
      { getParser: failParser },
    );
    expect(r.exit).toBe(0);
    const hso = getHso(r);
    expect(hso).not.toHaveProperty("updatedInput");
    const ctx = safeContext(r);
    expect(ctx).not.toBeNull();
    expect(ctx!).toContain("advisory only");
    expect(r.stderr.trim().length).toBeGreaterThan(0);
  });

  it("AC2: Edit YAML — only new comments stripped, carried-over survive, old_string unchanged", async () => {
    const pre = [
      "apiVersion: v1",
      "# existing comment A",
      "# existing comment B",
      ...Array.from({ length: 18 }, (_, i) => `key${i}: val${i}`),
    ].join("\n");
    const old_string = "# existing comment B";
    const new_string = [
      "# existing comment B",
      "# new comment 1",
      "# new comment 2",
      "# new comment 3",
    ].join("\n");
    const r = await check(
      edit("/tmp/cdg-ac2.yaml", old_string, new_string),
      { readFile: () => pre },
    );
    expect(r.exit).toBe(0);
    const hso = getHso(r);
    expect(hso).toHaveProperty("updatedInput");
    const ui = hso.updatedInput as Record<string, unknown>;
    expect(ui.old_string).toBe(old_string);
    const ns = ui.new_string as string;
    expect(ns).toContain("existing comment B");
  });
});

function gitIn(dir: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    env: { ...process.env, HOME: process.env.HOME, ...env },
  });
}

function makeSessionRepo(opts: {
  priorCodeLines: number;
  priorCommentLines: number;
  baseCommentLines?: number;
  baseCodeLines?: number;
}): { dir: string; file: string; transcript: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cdg-ac4-"));
  gitIn(dir, ["init"]);
  gitIn(dir, ["config", "user.email", "test@test.com"]);
  gitIn(dir, ["config", "user.name", "Test"]);

  const file = path.join(dir, "session.ts");
  const bCode = opts.baseCodeLines ?? 0;
  const bComment = opts.baseCommentLines ?? 0;
  const baseLines = [
    ...Array.from({ length: bComment }, (_, i) => `// base comment ${i}`),
    ...Array.from({ length: bCode }, (_, i) => `const baseCode${i} = ${i};`),
    'const ANCHOR = "session";',
  ].join("\n") + "\n";
  writeFileSync(file, baseLines);
  gitIn(dir, ["add", "session.ts"]);
  gitIn(dir, ["commit", "-m", "base"], {
    GIT_AUTHOR_DATE: "2024-01-01T12:00:00+00:00",
    GIT_COMMITTER_DATE: "2024-01-01T12:00:00+00:00",
  });

  const transcript = path.join(dir, "transcript.jsonl");
  writeFileSync(transcript, JSON.stringify({ timestamp: "2024-01-02T12:00:00.000Z" }) + "\n");

  const sessionLines = [
    ...Array.from({ length: opts.priorCommentLines }, (_, i) => `// session comment ${i}`),
    ...Array.from({ length: opts.priorCodeLines }, (_, i) => `const sessionLine${i} = ${i};`),
    ...Array.from({ length: bComment }, (_, i) => `// base comment ${i}`),
    ...Array.from({ length: bCode }, (_, i) => `const baseCode${i} = ${i};`),
    'const ANCHOR = "session";',
  ].join("\n") + "\n";
  writeFileSync(file, sessionLines);
  gitIn(dir, ["add", "session.ts"]);
  gitIn(dir, ["commit", "-m", "session"], {
    GIT_AUTHOR_DATE: "2024-01-03T12:00:00+00:00",
    GIT_COMMITTER_DATE: "2024-01-03T12:00:00+00:00",
  });

  return { dir, file, transcript };
}

describe("AC4 cumulative budget", () => {
  let strippedRepo: ReturnType<typeof makeSessionRepo>;
  let allowedRepo: ReturnType<typeof makeSessionRepo>;
  let baseCommentRepo: ReturnType<typeof makeSessionRepo>;

  beforeAll(() => {
    // priorLines=40, priorComments=2 → budget=floor(0.05*(40+10))-2=0 → strip
    strippedRepo = makeSessionRepo({ priorCodeLines: 38, priorCommentLines: 2 });
    // priorLines=100, priorComments=1 → budget=floor(0.05*(100+10))-1=4 → allow
    allowedRepo = makeSessionRepo({ priorCodeLines: 99, priorCommentLines: 1 });
    // base has 3 comments, session adds 40 code lines (no comments) → priorAddedComments=0
    baseCommentRepo = makeSessionRepo({ priorCodeLines: 40, priorCommentLines: 0, baseCommentLines: 3, baseCodeLines: 5 });
  });

  function makeNewString(codeLines: number, includeComment: boolean): string {
    const lines = Array.from({ length: codeLines }, (_, i) => `const editLine${i} = ${i};`);
    if (includeComment) lines.push("// edit comment");
    return lines.join("\n");
  }

  it("budget=0: prior 40 lines + 2 comments, 10-line edit + 1 comment → stripped", async () => {
    const { dir, file, transcript } = strippedRepo;
    const new_string = makeNewString(9, true); // 10 lines: 9 code + 1 comment
    const r = await check({
      tool_name: "Edit",
      tool_input: { file_path: file, old_string: 'const ANCHOR = "session";', new_string },
      transcript_path: transcript,
      cwd: dir,
    });
    const hso = getHso(r);
    expect(hso).toHaveProperty("updatedInput");
    const ctx = safeContext(r);
    expect(ctx!).toContain("40 lines added");
    expect(ctx!).toContain("2 comments already added");
  });

  it("budget=4: prior 100 lines + 1 comment, 10-line edit + 1 comment → allowed", async () => {
    const { dir, file, transcript } = allowedRepo;
    const new_string = makeNewString(9, true); // 10 lines
    const r = await check({
      tool_name: "Edit",
      tool_input: { file_path: file, old_string: 'const ANCHOR = "session";', new_string },
      transcript_path: transcript,
      cwd: dir,
    });
    expect(r.stdout).toBe("");
    expect(r.exit).toBe(0);
  });

  it("base-commit comments not counted as session-added", async () => {
    const { dir, file, transcript } = baseCommentRepo;
    // base has 3 comments; session adds 40 code lines (no comments)
    // priorAddedComments=0 → budget=floor(0.05*(40+20))-0=3 → allow 1 comment
    const new_string = makeNewString(19, true); // 20 lines: 19 code + 1 comment
    const r = await check({
      tool_name: "Edit",
      tool_input: { file_path: file, old_string: 'const ANCHOR = "session";', new_string },
      transcript_path: transcript,
      cwd: dir,
    });
    // 3 base comments excluded → budget 3 → allow
    expect(r.stdout).toBe("");
    expect(r.exit).toBe(0);
  });

  it("missing transcript → edit-alone budget applies", async () => {
    const { file } = strippedRepo;
    // No transcript_path → priorAddedCount=0, priorAddedComments=0
    // changedRows=5 (4 code + 1 comment), budget=floor(0.05*5)=0 → strip
    const new_string = makeNewString(4, true); // 5 lines
    const r = await check({
      tool_name: "Edit",
      tool_input: { file_path: file, old_string: 'const ANCHOR = "session";', new_string },
      // no transcript_path
    });
    const hso = getHso(r);
    expect(hso).toHaveProperty("updatedInput");
  });

  it("BITE: prior always 0 → should-strip case becomes allow (red without real prior)", async () => {
    // Use a repo where bite changes the outcome: 20 prior + 2 comments, 20-line edit
    const biteRepo = makeSessionRepo({ priorCodeLines: 18, priorCommentLines: 2 });
    // Real: floor(0.05*(20+20))-2=2-2=0 → strip
    // Bite (prior=0): floor(0.05*20)-0=1 → allow
    const new_string = makeNewString(19, true); // 20 lines: 19 code + 1 comment
    const r = await check({
      tool_name: "Edit",
      tool_input: { file_path: biteRepo.file, old_string: 'const ANCHOR = "session";', new_string },
      transcript_path: biteRepo.transcript,
      cwd: biteRepo.dir,
    });
    const hso = getHso(r);
    expect(hso).toHaveProperty("updatedInput");
    const ctx = safeContext(r);
    expect(ctx!).toContain("20 lines added");
    expect(ctx!).toContain("2 comments already added");
  });
});


import { mkdirSync, rmSync } from "node:fs";

const PLUGIN_ROOT = path.resolve(import.meta.dir, "../..");
const OVER_CAP_SH = [
  "#!/usr/bin/env bash",
  ...Array.from({ length: 14 }, (_, i) => `echo "line ${i}"`),
  "# comment A", "# comment B", "# comment C", "# comment D", "# comment E",
].join("\n") + "\n";

describe("DEFAULT_IGNORE: guard skip behavior", () => {
  it("plugin test/fixtures path → guard allows (no output, matches DEFAULT_IGNORE)", async () => {
    const fp = path.join(PLUGIN_ROOT, "test", "fixtures", "comment-density", "tmp-probe.sh");
    const r = await check(write(fp, OVER_CAP_SH));
    expect(r.stdout).toBe("");
    expect(r.exit).toBe(0);
  });

  it("test/fixtures in non-git tmp dir → NOT ignored by DEFAULT_IGNORE (guard still corrects)", async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-usr-fix-"));
    try {
      mkdirSync(path.join(tmpDir, "test", "fixtures"), { recursive: true });
      const fp = path.join(tmpDir, "test", "fixtures", "a.sh");
      const r = await check(write(fp, OVER_CAP_SH));
      expect(getHso(r)).toHaveProperty("updatedInput");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("DEFAULT_IGNORE patterns", () => {
  it("node_modules path in git repo → guard allows (matches node_modules/**)", async () => {
    const fp = path.join(PLUGIN_ROOT, "node_modules", "fake-pkg", "index.ts");
    const r = await check(write(fp, OVER_CAP_25));
    expect(r.stdout).toBe("");
    expect(r.exit).toBe(0);
  });

  it("src file in git repo → NOT ignored (doesn't match DEFAULT_IGNORE)", async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-not-ignored-"));
    try {
      const fp = path.join(tmpDir, "index.ts");
      const r = await check(write(fp, OVER_CAP_25));
      expect(getHso(r)).toHaveProperty("updatedInput");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("test/fixtures in unrelated non-git tmp dir → NOT ignored (no repo root found)", async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-no-repo-fix-"));
    try {
      mkdirSync(path.join(tmpDir, "test", "fixtures"), { recursive: true });
      const fp = path.join(tmpDir, "test", "fixtures", "x.sh");
      const r = await check(write(fp, OVER_CAP_SH));
      expect(getHso(r)).toHaveProperty("updatedInput");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("test/fixtures-other in git repo → NOT ignored (doesn't match **/test/fixtures/**)", async () => {
    const fp = path.join(PLUGIN_ROOT, "test", "fixtures-other", "x.ts");
    const r = await check(write(fp, OVER_CAP_25));
    expect(getHso(r)).toHaveProperty("updatedInput");
  });
});


const PROBE_SH = readFS(
  path2.join(import.meta.dir, "../fixtures/comment-density/nexus-probe/probe.sh"),
  "utf8",
);

describe("remainder (K) computation", () => {
  it("probe.sh Write: strips 121, K=0, B=37 (bite: old code said re-add 37)", async () => {
    const r = await check(write("/tmp/cdg-probe.sh", PROBE_SH));
    expect(r.exit).toBe(0);
    const ctx = safeContext(r);
    expect(ctx).not.toBeNull();
    expect(ctx!).toContain("removed 121 comment(s)");
    expect(ctx!).toContain("budget left before this edit: 37");
    expect(ctx!).toContain("No comment budget remains");
    expect(ctx!).not.toContain("re-add up to 37");
  });

  it("buildCtx K>0: remainder=2 shows re-add count", () => {
    const fakeStripped = [{ startRow: 0, endRow: 0, startIndex: 0, endIndex: 7, text: "# extra", nodeType: "comment", exempt: false }];
    const ctx = buildCtx("write", "/tmp/f.ts", fakeStripped, 5, 2, 100, 3);
    expect(ctx).toContain("re-add up to 2");
    expect(ctx).not.toContain("No comment budget remains");
    expect(ctx).toContain("budget left before this edit: 5");
  });
});


describe("defect fixes: base-aware nc, mapEdit pfx/sfx, advisory text, priorAddedComments", () => {
  it("A: base has comment, pre deletes it, edit rewords it → allow", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cdg-base-aware-"));
    gitIn(dir, ["init"]);
    gitIn(dir, ["config", "user.email", "test@test.com"]);
    gitIn(dir, ["config", "user.name", "Test"]);

    const file = path.join(dir, "test.ts");
    const codeLines = Array.from({ length: 10 }, (_, i) => `const c${i} = ${i};`).join("\n");
    writeFileSync(file, `${codeLines}\n// why old\nconst z = 99;\n`);
    gitIn(dir, ["add", "test.ts"]);
    gitIn(dir, ["commit", "-m", "base"], {
      GIT_AUTHOR_DATE: "2024-01-01T12:00:00+00:00",
      GIT_COMMITTER_DATE: "2024-01-01T12:00:00+00:00",
    });

    const transcript = path.join(dir, "transcript.jsonl");
    writeFileSync(transcript, JSON.stringify({ timestamp: "2024-01-02T12:00:00.000Z" }) + "\n");

    writeFileSync(file, `${codeLines}\nconst z = 99;\n`);
    gitIn(dir, ["add", "test.ts"]);
    gitIn(dir, ["commit", "-m", "session"], {
      GIT_AUTHOR_DATE: "2024-01-03T12:00:00+00:00",
      GIT_COMMITTER_DATE: "2024-01-03T12:00:00+00:00",
    });

    const r = await check({
      tool_name: "Edit",
      tool_input: { file_path: file, old_string: "const z = 99;", new_string: "// why reworded\nconst z = 99;" },
      transcript_path: transcript,
      cwd: dir,
    });

    expect(r.stdout).toBe("");
    expect(r.exit).toBe(0);
  });

  it("B: Edit // old → // new, budget 0 → updatedInput present, applied text equals stripped exactly", async () => {
    const pre = "a\n// old\nb\n";
    const r = await check(
      { tool_name: "Edit", tool_input: { file_path: "/tmp/cdg-b-fix.ts", old_string: "// old", new_string: "// new" } },
      { readFile: () => pre },
    );
    const hso = getHso(r);
    expect(hso).toHaveProperty("updatedInput");
    const ui = hso.updatedInput as Record<string, unknown>;
    const reconResult = reconstructPostEdit(
      "edit",
      { file_path: "/tmp/cdg-b-fix.ts", ...ui } as Parameters<typeof reconstructPostEdit>[1],
      pre,
    );
    expect(reconResult).not.toBeNull();
    expect(reconResult!.post).toBe("a\nb\n");
  });

  it("C: advisory path → context says not stripped, not before it was applied", async () => {
    const pre = "// note A\nconst a = 1;\n// note A\nconst b = 2;";
    const filler = Array.from({ length: 20 }, (_, i) => `const v${i} = ${i};`).join("\n");
    const manyComments = Array.from({ length: 5 }, (_, i) => `// narration ${i + 1}`).join("\n");
    const r = await check(
      {
        tool_name: "Edit",
        tool_input: {
          file_path: "/tmp/cdg-c-adv.ts",
          old_string: "// note A",
          new_string: `${filler}\n${manyComments}`,
          replace_all: true,
        },
      },
      { readFile: () => pre },
    );
    const hso = getHso(r);
    expect(hso).not.toHaveProperty("updatedInput");
    const ctx = safeContext(r);
    expect(ctx).not.toBeNull();
    expect(ctx!).toContain("not stripped");
    expect(ctx!).not.toContain("before it was applied");
  });

  it("no base → pre-based fallback: over-cap edit still strips", async () => {
    const pre = "const x = 1;";
    const r = await check(
      { tool_name: "Edit", tool_input: { file_path: "/tmp/cdg-d-fallback.ts", old_string: "const x = 1;", new_string: OVER_CAP_EDIT_NEW } },
      { readFile: () => pre },
    );
    expect(getHso(r)).toHaveProperty("updatedInput");
  });

  it("priorAddedComments: reworded base comment not counted as session-added — boundary flip", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cdg-prior-cmt-"));
    gitIn(dir, ["init"]);
    gitIn(dir, ["config", "user.email", "test@test.com"]);
    gitIn(dir, ["config", "user.name", "Test"]);

    const file = path.join(dir, "test.ts");
    writeFileSync(file, `// why old\nconst ANCHOR = "session";\n`);
    gitIn(dir, ["add", "test.ts"]);
    gitIn(dir, ["commit", "-m", "base"], {
      GIT_AUTHOR_DATE: "2024-01-01T12:00:00+00:00",
      GIT_COMMITTER_DATE: "2024-01-01T12:00:00+00:00",
    });

    const transcript = path.join(dir, "transcript.jsonl");
    writeFileSync(transcript, JSON.stringify({ timestamp: "2024-01-02T12:00:00.000Z" }) + "\n");

    writeFileSync(file, `// why new\nconst ANCHOR = "session";\n`);
    gitIn(dir, ["add", "test.ts"]);
    gitIn(dir, ["commit", "-m", "session-reword"], {
      GIT_AUTHOR_DATE: "2024-01-03T12:00:00+00:00",
      GIT_COMMITTER_DATE: "2024-01-03T12:00:00+00:00",
    });

    const editLines = Array.from({ length: 20 }, (_, i) => `const x${i} = ${i};`).join("\n");
    const r = await check({
      tool_name: "Edit",
      tool_input: {
        file_path: file,
        old_string: 'const ANCHOR = "session";',
        new_string: `${editLines}\n// genuinely new comment`,
      },
      transcript_path: transcript,
      cwd: dir,
    });

    // priorAddedComments=0 (reword is not net-new) → budget=1 ≥ nc=1 → allow
    expect(r.stdout).toBe("");
    expect(r.exit).toBe(0);
  });
});

describe("guard-keeps-reword: pairing preserves reword, strips narration", () => {
  // Repo setup: base has `// why old`, session rewrites to `// why reworded` (pre on disk).
  // Edit inserts a new narration comment alongside the reword.
  // greedyPairCommentRows must pair `// why old` with `// why reworded` and mark only the
  // narration as net-new. Budget=0 → narration stripped, reword preserved in new_string.
  function makeRewordRepo(): { dir: string; file: string; transcript: string } {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cdg-reword-"));
    gitIn(dir, ["init"]);
    gitIn(dir, ["config", "user.email", "test@test.com"]);
    gitIn(dir, ["config", "user.name", "Test"]);

    const file = path.join(dir, "test.ts");
    // Base: one code line + the original comment
    writeFileSync(file, "// why old\nconst z = 99;\n");
    gitIn(dir, ["add", "test.ts"]);
    gitIn(dir, ["commit", "-m", "base"], {
      GIT_AUTHOR_DATE: "2024-01-01T12:00:00+00:00",
      GIT_COMMITTER_DATE: "2024-01-01T12:00:00+00:00",
    });

    const transcript = path.join(dir, "transcript.jsonl");
    writeFileSync(transcript, JSON.stringify({ timestamp: "2024-01-02T12:00:00.000Z" }) + "\n");

    // Session pre-state: comment reworded (1 removed, 1 added → priorAddedComments=0 via pairing)
    writeFileSync(file, "// why reworded\nconst z = 99;\n");
    gitIn(dir, ["add", "test.ts"]);
    gitIn(dir, ["commit", "-m", "session-reword"], {
      GIT_AUTHOR_DATE: "2024-01-03T12:00:00+00:00",
      GIT_COMMITTER_DATE: "2024-01-03T12:00:00+00:00",
    });

    return { dir, file, transcript };
  }

  it("narration ABOVE reword → narration stripped, new_string equals reword only", async () => {
    const { dir, file, transcript } = makeRewordRepo();
    // Edit inserts narration above the reword.
    // post = "// brand new narration\n// why reworded\nconst z = 99;\n"
    // base→post: removed [why old], added [brand new narration, why reworded]
    const r = await check({
      tool_name: "Edit",
      tool_input: {
        file_path: file,
        old_string: "// why reworded",
        new_string: "// brand new narration\n// why reworded",
      },
      transcript_path: transcript,
      cwd: dir,
    });
    expect(r.exit).toBe(0);
    const hso = getHso(r);
    expect(hso).toHaveProperty("updatedInput");
    const ui = hso.updatedInput as Record<string, unknown>;
    expect(ui.new_string).toBe("// why reworded");
  });

  it("narration BELOW reword → narration stripped, new_string equals reword only", async () => {
    const { dir, file, transcript } = makeRewordRepo();
    const r = await check({
      tool_name: "Edit",
      tool_input: {
        file_path: file,
        old_string: "// why reworded",
        new_string: "// why reworded\n// brand new narration",
      },
      transcript_path: transcript,
      cwd: dir,
    });
    expect(r.exit).toBe(0);
    const hso = getHso(r);
    expect(hso).toHaveProperty("updatedInput");
    const ui = hso.updatedInput as Record<string, unknown>;
    expect(ui.new_string).toBe("// why reworded");
  });
});
