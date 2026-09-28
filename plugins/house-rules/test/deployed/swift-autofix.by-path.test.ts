// Swift autofix through guard.ts / gate.ts spawned by path, as plugin.json registers them.

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

const SWIFT_OVER_BUDGET = [
  "import Foundation",
  "",
  "// MARK: - Lifecycle",
  "// swiftlint:disable force_cast",
  "// https://developer.apple.com/doc",
  "",
  "// narrative guard comment one: this variable is used for something important",
  "// narrative guard comment two: the following call logs the result to stdout",
  "// narrative guard comment three: we need this for debugging purposes",
  "// narrative guard comment four: this is explaining the architecture",
  "// narrative guard comment five: more explanation of the design decision",
  "// narrative guard comment six: final note about what happens next",
  ...Array.from({ length: 20 }, (_, i) => `let v${i} = ${i}`),
].join("\n");

describe("Swift by-path guard: Write of over-budget .swift strips narrative, keeps directives", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ac-swift-guard-"));
  const swiftPath = path.join(tmpDir, "Calculator.swift");

  it("updatedInput.content: narrative stripped, MARK and URL directives kept, code intact", async () => {
    const payload = {
      tool_name: "Write",
      tool_input: { file_path: swiftPath, content: SWIFT_OVER_BUDGET },
    };

    const { stdout, exit } = await spawnGuard(payload, tmpDir);
    expect(exit).toBe(0);

    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("permissionDecision");

    const hso = parsed.hookSpecificOutput as Record<string, unknown>;
    expect(hso).toHaveProperty("updatedInput");

    const ui = hso.updatedInput as Record<string, unknown>;
    const updated = ui.content as string;

    expect(updated).toContain("// MARK: - Lifecycle");
    expect(updated).toContain("// swiftlint:disable force_cast");
    expect(updated).toContain("// https://developer.apple.com/doc");

    const origNarrative = SWIFT_OVER_BUDGET.split("\n").filter(l =>
      l.trim().startsWith("//") && l.includes("narrative guard comment"),
    );
    const updNarrative = updated.split("\n").filter(l =>
      l.trim().startsWith("//") && l.includes("narrative guard comment"),
    );
    expect(updNarrative.length).toBeLessThan(origNarrative.length);

    for (let i = 0; i < 20; i++) {
      expect(updated).toContain(`let v${i} = ${i}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Gate: Stop autofix of over-budget .swift — file fixed on disk
// ---------------------------------------------------------------------------

const BASE_SWIFT_GATE = [
  "import Foundation",
  "",
  ...Array.from({ length: 20 }, (_, i) => `let x${i} = ${i}`),
].join("\n");

const SWIFT_GATE_OVER_BUDGET = [
  "import Foundation",
  "",
  "// MARK: - Module",
  "// swiftlint:disable force_cast",
  "// narrative gate comment one: this module defines constants",
  "// narrative gate comment two: each constant is a numeric value",
  "// narrative gate comment three: these are used across the codebase",
  "// narrative gate comment four: the values are sequential integers",
  "// narrative gate comment five: this file follows Swift conventions",
  "// narrative gate comment six: imported wherever constants are needed",
  ...Array.from({ length: 20 }, (_, i) => `let x${i} = ${i}`),
].join("\n");

describe("Swift by-path gate: Stop autofix of over-budget .swift — file fixed on disk", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ac-swift-gate-"));
  const swiftPath = path.join(tmpDir, "constants.swift");

  it("gate removes narrative comments from disk; directives survive; stdout is hookSpecificOutput", () => {
    initGitRepo(tmpDir);
    writeFileSync(swiftPath, BASE_SWIFT_GATE);
    gitCommit(tmpDir, "initial");

    writeFileSync(swiftPath, SWIFT_GATE_OVER_BUDGET);

    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [swiftPath], ts);

    const r = spawnGate({
      hook_event_name: "Stop",
      session_id: `ac-swift-gate-${Date.now()}`,
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

    const diskContent = readFileSync(swiftPath, "utf8");
    expect(diskContent).not.toContain("// narrative gate comment one");
    expect(diskContent).not.toContain("// narrative gate comment six");

    expect(diskContent).toContain("// MARK: - Module");
    expect(diskContent).toContain("// swiftlint:disable force_cast");

    for (let i = 0; i < 20; i++) {
      expect(diskContent).toContain(`let x${i} = ${i}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Gate: Package.swift — swift-tools-version:5.9 on line 1 byte-identical after autofix
// ---------------------------------------------------------------------------

const BASE_PACKAGE_SWIFT = [
  "// swift-tools-version:5.9",
  "import PackageDescription",
  "",
  "let package = Package(",
  '    name: "MyPackage",',
  "    targets: [",
  '        .target(name: "MyTarget"),',
  "    ]",
  ")",
].join("\n");

const PACKAGE_SWIFT_OVER_BUDGET = [
  "// swift-tools-version:5.9",
  "import PackageDescription",
  "",
  "// MARK: - Package",
  "// swiftlint:disable:next line_length",
  "// narrative package comment one: this defines the Swift package manifest",
  "// narrative package comment two: targets are defined in the targets array",
  "// narrative package comment three: products list what the package exposes",
  "// narrative package comment four: dependencies are listed separately",
  "// narrative package comment five: the swift tools version must be on line 1",
  "// narrative package comment six: SwiftPM reads it before anything else",
  "",
  "let package = Package(",
  '    name: "MyPackage",',
  "    targets: [",
  '        .target(name: "MyTarget"),',
  "    ]",
  ")",
].join("\n");

const PACKAGE_SENTINEL = "// narrative package comment six: SwiftPM reads it before anything else";

describe("Swift by-path gate: Package.swift — swift-tools-version:5.9 byte-identical on line 1", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ac-swift-pkg-"));
  const pkgPath = path.join(tmpDir, "Package.swift");

  it("line 1 is '// swift-tools-version:5.9' byte-identical; at least one plain comment stripped", () => {
    initGitRepo(tmpDir);
    writeFileSync(pkgPath, BASE_PACKAGE_SWIFT);
    gitCommit(tmpDir, "initial");

    writeFileSync(pkgPath, PACKAGE_SWIFT_OVER_BUDGET);
    expect(PACKAGE_SWIFT_OVER_BUDGET).toContain(PACKAGE_SENTINEL);

    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [pkgPath], ts);

    const r = spawnGate({
      hook_event_name: "Stop",
      session_id: `ac-swift-pkg-${Date.now()}`,
      transcript_path: tp,
      cwd: tmpDir,
      stop_hook_active: false,
    });

    expect(r.status).toBe(0);

    const parsed = JSON.parse(r.stdout.trim()) as Record<string, unknown>;
    expect(parsed.decision).not.toBe("block");

    const diskContent = readFileSync(pkgPath, "utf8");
    const firstLine = diskContent.split("\n")[0];
    expect(firstLine).toBe("// swift-tools-version:5.9");

    expect(diskContent).not.toContain(PACKAGE_SENTINEL);

    expect(diskContent).toContain("// MARK: - Package");
    expect(diskContent).toContain("// swiftlint:disable:next line_length");
  });
});


const BASE_PACKAGE_NOHEADER = [
  "",
  "// swift-tools-version: 5.9",
  "import PackageDescription",
  "",
  "let package = Package(",
  '    name: "MyPackage",',
  "    targets: [",
  '        .target(name: "MyTarget"),',
  "    ]",
  ")",
].join("\n");

const PACKAGE_NOHEADER_OVER_BUDGET = [
  "",
  "// swift-tools-version: 5.9",
  "import PackageDescription",
  "",
  "// MARK: - Package Setup",
  "// swiftlint:disable:next line_length",
  "",
  "// narrative noheader comment one: the blank first line is legal SwiftPM syntax",
  "// narrative noheader comment two: SwiftPM accepts blank lines before the directive",
  "// narrative noheader comment three: this tests the marker-only protection path",
  "// narrative noheader comment four: the header classifier sees row 0 as blank",
  "// narrative noheader comment five: so the tools-version line is NOT in the header group",
  "// narrative noheader comment six: only SWIFT_TOOL_MARKERS can keep it alive",
  "",
  "let package = Package(",
  '    name: "MyPackage",',
  "    targets: [",
  '        .target(name: "MyTarget"),',
  "    ]",
  ")",
].join("\n");

const NOHEADER_SENTINEL = "// narrative noheader comment six: only SWIFT_TOOL_MARKERS can keep it alive";

describe("Swift by-path gate: Package.swift — non-header swift-tools-version line protected by SWIFT_TOOL_MARKERS", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ac-swift-nohdr-"));
  const pkgPath = path.join(tmpDir, "Package.swift");

  it("line 0 is '' and line 1 is '// swift-tools-version: 5.9' byte-identical; at least one narrative comment stripped", () => {
    initGitRepo(tmpDir);
    writeFileSync(pkgPath, BASE_PACKAGE_NOHEADER);
    gitCommit(tmpDir, "initial");

    writeFileSync(pkgPath, PACKAGE_NOHEADER_OVER_BUDGET);
    expect(PACKAGE_NOHEADER_OVER_BUDGET).toContain(NOHEADER_SENTINEL);

    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [pkgPath], ts);

    const r = spawnGate({
      hook_event_name: "Stop",
      session_id: `ac-swift-nohdr-${Date.now()}`,
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

    const diskContent = readFileSync(pkgPath, "utf8");
    const lines = diskContent.split("\n");

    // Line 0 must still be blank
    expect(lines[0]).toBe("");

    // Line 1 must be byte-identical — protected only by SWIFT_TOOL_MARKERS (not header)
    expect(lines[1]).toBe("// swift-tools-version: 5.9");

    // At least one narrative comment must have been removed (non-vacuous)
    expect(diskContent).not.toContain(NOHEADER_SENTINEL);

    // Tool directives survive
    expect(diskContent).toContain("// MARK: - Package Setup");
    expect(diskContent).toContain("// swiftlint:disable:next line_length");
  });
});
