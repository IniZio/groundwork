// Java autofix through guard.ts / gate.ts spawned by path, as plugin.json registers them.

import { describe, it, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { getParser } from "../../src/hooks/lib/tree-sitter-loader.js";
import { parseText } from "../../src/hooks/languages/parse.js";

const REPO = path.resolve(import.meta.dir, "../..");
const GUARD = path.join(REPO, "src/hooks/guard.ts");
const GATE  = path.join(REPO, "src/hooks/gate.ts");

async function spawnGuard(
  payload: unknown,
  tmpDir: string,
): Promise<{ stdout: string; stderr: string; exit: number }> {
  const proc = Bun.spawn(["bun", GUARD], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: "/decoy/project/dir",
      CLAUDE_PLUGIN_ROOT: REPO,
    } as Record<string, string>,
    cwd: tmpDir,
  });
  proc.stdin.write(JSON.stringify(payload));
  proc.stdin.end();
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exit = await proc.exited;
  return { stdout, stderr, exit };
}

function spawnGate(
  payload: unknown,
  extraEnv: Record<string, string> = {},
): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync("bun", [GATE], {
    input: JSON.stringify(payload),
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: REPO, ...extraEnv },
    encoding: "utf8",
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
}

function initGitRepo(dir: string): void {
  const opts = { cwd: dir, encoding: "utf8" as const };
  spawnSync("git", ["init"], opts);
  spawnSync("git", ["config", "user.email", "test@test.com"], opts);
  spawnSync("git", ["config", "user.name", "Test"], opts);
}

function gitCommit(dir: string, message: string): void {
  const opts = { cwd: dir, encoding: "utf8" as const };
  spawnSync("git", ["add", "-A"], opts);
  spawnSync("git", ["commit", "--allow-empty", "-m", message], opts);
}

function makeTranscript(tmpDir: string, files: string[], timestamp: string): string {
  const transcriptPath = path.join(tmpDir, `transcript-${Date.now()}.jsonl`);
  const lines = files.map(fp => JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", name: "Write", input: { file_path: fp, content: readFileSync(fp, "utf8") } }],
    },
    timestamp,
    cwd: tmpDir,
  }));
  writeFileSync(transcriptPath, lines.join("\n") + "\n");
  return transcriptPath;
}

async function assertParsesClean(content: string, label: string): Promise<void> {
  const r = await parseText(content, "java", getParser);
  expect(r.ok, `${label}: parse failed: ${r.ok ? "" : r.reason}`).toBe(true);
  if (r.ok) {
    expect(r.errorRows.size, `${label}: ERROR/MISSING nodes on rows: ${[...r.errorRows].join(",")}`).toBe(0);
  }
}


const JAVA_OVER_BUDGET = [
  "/* Copyright 2024 Example Corp. Licensed under the Apache License, Version 2.0. */",
  "package com.example.demo;",
  "",
  "/**",
  " * Finds a user by numeric identifier.",
  " * @param id the user identifier",
  " * @return null if not found",
  " */",
  "// NOSONAR",
  "//noinspection unchecked",
  "// @formatter:off",
  "public class UserService {",
  ...Array.from({ length: 20 }, (_, i) => `    private int field${i} = ${i};`),
  "",
  "    // narrative comment one: this class manages user lookups across the domain",
  "    // narrative comment two: we use a linear scan for simplicity in this version",
  "    // narrative comment three: cache is invalidated on every write operation here",
  "    // narrative comment four: the id parameter must be a non-negative integer",
  "    // narrative comment five: returns null when the backing store is empty",
  "    // narrative comment six: see the design doc for performance improvement notes",
  "",
  '    private String sql = "SELECT * FROM users // inline text not a comment";',
  "",
  "    public Object findUser(int id) { return null; }",
  "}",
].join("\n");

// Exact narrative lines that the hook must remove (text as they appear in the fixture)
const JAVA_OVER_BUDGET_NARRATIVE_LINES = [
  "    // narrative comment one: this class manages user lookups across the domain",
  "    // narrative comment two: we use a linear scan for simplicity in this version",
  "    // narrative comment three: cache is invalidated on every write operation here",
  "    // narrative comment four: the id parameter must be a non-negative integer",
  "    // narrative comment five: returns null when the backing store is empty",
  "    // narrative comment six: see the design doc for performance improvement notes",
];

// Exact // lines that must survive (tool markers)
const JAVA_OVER_BUDGET_MARKER_LINES = [
  "// NOSONAR",
  "//noinspection unchecked",
  "// @formatter:off",
];

// ---------------------------------------------------------------------------
// AC-JAVA-GUARD: Write of over-budget .java — prose stripped, survivors kept
// ---------------------------------------------------------------------------

describe("AC-JAVA-GUARD: guard Write of over-budget .java strips narrative, keeps survivors", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ac-java-guard-"));
  const javaPath = path.join(tmpDir, "UserService.java");

  it("exit 0; updatedInput.content: narrative gone, code intact, Javadoc + license header + NOSONAR + noinspection + @formatter:off + string literal kept", async () => {
    await assertParsesClean(JAVA_OVER_BUDGET, "input fixture");

    const payload = {
      tool_name: "Write",
      tool_input: { file_path: javaPath, content: JAVA_OVER_BUDGET },
    };

    const { stdout, exit } = await spawnGuard(payload, tmpDir);
    expect(exit).toBe(0);

    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("permissionDecision");

    const hso = parsed.hookSpecificOutput as Record<string, unknown>;
    expect(hso).toHaveProperty("updatedInput");

    const ui = hso.updatedInput as Record<string, unknown>;
    const updated = ui.content as string;

    await assertParsesClean(updated, "guard updatedInput.content");

    // Exact list of removed narrative comment lines
    for (const line of JAVA_OVER_BUDGET_NARRATIVE_LINES) {
      expect(updated).not.toContain(line);
    }

    // Exact list of surviving // comment lines (tool markers only)
    const survivingSlashSlash = updated.split("\n").filter(l => l.trim().startsWith("//"));
    expect(survivingSlashSlash).toEqual(JAVA_OVER_BUDGET_MARKER_LINES);

    // All 20 field declarations must survive byte-identical
    for (let i = 0; i < 20; i++) {
      expect(updated).toContain(`private int field${i} = ${i};`);
    }

    // Javadoc block must survive
    expect(updated).toContain("/**");
    expect(updated).toContain(" * Finds a user by numeric identifier.");
    expect(updated).toContain(" * @param id the user identifier");
    expect(updated).toContain("*/");

    // License header must survive
    expect(updated).toContain("/* Copyright 2024 Example Corp.");

    // Tool markers must survive
    expect(updated).toContain("// NOSONAR");
    expect(updated).toContain("//noinspection unchecked");
    expect(updated).toContain("// @formatter:off");

    // String literal containing // must be untouched
    expect(updated).toContain('private String sql = "SELECT * FROM users // inline text not a comment";');

    const ctx = hso.additionalContext as string;
    expect(ctx).toContain("not another session's edit");
  });
});

// ---------------------------------------------------------------------------
// AC-JAVA-GATE: Stop autofix of over-budget .java — file fixed on disk
// ---------------------------------------------------------------------------

describe("AC-JAVA-GATE: gate Stop autofix of over-budget .java — file fixed on disk, stdout reports autofix", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ac-java-gate-"));
  const javaPath = path.join(tmpDir, "Repository.java");

  // Fields and methods inside public class Repository — zero ERROR/MISSING nodes.
  const JAVA_GATE_CONTENT = [
    "/* Copyright 2024 Example Corp. Apache License, Version 2.0. */",
    "package com.example.demo;",
    "",
    "/**",
    " * Repository for entity lookup.",
    " */",
    "// NOSONAR",
    "// @formatter:off",
    "public class Repository {",
    ...Array.from({ length: 20 }, (_, i) => `    private int g${i} = ${i};`),
    "",
    "    // narrative gate comment one: the repository scans all entities on boot",
    "    // narrative gate comment two: caching is handled by the service layer",
    "    // narrative gate comment three: indexes are rebuilt on the first query",
    "    // narrative gate comment four: the config key is repository.scan.depth",
    "    // narrative gate comment five: defaults to depth three when not set",
    "    // narrative gate comment six: scan results are logged at debug level",
    "",
    "}",
  ].join("\n");

  const GATE_NARRATIVE_LINES = [
    "    // narrative gate comment one: the repository scans all entities on boot",
    "    // narrative gate comment two: caching is handled by the service layer",
    "    // narrative gate comment three: indexes are rebuilt on the first query",
    "    // narrative gate comment four: the config key is repository.scan.depth",
    "    // narrative gate comment five: defaults to depth three when not set",
    "    // narrative gate comment six: scan results are logged at debug level",
  ];

  const GATE_MARKER_LINES = [
    "// NOSONAR",
    "// @formatter:off",
  ];

  it("gate removes narrative from disk; Javadoc + license + tool markers survive; stdout has auto-removed, not-another-session's-edit, and java filename", async () => {
    await assertParsesClean(JAVA_GATE_CONTENT, "gate input fixture");

    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");

    writeFileSync(javaPath, JAVA_GATE_CONTENT);

    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [javaPath], ts);

    const r = spawnGate({
      hook_event_name: "Stop",
      session_id: `ac-java-gate-${Date.now()}`,
      transcript_path: tp,
      cwd: tmpDir,
      stop_hook_active: false,
    });

    expect(r.status).toBe(0);

    const parsed = JSON.parse(r.stdout.trim()) as Record<string, unknown>;
    expect(parsed.decision).not.toBe("block");

    const hso = parsed.hookSpecificOutput as Record<string, unknown>;
    expect(hso).toBeDefined();
    const ctx = hso.additionalContext as string;
    expect(ctx).toContain("auto-removed");
    expect(ctx).toContain("not another session's edit");
    expect(ctx).toContain("Repository.java");

    const diskContent = readFileSync(javaPath, "utf8");

    await assertParsesClean(diskContent, "gate disk result");

    // Exact list of removed narrative comment lines
    for (const line of GATE_NARRATIVE_LINES) {
      expect(diskContent).not.toContain(line);
    }

    // Exact list of surviving // comment lines (tool markers only)
    const survivingSlashSlash = diskContent.split("\n").filter(l => l.trim().startsWith("//"));
    expect(survivingSlashSlash).toEqual(GATE_MARKER_LINES);

    // All 20 field declarations survive
    for (let i = 0; i < 20; i++) {
      expect(diskContent).toContain(`private int g${i} = ${i};`);
    }

    expect(diskContent).toContain("/* Copyright 2024 Example Corp.");
    expect(diskContent).toContain("/**");
    expect(diskContent).toContain(" * Repository for entity lookup.");
    expect(diskContent).toContain("// NOSONAR");
    expect(diskContent).toContain("// @formatter:off");
  });
});


describe("AC-JAVA-UNDER: guard Write of under-budget .java — passes through with empty stdout", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ac-java-under-"));
  const javaPath = path.join(tmpDir, "Simple.java");

  const JAVA_UNDER_BUDGET = [
    "package com.example.demo;",
    "",
    "public class Simple {",
    "    private int value = 0;",
    "    public int getValue() { return value; }",
    "}",
  ].join("\n");

  it("exit 0; stdout is empty (no updatedInput injected)", async () => {
    const payload = {
      tool_name: "Write",
      tool_input: { file_path: javaPath, content: JAVA_UNDER_BUDGET },
    };

    const { stdout, exit } = await spawnGuard(payload, tmpDir);
    expect(exit).toBe(0);
    expect(stdout.trim()).toBe("");
  });
});
