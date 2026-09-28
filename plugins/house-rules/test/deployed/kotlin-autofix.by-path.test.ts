// AC: Kotlin (.kt/.kts) autofix through guard.ts / gate.ts spawned by path, equal to Go stability.

import { describe, it, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

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

const KT_OVER_BUDGET = [
  "/* Copyright 2024 Acme Corp. Licensed under the Apache License, Version 2.0. */",
  "package com.example",
  "",
  "/**",
  " * Finds the user by numeric identifier.",
  " * @param id the user identifier",
  " * @return null if not found",
  " */",
  "// ktlint-disable no-wildcard-imports",
  "import com.example.*",
  "",
  "//noinspection SpellCheckingInspection",
  'val typoVar = "intentionall typo"',
  "",
  ...Array.from({ length: 20 }, (_, i) => `val v${i} = ${i}`),
  "",
  "// narrative comment one: this function handles the main lookup logic",
  "// narrative comment two: we use a linear scan for simplicity here",
  "// narrative comment three: cache is invalidated on every write operation",
  "// narrative comment four: the id parameter must be non-negative",
  "// narrative comment five: returns null when the backing store is empty",
  "// narrative comment six: see the design doc for performance notes",
  "",
  "fun findUser(id: Int): Any? = null",
].join("\n");

// Over-budget .kts script (no package clause — routes via .kts extension)
const KTS_OVER_BUDGET = [
  ...Array.from({ length: 20 }, (_, i) => `val s${i} = ${i}`),
  "",
  "// narrative kts comment one: this script sets up the build environment",
  "// narrative kts comment two: apply the kotlin-jvm plugin for compilation",
  "// narrative kts comment three: repositories are declared in settings.gradle.kts",
  "// narrative kts comment four: dependencies are resolved at configuration time",
  "// narrative kts comment five: the build task compiles all source sets",
  "// narrative kts comment six: tests are run by the check lifecycle task",
  "",
  'println("build done")',
].join("\n");

// ---------------------------------------------------------------------------
// Guard: Write of over-budget .kt — narrative stripped, survivors kept
// ---------------------------------------------------------------------------

describe("AC-KT-GUARD: guard Write of over-budget .kt strips narrative, keeps survivors", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ac-kt-guard-"));
  const ktPath = path.join(tmpDir, "User.kt");

  it("updatedInput.content: narrative gone, code lines intact, ktlint-disable + noinspection + KDoc + license header kept", async () => {
    const payload = {
      tool_name: "Write",
      tool_input: { file_path: ktPath, content: KT_OVER_BUDGET },
    };

    const { stdout, exit } = await spawnGuard(payload, tmpDir);
    expect(exit).toBe(0);

    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("permissionDecision");

    const hso = parsed.hookSpecificOutput as Record<string, unknown>;
    expect(hso).toHaveProperty("updatedInput");

    const ui = hso.updatedInput as Record<string, unknown>;
    const updated = ui.content as string;

    // Narrative prose comments must be stripped
    const origNarrative = KT_OVER_BUDGET.split("\n").filter(l =>
      l.trim().startsWith("//") &&
      !l.includes("ktlint-") &&
      !l.includes("noinspection"),
    );
    const updNarrative = updated.split("\n").filter(l =>
      l.trim().startsWith("//") &&
      !l.includes("ktlint-") &&
      !l.includes("noinspection"),
    );
    expect(updNarrative.length).toBeLessThan(origNarrative.length);

    // All 20 code lines must survive byte-identical
    for (let i = 0; i < 20; i++) {
      expect(updated).toContain(`val v${i} = ${i}`);
    }

    // ktlint-disable directive must survive
    expect(updated).toContain("// ktlint-disable no-wildcard-imports");

    // noinspection directive must survive
    expect(updated).toContain("//noinspection SpellCheckingInspection");

    // KDoc block must survive
    expect(updated).toContain("/**");
    expect(updated).toContain(" * Finds the user by numeric identifier.");
    expect(updated).toContain("*/");

    // License header before package must survive
    expect(updated).toContain("/* Copyright 2024 Acme Corp.");

    const ctx = hso.additionalContext as string;
    expect(ctx).toContain("not another session's edit");
  });
});

// ---------------------------------------------------------------------------
// Gate: Stop autofix of over-budget .kt — file fixed on disk
// ---------------------------------------------------------------------------

describe("AC-KT-GATE: gate Stop autofix of over-budget .kt — file fixed on disk, stdout reports autofix", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ac-kt-gate-"));
  const ktPath = path.join(tmpDir, "Repo.kt");

  const KT_GATE_CONTENT = [
    "package com.example",
    "",
    ...Array.from({ length: 20 }, (_, i) => `val g${i} = ${i}`),
    "",
    "// narrative gate comment one: the repository scans all entities on boot",
    "// narrative gate comment two: caching is handled by the service layer",
    "// narrative gate comment three: indexes are rebuilt on the first query",
    "// narrative gate comment four: the config key is repository.scan.depth",
    "// narrative gate comment five: defaults to depth three when not set",
    "// narrative gate comment six: scan results are logged at debug level",
    "",
  ].join("\n");

  it("gate removes narrative comments from disk; stdout is hookSpecificOutput with auto-removed text", () => {
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");

    writeFileSync(ktPath, KT_GATE_CONTENT);

    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [ktPath], ts);

    const r = spawnGate({
      hook_event_name: "Stop",
      session_id: `ac-kt-gate-${Date.now()}`,
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

    const diskContent = readFileSync(ktPath, "utf8");
    expect(diskContent).not.toContain("// narrative gate comment one");
    expect(diskContent).not.toContain("// narrative gate comment two");

    for (let i = 0; i < 20; i++) {
      expect(diskContent).toContain(`val g${i} = ${i}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Guard: Write of over-budget .kts — routes to kotlin adapter, narrative stripped
// ---------------------------------------------------------------------------

describe("AC-KTS-GUARD: guard Write of over-budget .kts routes to kotlin adapter", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ac-kts-guard-"));
  const ktsPath = path.join(tmpDir, "build.gradle.kts");

  it("updatedInput.content: .kts narrative stripped, code lines intact", async () => {
    const payload = {
      tool_name: "Write",
      tool_input: { file_path: ktsPath, content: KTS_OVER_BUDGET },
    };

    const { stdout, exit } = await spawnGuard(payload, tmpDir);
    expect(exit).toBe(0);

    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("permissionDecision");

    const hso = parsed.hookSpecificOutput as Record<string, unknown>;
    expect(hso).toHaveProperty("updatedInput");

    const ui = hso.updatedInput as Record<string, unknown>;
    const updated = ui.content as string;

    // Narrative prose comments must be stripped
    const origNarrative = KTS_OVER_BUDGET.split("\n").filter(l =>
      l.trim().startsWith("//"),
    );
    const updNarrative = updated.split("\n").filter(l =>
      l.trim().startsWith("//"),
    );
    expect(updNarrative.length).toBeLessThan(origNarrative.length);

    // All 20 code lines must survive
    for (let i = 0; i < 20; i++) {
      expect(updated).toContain(`val s${i} = ${i}`);
    }

    const ctx = hso.additionalContext as string;
    expect(ctx).toContain("not another session's edit");
  });
});
