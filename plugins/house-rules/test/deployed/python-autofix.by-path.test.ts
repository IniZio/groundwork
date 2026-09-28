// Python autofix through guard.ts / gate.ts spawned by path, as plugin.json registers them.

import { describe, it, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { getParser } from "../../src/hooks/lib/tree-sitter-loader.js";
import { parseText } from "../../src/hooks/languages/parse.js";
import { collectCodeText } from "../../src/hooks/lib/comment-density.js";

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
  const r = await parseText(content, "python", getParser);
  expect(r.ok, `${label}: parse failed: ${r.ok ? "" : r.reason}`).toBe(true);
  if (r.ok) {
    expect(r.errorRows.size, `${label}: ERROR/MISSING nodes on rows: ${[...r.errorRows].join(",")}`).toBe(0);
  }
}

// ---------------------------------------------------------------------------
// Fixture: over-budget .py with markers, shebang, coding line, indentation cases
// ---------------------------------------------------------------------------

const PYTHON_OVER_BUDGET = [
  "#!/usr/bin/env python3",
  "# -*- coding: utf-8 -*-",
  "",
  "# type: ignore",
  "# noqa: F401",
  "# nosec",
  "# pragma: no cover",
  "",
  ...Array.from({ length: 20 }, (_, i) => `field_${i} = ${i}`),
  "",
  "# narrative comment one: this module manages user lookups across the domain",
  "# narrative comment two: we use a linear scan for simplicity in this version",
  "# narrative comment three: cache is invalidated on every write operation here",
  "# narrative comment four: the id parameter must be a non-negative integer",
  "# narrative comment five: returns none when the backing store is empty",
  "# narrative comment six: see the design doc for performance improvement notes",
  "",
  "sql = 'SELECT * FROM users # inline text not a comment'",
  "",
  "def compute(x):",
  "    if x:",
  "        # narrative comment between if and its body",
  "        return x * 2",
  "    # narrative comment at the last line of a block",
  "    return 0",
  "",
  "def lookup(item_id):",
  "    return None",
].join("\n");

const PYTHON_OVER_BUDGET_NARRATIVE_LINES = [
  "# narrative comment one: this module manages user lookups across the domain",
  "# narrative comment two: we use a linear scan for simplicity in this version",
  "# narrative comment three: cache is invalidated on every write operation here",
  "# narrative comment four: the id parameter must be a non-negative integer",
  "# narrative comment five: returns none when the backing store is empty",
  "# narrative comment six: see the design doc for performance improvement notes",
];

// Exact # lines that must survive (tool markers + shebang + coding)
const PYTHON_OVER_BUDGET_MARKER_LINES = [
  "#!/usr/bin/env python3",
  "# -*- coding: utf-8 -*-",
  "# type: ignore",
  "# noqa: F401",
  "# nosec",
  "# pragma: no cover",
];

// ---------------------------------------------------------------------------
// AC-PYTHON-GUARD: Write of over-budget .py — prose stripped, survivors kept
// ---------------------------------------------------------------------------

describe("AC-PYTHON-GUARD: guard Write of over-budget .py strips narrative, keeps survivors", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ac-python-guard-"));
  const pyPath = path.join(tmpDir, "user_service.py");

  it("exit 0; updatedInput.content: narrative gone, code intact, shebang + coding + tool markers + string literal kept", async () => {
    await assertParsesClean(PYTHON_OVER_BUDGET, "input fixture");

    const payload = {
      tool_name: "Write",
      tool_input: { file_path: pyPath, content: PYTHON_OVER_BUDGET },
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
    for (const line of PYTHON_OVER_BUDGET_NARRATIVE_LINES) {
      expect(updated).not.toContain(line);
    }

    // Exact list of surviving # comment lines (shebang + coding + tool markers only)
    const survivingHash = updated.split("\n").filter(l => l.startsWith("#"));
    expect(survivingHash).toEqual(PYTHON_OVER_BUDGET_MARKER_LINES);

    // All 20 field assignments must survive byte-identical
    for (let i = 0; i < 20; i++) {
      expect(updated).toContain(`field_${i} = ${i}`);
    }

    // Shebang must survive
    expect(updated).toContain("#!/usr/bin/env python3");

    // Coding line must survive
    expect(updated).toContain("# -*- coding: utf-8 -*-");

    // Tool markers must survive
    expect(updated).toContain("# type: ignore");
    expect(updated).toContain("# noqa: F401");
    expect(updated).toContain("# nosec");
    expect(updated).toContain("# pragma: no cover");

    // String literal containing # must be untouched
    expect(updated).toContain("sql = 'SELECT * FROM users # inline text not a comment'");

    // Indentation-sensitive function body survives and parses
    expect(updated).toContain("def compute(x):");
    expect(updated).toContain("    if x:");
    expect(updated).toContain("        return x * 2");
    expect(updated).toContain("    return 0");

    const ctx = hso.additionalContext as string;
    expect(ctx).toContain("not another session's edit");
  });
});

// ---------------------------------------------------------------------------
// AC-PYTHON-GATE: Stop autofix of over-budget .py — file fixed on disk
// ---------------------------------------------------------------------------

describe("AC-PYTHON-GATE: gate Stop autofix of over-budget .py — file fixed on disk, stdout reports autofix", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ac-python-gate-"));
  const pyPath = path.join(tmpDir, "repository.py");

  const PYTHON_GATE_CONTENT = [
    "#!/usr/bin/env python3",
    "# -*- coding: utf-8 -*-",
    "",
    "# type: ignore",
    "# noqa: E501",
    "",
    ...Array.from({ length: 20 }, (_, i) => `item_${i} = ${i}`),
    "",
    "# narrative gate comment one: the repository scans all entities on boot",
    "# narrative gate comment two: caching is handled by the service layer",
    "# narrative gate comment three: indexes are rebuilt on the first query",
    "# narrative gate comment four: the config key is repository.scan.depth",
    "# narrative gate comment five: defaults to depth three when not set",
    "# narrative gate comment six: scan results are logged at debug level",
    "",
    "def find(item_id):",
    "    if item_id:",
    "        # narrative gate comment between if and body",
    "        return item_id",
    "    # narrative gate comment last line of block",
    "    return None",
  ].join("\n");

  const GATE_NARRATIVE_LINES = [
    "# narrative gate comment one: the repository scans all entities on boot",
    "# narrative gate comment two: caching is handled by the service layer",
    "# narrative gate comment three: indexes are rebuilt on the first query",
    "# narrative gate comment four: the config key is repository.scan.depth",
    "# narrative gate comment five: defaults to depth three when not set",
    "# narrative gate comment six: scan results are logged at debug level",
  ];

  const GATE_MARKER_LINES = [
    "#!/usr/bin/env python3",
    "# -*- coding: utf-8 -*-",
    "# type: ignore",
    "# noqa: E501",
  ];

  it("gate removes narrative from disk; shebang + coding + tool markers survive; stdout has auto-removed, not-another-session's-edit, and py filename", async () => {
    await assertParsesClean(PYTHON_GATE_CONTENT, "gate input fixture");

    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");

    writeFileSync(pyPath, PYTHON_GATE_CONTENT);

    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [pyPath], ts);

    const r = spawnGate({
      hook_event_name: "Stop",
      session_id: `ac-python-gate-${Date.now()}`,
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
    expect(ctx).toContain("repository.py");

    const diskContent = readFileSync(pyPath, "utf8");

    await assertParsesClean(diskContent, "gate disk result");

    // Exact list of removed narrative comment lines
    for (const line of GATE_NARRATIVE_LINES) {
      expect(diskContent).not.toContain(line);
    }

    // Exact list of surviving # comment lines
    const survivingHash = diskContent.split("\n").filter(l => l.startsWith("#"));
    expect(survivingHash).toEqual(GATE_MARKER_LINES);

    // All 20 item assignments survive
    for (let i = 0; i < 20; i++) {
      expect(diskContent).toContain(`item_${i} = ${i}`);
    }

    expect(diskContent).toContain("#!/usr/bin/env python3");
    expect(diskContent).toContain("# -*- coding: utf-8 -*-");
    expect(diskContent).toContain("# type: ignore");
    expect(diskContent).toContain("# noqa: E501");

    expect(diskContent).toContain("def find(item_id):");
    expect(diskContent).toContain("    if item_id:");
    expect(diskContent).toContain("        return item_id");
    expect(diskContent).toContain("    return None");
  });
});


// ---------------------------------------------------------------------------
// AC-PYI-GUARD: guard Write of over-budget .pyi stub — prose stripped, markers kept
// ---------------------------------------------------------------------------

describe("AC-PYI-GUARD: guard Write of over-budget .pyi stub strips prose, keeps # type: ignore", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ac-pyi-guard-"));
  const pyiPath = path.join(tmpDir, "types_stub.pyi");

  const PYI_OVER_BUDGET = [
    "# type: ignore",
    "# noqa: F401",
    "",
    "from typing import Optional",
    "",
    ...Array.from({ length: 20 }, (_, i) => `alpha_${i} = ${i}`),
    "",
    "# stub prose one: this interface defines the read contract for the entity layer",
    "# stub prose two: all methods return typed results with no observable side effects",
    "# stub prose three: the id parameter must be a non-negative integer value here",
    "# stub prose four: returns none when the backing store has no matching record",
    "# stub prose five: callers are required to handle the optional return value safely",
    "# stub prose six: this module is intended for use by the service boundary only",
    "",
    "def f(x: int) -> str: ...",
    "def fetch(item_id: int) -> Optional[str]: ...",
    "def store(key: str, value: int) -> None: ...",
    "def delete(key: str) -> bool: ...",
  ].join("\n");

  // prose 2-6 must be removed (budget = floor(0.05 * 37) = 1 → keep only 1 prose row)
  const PYI_REMOVED_PROSE = [
    "# stub prose two: all methods return typed results with no observable side effects",
    "# stub prose three: the id parameter must be a non-negative integer value here",
    "# stub prose four: returns none when the backing store has no matching record",
    "# stub prose five: callers are required to handle the optional return value safely",
    "# stub prose six: this module is intended for use by the service boundary only",
  ];

  it("exit 0; prose stripped via guard path, # type: ignore kept, def f(x: int) -> str: ... kept, output errorRows === 0", async () => {
    await assertParsesClean(PYI_OVER_BUDGET, "pyi input fixture");

    const payload = {
      tool_name: "Write",
      tool_input: { file_path: pyiPath, content: PYI_OVER_BUDGET },
    };

    const { stdout, exit } = await spawnGuard(payload, tmpDir);
    expect(exit).toBe(0);

    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("permissionDecision");

    const hso = parsed.hookSpecificOutput as Record<string, unknown>;
    expect(hso).toHaveProperty("updatedInput");

    const ui = hso.updatedInput as Record<string, unknown>;
    const updated = ui.content as string;

    await assertParsesClean(updated, "pyi guard updatedInput.content");

    // prose 2-6 removed
    for (const line of PYI_REMOVED_PROSE) {
      expect(updated).not.toContain(line);
    }

    // tool marker survives
    expect(updated).toContain("# type: ignore");

    // stub function with neutral names survives
    expect(updated).toContain("def f(x: int) -> str: ...");

    const ctx = hso.additionalContext as string;
    expect(ctx).toContain("not another session's edit");
  });
});

// ---------------------------------------------------------------------------
// AC-PYTHON-INDENT-GUARD: guard strips prose from indentation-sensitive positions
// ---------------------------------------------------------------------------

describe("AC-PYTHON-INDENT-GUARD: guard Write strips prose from indentation-sensitive positions", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ac-python-indent-"));
  const pyPath = path.join(tmpDir, "pipeline.py");

  // (a) between if cond: and its first body statement
  const PROSE_A = "# indent prose A: this path handles the non-empty data case exclusively here";
  // (b) last line inside indented block before dedent (end of else-branch, before function dedent)
  const PROSE_B = "# indent prose B: this is the last comment inside the if block before the dedent";
  // (c) inside nested class body before method definition
  const PROSE_C = "# indent prose C: inside the nested class body before the method definition here";

  const PYTHON_INDENT_BUDGET = [
    "x_val = 1",
    "y_val = 2",
    "z_val = 3",
    "",
    "def process(data):",
    "    if data:",
    `        ${PROSE_A}`,
    "        return data * 2",
    `    ${PROSE_B}`,
    "    return 0",
    "",
    "def outer():",
    "    result = 0",
    "    class Inner:",
    `        ${PROSE_C}`,
    "        def method(self):",
    "            return True",
    "    return result",
  ].join("\n");

  let _updated = "";

  it("exit 0; prose A (between if and body), B (end of block), C (nested class) are stripped; parses clean; code text byte-identical", async () => {
    await assertParsesClean(PYTHON_INDENT_BUDGET, "indent input fixture");

    const payload = {
      tool_name: "Write",
      tool_input: { file_path: pyPath, content: PYTHON_INDENT_BUDGET },
    };

    const { stdout, exit } = await spawnGuard(payload, tmpDir);
    expect(exit).toBe(0);

    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("permissionDecision");

    const hso = parsed.hookSpecificOutput as Record<string, unknown>;
    expect(hso).toHaveProperty("updatedInput");

    const ui = hso.updatedInput as Record<string, unknown>;
    const updated = ui.content as string;
    _updated = updated;

    await assertParsesClean(updated, "indent guard updatedInput.content");

    expect(updated).not.toContain(PROSE_A);
    expect(updated).not.toContain(PROSE_B);
    expect(updated).not.toContain(PROSE_C);

    const origParsed = await parseText(PYTHON_INDENT_BUDGET, "python", getParser);
    const fixedParsed = await parseText(updated, "python", getParser);
    expect(origParsed.ok, "original parse for code-text").toBe(true);
    expect(fixedParsed.ok, "fixed parse for code-text").toBe(true);
    if (origParsed.ok && fixedParsed.ok) {
      const origCode = collectCodeText(origParsed.tree.rootNode, PYTHON_INDENT_BUDGET, "python");
      const fixedCode = collectCodeText(fixedParsed.tree.rootNode, updated, "python");
      origParsed.tree.delete();
      fixedParsed.tree.delete();
      expect(origCode).toBe(fixedCode);
    }
  });

  const python3Available = (() => {
    const r = spawnSync("python3", ["--version"], { encoding: "utf8" });
    return !r.error && r.status === 0;
  })();

  it.skipIf(!python3Available)("python3 ast.parse validates stripped output (skip when python3 absent)", () => {
    expect(_updated).not.toBe("");
    const r = spawnSync("python3", ["-c", "import ast,sys; ast.parse(sys.stdin.read())"], {
      input: _updated,
      encoding: "utf8",
    });
    expect(r.status, "python3 exit code").toBe(0);
  });
});


describe("AC-PYTHON-UNDER: guard Write of under-budget .py — passes through with empty stdout", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ac-python-under-"));
  const pyPath = path.join(tmpDir, "simple.py");

  const PYTHON_UNDER_BUDGET = [
    "#!/usr/bin/env python3",
    "",
    "def get_value():",
    "    return 0",
  ].join("\n");

  it("exit 0; stdout is empty (no updatedInput injected)", async () => {
    const payload = {
      tool_name: "Write",
      tool_input: { file_path: pyPath, content: PYTHON_UNDER_BUDGET },
    };

    const { stdout, exit } = await spawnGuard(payload, tmpDir);
    expect(exit).toBe(0);
    expect(stdout.trim()).toBe("");
  });
});
