/**
 * Swift autofix tests: guard strips over-budget comments, gate autofixes,
 * load-bearing directives (esp. swift-tools-version) survive byte-identical.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { check } from "../../src/hooks/guard.js";
import { run } from "../../src/hooks/gate.js";
import { classifyComments, parseText } from "../../src/hooks/languages/parse.js";
import { getParser } from "../../src/hooks/lib/tree-sitter-loader.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(fp: string): string {
  return createHash("sha256").update(readFileSync(fp)).digest("hex");
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
  const transcriptPath = path.join(tmpDir, "transcript.jsonl");
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

function getHso(r: { stdout: string }): Record<string, unknown> {
  const s = r.stdout.trim();
  if (!s) return {};
  const parsed = JSON.parse(s) as Record<string, unknown>;
  return (parsed.hookSpecificOutput as Record<string, unknown>) ?? {};
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_SWIFT = `import Foundation

struct Calculator {
    func add(_ a: Int, _ b: Int) -> Int {
        return a + b
    }

    func multiply(_ a: Int, _ b: Int) -> Int {
        return a * b
    }

    func subtract(_ a: Int, _ b: Int) -> Int {
        return a - b
    }

    func divide(_ a: Int, _ b: Int) -> Int {
        return a / b
    }

    func modulo(_ a: Int, _ b: Int) -> Int {
        return a % b
    }

    func power(_ a: Int, _ b: Int) -> Int {
        return Int(pow(Double(a), Double(b)))
    }

    func abs(_ a: Int) -> Int {
        return a < 0 ? -a : a
    }

    func min(_ a: Int, _ b: Int) -> Int {
        return a < b ? a : b
    }

    func max(_ a: Int, _ b: Int) -> Int {
        return a > b ? a : b
    }
}
`;

// Over-budget: directives that MUST survive + many narrative comments that MAY be stripped.
const SESSION_SWIFT_OVER_BUDGET = `import Foundation

// MARK: - Lifecycle
// swiftlint:disable force_cast
// swiftlint:disable:next line_length
// TODO(WP-12): fix
// https://developer.apple.com/doc
// -----
/// This is a Swift doc comment.
/** Block doc comment. */

// NarrativeA this comment has no value and should be stripped by autofix
// NarrativeB this comment has no value and should be stripped by autofix
// NarrativeC this comment has no value and should be stripped by autofix
// NarrativeD this comment has no value and should be stripped by autofix
// NarrativeE this comment has no value and should be stripped by autofix
// NarrativeF this comment has no value and should be stripped by autofix
// NarrativeG this comment has no value and should be stripped by autofix
// NarrativeH this comment has no value and should be stripped by autofix
// NarrativeI this comment has no value and should be stripped by autofix
// NarrativeJ this comment has no value and should be stripped by autofix

struct Calculator {
    func add(_ a: Int, _ b: Int) -> Int {
        return a + b
    }

    func multiply(_ a: Int, _ b: Int) -> Int {
        return a * b
    }

    func subtract(_ a: Int, _ b: Int) -> Int {
        return a - b
    }

    func divide(_ a: Int, _ b: Int) -> Int {
        return a / b
    }

    func modulo(_ a: Int, _ b: Int) -> Int {
        return a % b
    }

    func power(_ a: Int, _ b: Int) -> Int {
        return Int(pow(Double(a), Double(b)))
    }

    func abs(_ a: Int) -> Int {
        return a < 0 ? -a : a
    }

    func min(_ a: Int, _ b: Int) -> Int {
        return a < b ? a : b
    }

    func max(_ a: Int, _ b: Int) -> Int {
        return a > b ? a : b
    }
}
`;

const NARRATIVE_SENTINEL = "// NarrativeJ this comment has no value and should be stripped by autofix";

// ---------------------------------------------------------------------------
// Guard tests: PreToolUse strips over-budget narratives, keeps directives
// ---------------------------------------------------------------------------

const TEMP_DIR = mkdtempSync(path.join(os.tmpdir(), "guard-swift-"));
process.env.CLAUDE_PROJECT_DIR = TEMP_DIR;

describe("Swift guard: Write of over-budget .swift strips narratives, keeps directives", () => {
  let hso: Record<string, unknown>;
  let content: string;

  beforeAll(async () => {
    const filePath = path.join(TEMP_DIR, "Calculator.swift");
    const r = await check(
      { tool_name: "Write", tool_input: { file_path: filePath, content: SESSION_SWIFT_OVER_BUDGET }, cwd: TEMP_DIR },
      { readFile: () => null },
    );
    hso = getHso(r);
    const ui = hso.updatedInput as Record<string, unknown> | undefined;
    content = typeof ui?.content === "string" ? ui.content : "";
  });

  it("updatedInput is present (guard triggered)", () => {
    expect(hso).toHaveProperty("updatedInput");
  });

  it("/// doc comment survives", () => {
    expect(content).toContain("/// This is a Swift doc comment.");
  });

  it("/** */ block doc comment survives", () => {
    expect(content).toContain("/** Block doc comment. */");
  });

  it("// MARK: - Lifecycle survives", () => {
    expect(content).toContain("// MARK: - Lifecycle");
  });

  it("// swiftlint:disable force_cast survives", () => {
    expect(content).toContain("// swiftlint:disable force_cast");
  });

  it("// swiftlint:disable:next line_length survives", () => {
    expect(content).toContain("// swiftlint:disable:next line_length");
  });

  it("// TODO(WP-12): fix survives (NOTE_MARKER_RE)", () => {
    expect(content).toContain("// TODO(WP-12): fix");
  });

  it("// https://developer.apple.com/doc survives (URL_RE)", () => {
    expect(content).toContain("// https://developer.apple.com/doc");
  });

  it("// ----- survives (DIVIDER_RE)", () => {
    expect(content).toContain("// -----");
  });

  it("code tokens unchanged (struct Calculator, func add)", () => {
    expect(content).toContain("struct Calculator {");
    expect(content).toContain("func add(_ a: Int, _ b: Int) -> Int {");
  });

  it("positive control: NarrativeJ sentinel is absent (stripped)", () => {
    expect(SESSION_SWIFT_OVER_BUDGET).toContain(NARRATIVE_SENTINEL);
    expect(content).not.toContain(NARRATIVE_SENTINEL);
  });
});

describe("Swift guard: Edit of over-budget .swift strips narratives, keeps directives", () => {
  const PRE_CONTENT = `import Foundation

struct Calculator {
    func add(_ a: Int, _ b: Int) -> Int {
        return a + b
    }

    func multiply(_ a: Int, _ b: Int) -> Int {
        return a * b
    }

    func subtract(_ a: Int, _ b: Int) -> Int {
        return a - b
    }

    func divide(_ a: Int, _ b: Int) -> Int {
        return a / b
    }

    func modulo(_ a: Int, _ b: Int) -> Int {
        return a % b
    }

    func power(_ a: Int, _ b: Int) -> Int {
        return Int(pow(Double(a), Double(b)))
    }

    func abs(_ a: Int) -> Int {
        return a < 0 ? -a : a
    }

    func min(_ a: Int, _ b: Int) -> Int {
        return a < b ? a : b
    }

    func max(_ a: Int, _ b: Int) -> Int {
        return a > b ? a : b
    }
}
`;

  const OLD_STRING = `    func max(_ a: Int, _ b: Int) -> Int {
        return a > b ? a : b
    }`;

  const newNarratives = [
    "    // MARK: - Lifecycle",
    "    // swiftlint:disable force_cast",
    ...Array.from({ length: 20 }, (_, i) => `    // narrative filler edit ${i}`),
  ].join("\n");

  const NEW_STRING = `    func max(_ a: Int, _ b: Int) -> Int {
        return a > b ? a : b
    }
${newNarratives}`;

  let hso: Record<string, unknown>;

  beforeAll(async () => {
    const filePath = path.join(TEMP_DIR, "calculator_edit.swift");
    const r = await check(
      { tool_name: "Edit", tool_input: { file_path: filePath, old_string: OLD_STRING, new_string: NEW_STRING }, cwd: TEMP_DIR },
      { readFile: () => PRE_CONTENT },
    );
    hso = getHso(r);
  });

  it("updatedInput is present", () => {
    expect(hso).toHaveProperty("updatedInput");
  });

  it("MARK directive in new_string survives", () => {
    const ui = hso.updatedInput as Record<string, unknown> | undefined;
    const ns = typeof ui?.new_string === "string" ? ui.new_string : "";
    expect(ns).toContain("// MARK: - Lifecycle");
  });

  it("at least one narrative filler is stripped from new_string", () => {
    const ui = hso.updatedInput as Record<string, unknown> | undefined;
    const ns = typeof ui?.new_string === "string" ? ui.new_string : "";
    expect(NEW_STRING).toContain("// narrative filler edit 19");
    expect(ns).not.toContain("// narrative filler edit 19");
  });
});

// ---------------------------------------------------------------------------
// Gate autofix tests: Stop gate rewrites on-disk .swift file
// ---------------------------------------------------------------------------

describe("Swift gate AC: default-stable — Stop gate rewrites over-budget .swift", () => {
  let tmpDir: string;
  let shadowTmpDir: string;
  let sessionId: string;
  let fp: string;
  let tp: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-swift-gate-"));
    shadowTmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-swift-gate-sh-"));
    sessionId = `swift-gate-${Date.now()}`;

    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, "Calculator.swift"), BASE_SWIFT);
    gitCommit(tmpDir, "initial");

    fp = path.join(tmpDir, "Calculator.swift");
    writeFileSync(fp, SESSION_SWIFT_OVER_BUDGET);
    tp = makeTranscript(tmpDir, [fp], new Date(Date.now() - 5000).toISOString());
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { }
    try { rmSync(shadowTmpDir, { recursive: true, force: true }); } catch { }
  });

  it("hash changed; directives survive; no block", async () => {
    const hashBefore = sha256(fp);

    const r = await run(
      { hook_event_name: "Stop", session_id: sessionId, transcript_path: tp, cwd: tmpDir },
      { ...process.env, CLAUDE_PROJECT_DIR: tmpDir } as Record<string, string | undefined>,
      { testOnly_tmpDir: shadowTmpDir } as any,
    );

    const out = JSON.parse(r.stdout.trim() || "{}") as Record<string, unknown>;
    expect(sha256(fp)).not.toBe(hashBefore);
    expect(out.decision).not.toBe("block");

    const content = readFileSync(fp, "utf8");
    expect(content).toContain("// MARK: - Lifecycle");
    expect(content).toContain("// swiftlint:disable force_cast");
    expect(content).toContain("// swiftlint:disable:next line_length");
    expect(content).toContain("// TODO(WP-12): fix");
    expect(content).toContain("// https://developer.apple.com/doc");
    expect(content).toContain("// -----");
    expect(content).toContain("/// This is a Swift doc comment.");
    expect(content).toContain("struct Calculator {");
  });

  it("gate autofix: no parse errors in resulting file (plain comment stripped)", async () => {
    await run(
      { hook_event_name: "Stop", session_id: sessionId, transcript_path: tp, cwd: tmpDir },
      { ...process.env, CLAUDE_PROJECT_DIR: tmpDir } as Record<string, string | undefined>,
      { testOnly_tmpDir: shadowTmpDir } as any,
    );

    const content = readFileSync(fp, "utf8");
    expect(content).not.toContain("NarrativeJ");
    expect(content).toContain("struct Calculator {");
  });
});

// ---------------------------------------------------------------------------
// Case 14: Package.swift — line 1 byte-identical, plain comment stripped
// ---------------------------------------------------------------------------

const BASE_PACKAGE_SWIFT = `// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "MyPackage",
    targets: [
        .target(name: "MyTarget"),
    ]
)
`;

// Over-budget: swift-tools-version on line 1 + many narrative comments.
const SESSION_PACKAGE_SWIFT_OVER_BUDGET = `// swift-tools-version:5.9
import PackageDescription

// swiftlint:disable:next line_length
// MARK: - Package Definition

// NarrativePackageA this comment adds no value and should be stripped by autofix
// NarrativePackageB this comment adds no value and should be stripped by autofix
// NarrativePackageC this comment adds no value and should be stripped by autofix
// NarrativePackageD this comment adds no value and should be stripped by autofix
// NarrativePackageE this comment adds no value and should be stripped by autofix
// NarrativePackageF this comment adds no value and should be stripped by autofix
// NarrativePackageG this comment adds no value and should be stripped by autofix
// NarrativePackageH this comment adds no value and should be stripped by autofix
// NarrativePackageI this comment adds no value and should be stripped by autofix
// NarrativePackageJ this comment adds no value and should be stripped by autofix

let package = Package(
    name: "MyPackage",
    targets: [
        .target(name: "MyTarget"),
    ]
)
`;

const PACKAGE_NARRATIVE_SENTINEL = "// NarrativePackageJ this comment adds no value and should be stripped by autofix";

describe("Swift gate case 14: Package.swift — swift-tools-version:5.9 on line 1 byte-identical after autofix", () => {
  let tmpDir: string;
  let shadowTmpDir: string;
  let sessionId: string;
  let fp: string;
  let tp: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-pkg-swift-"));
    shadowTmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-pkg-swift-sh-"));
    sessionId = `swift-pkg-${Date.now()}`;

    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, "Package.swift"), BASE_PACKAGE_SWIFT);
    gitCommit(tmpDir, "initial");

    fp = path.join(tmpDir, "Package.swift");
    writeFileSync(fp, SESSION_PACKAGE_SWIFT_OVER_BUDGET);
    tp = makeTranscript(tmpDir, [fp], new Date(Date.now() - 5000).toISOString());
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { }
    try { rmSync(shadowTmpDir, { recursive: true, force: true }); } catch { }
  });

  it("line 1 is byte-identical '// swift-tools-version:5.9' after autofix; at least one plain comment removed", async () => {
    expect(SESSION_PACKAGE_SWIFT_OVER_BUDGET).toContain(PACKAGE_NARRATIVE_SENTINEL);

    const r = await run(
      { hook_event_name: "Stop", session_id: sessionId, transcript_path: tp, cwd: tmpDir },
      { ...process.env, CLAUDE_PROJECT_DIR: tmpDir } as Record<string, string | undefined>,
      { testOnly_tmpDir: shadowTmpDir } as any,
    );

    const out = JSON.parse(r.stdout.trim() || "{}") as Record<string, unknown>;
    expect(out.decision).not.toBe("block");

    const content = readFileSync(fp, "utf8");
    const firstLine = content.split("\n")[0];
    expect(firstLine).toBe("// swift-tools-version:5.9");

    expect(content).not.toContain(PACKAGE_NARRATIVE_SENTINEL);

    expect(content).toContain("// swiftlint:disable:next line_length");
    expect(content).toContain("// MARK: - Package Definition");
  });
});

// ---------------------------------------------------------------------------
// Case F15: Package.swift — non-header swift-tools-version protected by marker only
//
// ---------------------------------------------------------------------------

// Fixture: row 0 blank, row 1 = tools-version (with space variant), then narrative flood.
const F15_BASE_PACKAGE_SWIFT = `
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "F15Package",
    targets: [
        .target(name: "F15Target"),
    ]
)
`;

const F15_OVER_BUDGET = `
// swift-tools-version: 5.9
import PackageDescription

// F15NarrativeA this is a plain narrative comment with no tool value
// F15NarrativeB this is a plain narrative comment with no tool value
// F15NarrativeC this is a plain narrative comment with no tool value
// F15NarrativeD this is a plain narrative comment with no tool value
// F15NarrativeE this is a plain narrative comment with no tool value
// F15NarrativeF this is a plain narrative comment with no tool value
// F15NarrativeG this is a plain narrative comment with no tool value
// F15NarrativeH this is a plain narrative comment with no tool value
// F15NarrativeI this is a plain narrative comment with no tool value
// F15NarrativeJ this is a plain narrative comment with no tool value
// F15NarrativeK this is a plain narrative comment with no tool value
// F15NarrativeL this is a plain narrative comment with no tool value

let package = Package(
    name: "F15Package",
    targets: [
        .target(name: "F15Target"),
    ]
)
`;

const F15_NARRATIVE_SENTINEL = "// F15NarrativeL this is a plain narrative comment with no tool value";
const F15_TOOLS_LINE = "// swift-tools-version: 5.9";

describe("(F15) swift-tools-version on row 1 (row 0 blank): header===false, directive===true", () => {
  it("// swift-tools-version: 5.9 on row 1 has header=false", async () => {
    const r = await parseText(F15_OVER_BUDGET, "swift", getParser);
    if (!r.ok) throw new Error(`parseText failed: ${r.reason}`);
    const cls = classifyComments(r.tree.rootNode, F15_OVER_BUDGET, "swift");
    const c = cls.find((x) => x.text === F15_TOOLS_LINE);
    if (!c) throw new Error(`Comment not found: ${JSON.stringify(F15_TOOLS_LINE)}`);
    expect(c.header).toBe(false);
  });

  it("// swift-tools-version: 5.9 on row 1 has directive=true (marker-only)", async () => {
    const r = await parseText(F15_OVER_BUDGET, "swift", getParser);
    if (!r.ok) throw new Error(`parseText failed: ${r.reason}`);
    const cls = classifyComments(r.tree.rootNode, F15_OVER_BUDGET, "swift");
    const c = cls.find((x) => x.text === F15_TOOLS_LINE);
    if (!c) throw new Error(`Comment not found: ${JSON.stringify(F15_TOOLS_LINE)}`);
    expect(c.directive).toBe(true);
  });
});

describe("(F15) gate autofix: non-header swift-tools-version: 5.9 (with space) preserved byte-identical; narrative stripped", () => {
  let tmpDir: string;
  let shadowTmpDir: string;
  let sessionId: string;
  let fp: string;
  let tp: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-f15-pkg-"));
    shadowTmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-f15-sh-"));
    sessionId = `swift-f15-${Date.now()}`;

    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, "Package.swift"), F15_BASE_PACKAGE_SWIFT);
    gitCommit(tmpDir, "initial");

    fp = path.join(tmpDir, "Package.swift");
    writeFileSync(fp, F15_OVER_BUDGET);
    tp = makeTranscript(tmpDir, [fp], new Date(Date.now() - 5000).toISOString());
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { }
    try { rmSync(shadowTmpDir, { recursive: true, force: true }); } catch { }
  });

  it("line index 1 is byte-identical '// swift-tools-version: 5.9' after autofix; at least one narrative removed", async () => {
    // Non-vacuous pre-check: sentinel is present before autofix.
    expect(F15_OVER_BUDGET).toContain(F15_NARRATIVE_SENTINEL);

    const r = await run(
      { hook_event_name: "Stop", session_id: sessionId, transcript_path: tp, cwd: tmpDir },
      { ...process.env, CLAUDE_PROJECT_DIR: tmpDir } as Record<string, string | undefined>,
      { testOnly_tmpDir: shadowTmpDir } as any,
    );

    const out = JSON.parse(r.stdout.trim() || "{}") as Record<string, unknown>;
    expect(out.decision).not.toBe("block");

    const content = readFileSync(fp, "utf8");
    const lines = content.split("\n");
    // Row 0 blank → lines[0] is empty; tools-version is at lines[1].
    expect(lines[1]).toBe(F15_TOOLS_LINE);

    // Non-vacuous: at least one narrative stripped.
    expect(content).not.toContain(F15_NARRATIVE_SENTINEL);
  });
});
