// Make autofix through guard.ts / gate.ts spawned by path, as plugin.json registers them.

import { describe, it, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { getParser } from "../../src/hooks/lib/tree-sitter-loader.js";
import { parseText } from "../../src/hooks/languages/parse.js";

const REPO = path.resolve(import.meta.dir, "../..");
const GUARD = path.join(REPO, "src/hooks/guard.ts");
const GATE = path.join(REPO, "src/hooks/gate.ts");

async function spawnGuard(payload: unknown, tmpDir: string): Promise<{ stdout: string; exit: number }> {
  const proc = Bun.spawn(["bun", GUARD], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CLAUDE_PROJECT_DIR: "/decoy/project/dir", CLAUDE_PLUGIN_ROOT: REPO } as Record<string, string>,
    cwd: tmpDir,
  });
  proc.stdin.write(JSON.stringify(payload));
  proc.stdin.end();
  const [stdout] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { stdout, exit: await proc.exited };
}

function git(dir: string, ...args: string[]): void {
  spawnSync("git", args, { cwd: dir, encoding: "utf8" });
}

async function assertParsesClean(content: string, label: string): Promise<void> {
  const r = await parseText(content, "make", getParser);
  expect(r.ok, `${label}: parse failed`).toBe(true);
  if (r.ok) expect(r.errorRows.size, `${label}: ERROR nodes on rows ${[...r.errorRows].join(",")}`).toBe(0);
}

const NARRATIVE = [
  "# narrative one: this makefile builds the service binary from the source tree",
  "# narrative two: the compiler is selected through the CC variable below here",
  "# narrative three: object files land in the obj directory before linking now",
  "# narrative four: the install target copies the binary into the prefix bin dir",
  "# narrative five: clean removes every generated artefact from the build tree",
  "# narrative six: run the test target before publishing a new build anywhere",
];

const KEPT = [
  "# groundwork-rule: no-console-log",
  "# groundwork-rule: no-ts-any",
];

const RECIPE_HASH = "\t# recipe hash line handed to the shell";

function makefile(): string {
  return [
    KEPT[0],
    KEPT[1],
    "",
    ...Array.from({ length: 20 }, (_, i) => `VAR_${i} = ${i}`),
    "",
    ...NARRATIVE,
    "",
    "HASH_CHAR = \\#",
    "define BUILD_STEP",
    "# body hash line inside define",
    "endef",
    "",
    "all: main.o",
    "\t$(CC) -o app main.o",
    RECIPE_HASH,
    "",
  ].join("\n");
}

const SURVIVING_HASH_LINES = [
  ...KEPT,
  "# body hash line inside define",
];

describe("make guard: Write of over-budget Makefile strips narrative, keeps rules and hazards", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "make-guard-"));

  it("exit 0; narrative gone; groundwork-rule, define body, escaped hash, recipe hash survive", async () => {
    const content = makefile();
    await assertParsesClean(content, "input");
    const { stdout, exit } = await spawnGuard(
      { tool_name: "Write", tool_input: { file_path: path.join(tmpDir, "Makefile"), content } },
      tmpDir,
    );
    expect(exit).toBe(0);
    const hso = (JSON.parse(stdout.trim()) as Record<string, unknown>).hookSpecificOutput as Record<string, unknown>;
    const updated = (hso.updatedInput as Record<string, unknown>).content as string;
    await assertParsesClean(updated, "guard output");

    for (const l of NARRATIVE) expect(updated).not.toContain(l);
    expect(updated.split("\n").filter((l) => l.startsWith("#"))).toEqual(SURVIVING_HASH_LINES);
    expect(updated).toContain("HASH_CHAR = \\#\n");
    expect(updated).toContain(RECIPE_HASH);
    for (let i = 0; i < 20; i++) expect(updated).toContain(`VAR_${i} = ${i}`);
    expect(hso.additionalContext as string).toContain("not another session's edit");
  });

  it("under-budget Makefile passes through with empty stdout", async () => {
    const { stdout, exit } = await spawnGuard(
      { tool_name: "Write", tool_input: { file_path: path.join(tmpDir, "Makefile"), content: "all:\n\t@true\n" } },
      tmpDir,
    );
    expect(exit).toBe(0);
    expect(stdout.trim()).toBe("");
  });
});

describe("make gate: Stop autofix of over-budget Makefile fixes file on disk", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "make-gate-"));
  const mkPath = path.join(tmpDir, "Makefile");

  it("removes narrative from disk; markers survive; stdout reports autofix", async () => {
    git(tmpDir, "init");
    git(tmpDir, "config", "user.email", "test@test.com");
    git(tmpDir, "config", "user.name", "Test");
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    git(tmpDir, "add", "-A");
    git(tmpDir, "commit", "-m", "initial");

    writeFileSync(mkPath, makefile());
    const tp = path.join(tmpDir, "transcript.jsonl");
    writeFileSync(
      tp,
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Write", input: { file_path: mkPath, content: makefile() } }] },
        timestamp: new Date(Date.now() - 10000).toISOString(),
        cwd: tmpDir,
      }) + "\n",
    );

    const r = spawnSync("bun", [GATE], {
      input: JSON.stringify({
        hook_event_name: "Stop",
        session_id: `make-gate-${Date.now()}`,
        transcript_path: tp,
        cwd: tmpDir,
        stop_hook_active: false,
      }),
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: REPO },
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    const parsed = JSON.parse((r.stdout ?? "").trim()) as Record<string, unknown>;
    expect(parsed.decision).not.toBe("block");
    const ctx = (parsed.hookSpecificOutput as Record<string, unknown>).additionalContext as string;
    expect(ctx).toContain("auto-removed");
    expect(ctx).toContain("Makefile");

    const disk = readFileSync(mkPath, "utf8");
    await assertParsesClean(disk, "gate disk result");
    for (const l of NARRATIVE) expect(disk).not.toContain(l);
    expect(disk.split("\n").filter((l) => l.startsWith("#"))).toEqual(SURVIVING_HASH_LINES);
    expect(disk).toContain(RECIPE_HASH);
    expect(disk).toContain("HASH_CHAR = \\#\n");
  });
});
