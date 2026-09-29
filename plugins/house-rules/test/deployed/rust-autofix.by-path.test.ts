// Rust autofix through guard.ts / gate.ts spawned by path, as plugin.json registers them.

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
  const r = await parseText(content, "rust", getParser);
  expect(r.ok, `${label}: parse failed: ${r.ok ? "" : r.reason}`).toBe(true);
  if (r.ok) {
    expect(r.errorRows.size, `${label}: ERROR/MISSING nodes on rows: ${[...r.errorRows].join(",")}`).toBe(0);
  }
}

const FILLER_LINES = Array.from(
  { length: 24 },
  (_, i) => `// filler narrative ${i}: explains step ${i} of the lookup in prose`,
);

const RUST_OVER_BUDGET = [
  "//! Crate-level inner doc: user lookup service.",
  "",
  "/// Finds a user by numeric identifier.",
  "/// Returns None if not found.",
  "pub fn find_user(id: u32) -> Option<u32> { let _ = id; None }",
  "",
  "/** Block outer doc for the constant table. */",
  "pub const TABLE: u32 = 1;",
  "",
  "/*! Block inner doc kept as documentation. */",
  "",
  ...Array.from({ length: 4 }, (_, i) => `pub const FIELD${i}: u32 = ${i};`),
  "",
  "// narrative comment one: this module manages user lookups across the domain",
  "// narrative comment two: we use a linear scan for simplicity in this version",
  "// narrative comment three: cache is invalidated on every write operation here",
  "// narrative comment four: the id parameter must be a non-negative integer",
  "// narrative comment five: returns none when the backing store is empty",
  "// narrative comment six: see the design doc for performance improvement notes",
  "",
  "pub fn danger(p: *const u32) -> u32 {",
  "    // SAFETY: caller guarantees p is valid and aligned",
  "    unsafe { *p }",
  "}",
  "",
  'pub const RAW: &str = r#"// not a comment"#;',
  'pub const URL: &str = "http://x // y";',
].join("\n");

// Exact narrative lines that the hook must remove (text as they appear in the fixture)
const RUST_NARRATIVE_LINES = [
  "// narrative comment one: this module manages user lookups across the domain",
  "// narrative comment two: we use a linear scan for simplicity in this version",
  "// narrative comment three: cache is invalidated on every write operation here",
  "// narrative comment four: the id parameter must be a non-negative integer",
  "// narrative comment five: returns none when the backing store is empty",
  "// narrative comment six: see the design doc for performance improvement notes",
];

// Exact // lines that must survive (doc comments and SAFETY marker), in file order
const RUST_SURVIVING_SLASH_LINES = [
  "//! Crate-level inner doc: user lookup service.",
  "/// Finds a user by numeric identifier.",
  "/// Returns None if not found.",
  "// SAFETY: caller guarantees p is valid and aligned",
];

// ---------------------------------------------------------------------------
// AC-RUST-GUARD: Write of over-budget .rs — prose stripped, survivors kept
// ---------------------------------------------------------------------------

describe("AC-RUST-GUARD: guard Write of over-budget .rs strips narrative, keeps survivors", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ac-rust-guard-"));
  const rsPath = path.join(tmpDir, "user_service.rs");

  it("exit 0; updatedInput.content: narrative gone, code intact, doc comments + SAFETY + raw string + url string kept", async () => {
    await assertParsesClean(RUST_OVER_BUDGET, "input fixture");

    const payload = {
      tool_name: "Write",
      tool_input: { file_path: rsPath, content: RUST_OVER_BUDGET },
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

    for (const line of RUST_NARRATIVE_LINES) {
      expect(updated).not.toContain(line);
    }


    // Exact list of surviving // comment lines
    const survivingSlashSlash = updated.split("\n").filter(l => l.trim().startsWith("//")).map(l => l.trim());
    expect(survivingSlashSlash).toEqual(RUST_SURVIVING_SLASH_LINES);

    // Block docs survive; no other block comment residue
    expect(updated).toContain("/** Block outer doc for the constant table. */");
    expect(updated).toContain("/*! Block inner doc kept as documentation. */");
    expect(updated.match(/\*\//g)?.length).toBe(2);

    // All 4 consts must survive byte-identical
    for (let i = 0; i < 4; i++) {
      expect(updated).toContain(`pub const FIELD${i}: u32 = ${i};`);
    }

    expect(updated).toContain("unsafe { *p }");

    // Raw string and URL string containing // must be untouched
    expect(updated).toContain('pub const RAW: &str = r#"// not a comment"#;');
    expect(updated).toContain('pub const URL: &str = "http://x // y";');

    const ctx = hso.additionalContext as string;
    expect(ctx).toContain("not another session's edit");
  });
});

// ---------------------------------------------------------------------------
// AC-RUST-GATE: Stop autofix of over-budget .rs — file fixed on disk
// ---------------------------------------------------------------------------

describe("AC-RUST-GATE: gate Stop autofix of over-budget .rs — file fixed on disk, stdout reports autofix", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ac-rust-gate-"));
  const rsPath = path.join(tmpDir, "repository.rs");

  const RUST_GATE_CONTENT = [
    "//! Repository for entity lookup.",
    "",
    "/// Scans the entity store.",
    "pub fn scan() {}",
    "",
    ...Array.from({ length: 4 }, (_, i) => `pub const G${i}: u32 = ${i};`),
    "",
    "/* nested gate narrative /* inner gate part */ outer gate part */",
    "// narrative gate comment one: the repository scans all entities on boot",
    "// narrative gate comment two: caching is handled by the service layer",
    "// narrative gate comment three: indexes are rebuilt on the first query",
    "// narrative gate comment four: the config key is repository.scan.depth",
    "// narrative gate comment five: defaults to depth three when not set",
    "// narrative gate comment six: scan results are logged at debug level",
    ...FILLER_LINES,
    "",
    "pub fn read(p: *const u32) -> u32 {",
    "    // SAFETY: caller guarantees p is valid",
    "    unsafe { *p }",
    "}",
    "",
    'pub const RAW: &str = r#"// not a comment"#;',
  ].join("\n");

  const GATE_NARRATIVE_LINES = [
    "// narrative gate comment one: the repository scans all entities on boot",
    "// narrative gate comment two: caching is handled by the service layer",
    "// narrative gate comment three: indexes are rebuilt on the first query",
    "// narrative gate comment four: the config key is repository.scan.depth",
    "// narrative gate comment five: defaults to depth three when not set",
    "// narrative gate comment six: scan results are logged at debug level",
    ...FILLER_LINES,
  ];

  const GATE_SURVIVING_LINES = [
    "//! Repository for entity lookup.",
    "/// Scans the entity store.",
    "// SAFETY: caller guarantees p is valid",
  ];

  it("gate removes narrative from disk; docs + SAFETY survive; stdout has auto-removed, not-another-session's-edit, and rs filename", async () => {
    await assertParsesClean(RUST_GATE_CONTENT, "gate input fixture");

    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");

    writeFileSync(rsPath, RUST_GATE_CONTENT);

    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [rsPath], ts);

    const r = spawnGate({
      hook_event_name: "Stop",
      session_id: `ac-rust-gate-${Date.now()}`,
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
    expect(ctx).toContain("repository.rs");

    const diskContent = readFileSync(rsPath, "utf8");

    await assertParsesClean(diskContent, "gate disk result");

    for (const line of GATE_NARRATIVE_LINES) {
      expect(diskContent).not.toContain(line);
    }

    expect(diskContent).not.toContain("nested gate narrative");
    expect(diskContent).not.toContain("outer gate part");
    expect(diskContent).not.toContain("*/");

    const survivingSlashSlash = diskContent.split("\n").filter(l => l.trim().startsWith("//")).map(l => l.trim());
    expect(survivingSlashSlash).toEqual(GATE_SURVIVING_LINES);

    for (let i = 0; i < 4; i++) {
      expect(diskContent).toContain(`pub const G${i}: u32 = ${i};`);
    }

    expect(diskContent).toContain('pub const RAW: &str = r#"// not a comment"#;');
  });
});

describe("AC-RUST-UNDER: guard Write of under-budget .rs — passes through with empty stdout", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ac-rust-under-"));
  const rsPath = path.join(tmpDir, "simple.rs");

  const RUST_UNDER_BUDGET = [
    "pub struct Simple { value: i32 }",
    "",
    "impl Simple {",
    "    pub fn value(&self) -> i32 { self.value }",
    "}",
  ].join("\n");

  it("exit 0; stdout is empty (no updatedInput injected)", async () => {
    const payload = {
      tool_name: "Write",
      tool_input: { file_path: rsPath, content: RUST_UNDER_BUDGET },
    };

    const { stdout, exit } = await spawnGuard(payload, tmpDir);
    expect(exit).toBe(0);
    expect(stdout.trim()).toBe("");
  });
});
