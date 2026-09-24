import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const GATE_PATH = path.join(import.meta.dir, "../../src/hooks/gate.ts");

function initGitRepo(dir: string): void {
  spawnSync("git", ["init"], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "t@t.com"], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["config", "user.name", "T"], { cwd: dir, encoding: "utf8" });
}

function gitCommit(dir: string, msg: string): string {
  spawnSync("git", ["add", "-A"], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["commit", "--allow-empty", "-m", msg], { cwd: dir, encoding: "utf8" });
  return spawnSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
}

function runGate(payload: unknown, extraEnv: Record<string, string> = {}): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync("bun", [GATE_PATH], {
    input: JSON.stringify(payload),
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
}

function parseOut(stdout: string): Record<string, unknown> {
  const t = stdout.trim();
  if (!t) return {};
  return JSON.parse(t) as Record<string, unknown>;
}

function makeWriteTranscript(tmpDir: string, files: string[], ts: string, cwd: string): string {
  const tp = path.join(tmpDir, `transcript-${Date.now()}.jsonl`);
  const lines = files.map(fp => JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "Write", input: { file_path: fp, content: readFileSync(fp, "utf8") } }] },
    timestamp: ts,
    cwd,
  }));
  writeFileSync(tp, lines.join("\n") + "\n");
  return tp;
}

function strayFingerprint(relPath: string): string {
  const input = "stray-artifacts\0" + relPath + "\0" + relPath.trim().replace(/\s+/g, " ");
  return createHash("sha256").update(input).digest("hex");
}

describe("engine-stray-artifacts: blocks session-created root scratch file", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "ge-stray-"));
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "base");
  });

  afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

  it("blocks on session-created tmp-notes.md (root scratch pattern)", () => {
    const fp = path.join(tmpDir, "tmp-notes.md");
    writeFileSync(fp, "# notes\n");
    const ts = new Date(Date.now() - 5000).toISOString();
    const tp = makeWriteTranscript(tmpDir, [fp], ts, tmpDir);
    const r = runGate({
      hook_event_name: "Stop",
      session_id: `stray-${Date.now()}`,
      transcript_path: tp,
      cwd: tmpDir,
    });
    const out = parseOut(r.stdout);
    expect(out.decision).toBe("block");
    expect(out.reason as string).toContain("tmp-notes.md");
  });

  it("passes when stray finding is in baseline.json", () => {
    const fp = path.join(tmpDir, "tmp-notes.md");
    writeFileSync(fp, "# notes\n");
    const ts = new Date(Date.now() - 5000).toISOString();
    const tp = makeWriteTranscript(tmpDir, [fp], ts, tmpDir);
    const baselineDir = path.join(tmpDir, ".house-rules");
    mkdirSync(baselineDir, { recursive: true });
    const baseline = {
      version: 1,
      entries: [{
        rule: "stray-artifacts",
        path: "tmp-notes.md",
        fingerprint: strayFingerprint("tmp-notes.md"),
      }],
    };
    writeFileSync(path.join(baselineDir, "baseline.json"), JSON.stringify(baseline, null, 2) + "\n");
    const r = runGate({
      hook_event_name: "Stop",
      session_id: `stray-base-${Date.now()}`,
      transcript_path: tp,
      cwd: tmpDir,
    });
    const out = parseOut(r.stdout);
    expect(out.decision).not.toBe("block");
  });
});

describe("env-independence: CLAUDE_PROJECT_DIR does not affect gate output", () => {
  let tmpDir: string;
  let tp: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "ge-env-"));
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "base");
    const fp = path.join(tmpDir, "tmp-scratch.md");
    writeFileSync(fp, "# scratch\n");
    const ts = new Date(Date.now() - 5000).toISOString();
    tp = makeWriteTranscript(tmpDir, [fp], ts, tmpDir);
  });

  afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

  it("blocks with CLAUDE_PROJECT_DIR unset", () => {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k !== "CLAUDE_PROJECT_DIR" && v !== undefined) env[k] = v;
    }
    const r = runGate({ hook_event_name: "Stop", session_id: `env-unset-${Date.now()}`, transcript_path: tp, cwd: tmpDir }, env);
    expect(parseOut(r.stdout).decision).toBe("block");
  });

  it("same block result with CLAUDE_PROJECT_DIR=/tmp/nonexistent", () => {
    const r = runGate(
      { hook_event_name: "Stop", session_id: `env-set-${Date.now()}`, transcript_path: tp, cwd: tmpDir },
      { CLAUDE_PROJECT_DIR: "/tmp/nonexistent-dir-xyz" },
    );
    expect(parseOut(r.stdout).decision).toBe("block");
  });
});

describe("live-autofix-proof: typescript stable — writes file, preserves pre-existing comments", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "ge-live-"));
    initGitRepo(tmpDir);
  });

  afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

  it("removes session narration comments; preserves pre-existing; gate allows", () => {
    const preLines = [
      ...Array.from({ length: 5 }, (_, i) => `// base comment ${i}`),
      ...Array.from({ length: 45 }, (_, i) => `const b${i} = ${i};`),
    ];
    const fp = path.join(tmpDir, "proof.ts");
    writeFileSync(fp, preLines.join("\n") + "\n");
    gitCommit(tmpDir, "base");

    const logR = spawnSync("git", ["-C", tmpDir, "log", "--format=%ct", "-1"], { encoding: "utf8" });
    const baseEpoch = parseInt(logR.stdout.trim(), 10);

    // 6 narration comments in only 10 new code lines = 6/16 added = 37.5% > 5%
    // auto-fix must remove all 6 to reach 0/10 = 0%
    const sessionLines = [
      ...Array.from({ length: 10 }, (_, i) => `const s${i} = ${i};`),
      "// narration A: this sets up the values",
      "// narration B: loop body follows",
      "// narration C: we increment here",
      "// narration D: final step",
      "// narration E: done",
      "// narration F: cleanup",
    ];
    writeFileSync(fp, preLines.join("\n") + "\n" + sessionLines.join("\n") + "\n");

    const afterTs = new Date((baseEpoch + 1) * 1000).toISOString();
    const tp = makeWriteTranscript(tmpDir, [fp], afterTs, tmpDir);

    const r = runGate({
      hook_event_name: "Stop",
      session_id: `live-${Date.now()}`,
      transcript_path: tp,
      cwd: tmpDir,
    });
    const out = parseOut(r.stdout);
    expect(out.decision).not.toBe("block");

    const content = readFileSync(fp, "utf8");
    for (let i = 0; i < 5; i++) {
      expect(content).toContain(`// base comment ${i}`);
    }
    const narrationLines = content.split("\n").filter(l => l.includes("// narration"));
    expect(narrationLines.length).toBe(0);
  });
});
