import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, copyFileSync, readdirSync, existsSync, statSync, utimesSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { run, refusesPreExistingRemoval } from "../../src/hooks/gate.js";

const GATE_PATH = path.join(import.meta.dir, "../../src/hooks/gate.ts");
const PROBE_DIR = path.join(import.meta.dir, "../fixtures/comment-density/nexus-probe");
const PROBE_FILES = ["probe.sh", "pod-nonroot.yaml", "pod-root.yaml", "pod-root-sysadmin.yaml", "Dockerfile", "Containerfile"];

function runGate(payload: unknown, extraEnv: Record<string, string> = {}): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync("bun", [GATE_PATH], {
    input: JSON.stringify(payload),
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
}

function sha256(fp: string): string {
  return createHash("sha256").update(readFileSync(fp)).digest("hex");
}

function initGitRepo(dir: string): void {
  const opts = { cwd: dir, encoding: "utf8" as const };
  spawnSync("git", ["init"], opts);
  spawnSync("git", ["config", "user.email", "test@test.com"], opts);
  spawnSync("git", ["config", "user.name", "Test"], opts);
}

function gitCommit(dir: string, message: string): string {
  const opts = { cwd: dir, encoding: "utf8" as const };
  spawnSync("git", ["add", "-A"], opts);
  spawnSync("git", ["commit", "--allow-empty", "-m", message], opts);
  const r = spawnSync("git", ["rev-parse", "HEAD"], opts);
  return r.stdout.trim();
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

function parseOut(stdout: string): Record<string, unknown> {
  const t = stdout.trim();
  if (!t) return {};
  return JSON.parse(t) as Record<string, unknown>;
}

describe("refusesPreExistingRemoval", () => {
  it("returns false when no lines are preExisting", () => {
    expect(refusesPreExistingRemoval([{ preExisting: false }, { preExisting: false }])).toBe(false);
  });
  it("returns true when any line is preExisting", () => {
    expect(refusesPreExistingRemoval([{ preExisting: false }, { preExisting: true }])).toBe(true);
  });
  it("returns false on empty array", () => {
    expect(refusesPreExistingRemoval([])).toBe(false);
  });
});

function makeViolatorTs(dir: string, name: string): string {
  const fp = path.join(dir, name);
  writeFileSync(fp, Array.from({ length: 20 }, (_, i) =>
    i % 5 === 0 ? `// reason ${i}` : `const x${i} = ${i};`
  ).join("\n") + "\n");
  return fp;
}

function makeUnfixableViolatorTs(dir: string, name: string): string {
  const fp = path.join(dir, name);
  const lines = [
    ...Array.from({ length: 20 }, (_, i) =>
      i % 5 === 0 ? `// reason ${i}` : `const x${i} = ${i};`
    ),
    "const broken = ;",
  ];
  writeFileSync(fp, lines.join("\n") + "\n");
  return fp;
}

describe("AC1: nexus-probe fixtures", () => {
  let tmpDir: string;
  let repoDir: string;
  let sessionId: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-test-"));
    repoDir = path.join(tmpDir, "repo");
    mkdirSync(repoDir);
    sessionId = `test-${Date.now()}`;
    initGitRepo(repoDir);
    writeFileSync(path.join(repoDir, "README.md"), "# test\n");
    gitCommit(repoDir, "initial");
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it("blocks all 6 probe files written in session; files unchanged on disk", async () => {
    const copiedPaths: string[] = [];
    for (const name of PROBE_FILES) {
      const dst = path.join(repoDir, name);
      copyFileSync(path.join(PROBE_DIR, name), dst);
      copiedPaths.push(dst);
    }
    gitCommit(repoDir, "add fixtures");

    const hashBefore = copiedPaths.map(fp => sha256(fp));
    const timestamp = "2020-01-01T00:00:00.000Z";
    const transcriptPath = makeTranscript(tmpDir, copiedPaths, timestamp);
    const payload = { hook_event_name: "Stop", session_id: sessionId, transcript_path: transcriptPath };

    const r = runGate(payload);
    expect(r.status).toBe(0);
    const out = parseOut(r.stdout);
    expect(out.decision).toBe("block");
    for (let i = 0; i < copiedPaths.length; i++) {
      expect(sha256(copiedPaths[i])).toBe(hashBefore[i]);
    }
  });

  it("bite proof: base=HEAD means no added lines → gate allows", async () => {
    const copiedPaths = PROBE_FILES.map(name => {
      const dst = path.join(repoDir, name);
      copyFileSync(path.join(PROBE_DIR, name), dst);
      return dst;
    });
    gitCommit(repoDir, "add fixtures");

    const logR = spawnSync("git", ["-C", repoDir, "log", "--format=%ct", "-1"], { encoding: "utf8" });
    const commitEpoch = parseInt(logR.stdout.trim(), 10);
    const afterTs = new Date((commitEpoch + 1) * 1000).toISOString();
    const transcriptPath = makeTranscript(tmpDir, copiedPaths, afterTs);
    const payload = { hook_event_name: "Stop", session_id: `bite-${Date.now()}`, transcript_path: transcriptPath };

    const r = runGate(payload);
    expect(r.status).toBe(0);
    const out = parseOut(r.stdout);
    expect(out.decision).not.toBe("block");
  });
});

describe("AC2: 1 comment per 15 lines exceeds 5/100 cap", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-test-"));
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it("blocks TS file with 1 effective comment in 15 added lines; file unchanged", async () => {
    const lines = [
      "const a = 1;", "const b = 2;", "const c = 3;", "const d = 4;",
      "const e = 5;", "const f = 6;", "const g = 7;",
      "// why this exists",
      "const h = 8;", "const i = 9;", "const j = 10;",
      "const k = 11;", "const l = 12;", "const m = 13;", "const n = 14;",
    ];
    const fp = path.join(tmpDir, "small.ts");
    writeFileSync(fp, lines.join("\n") + "\n");
    const hashBefore = sha256(fp);
    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [fp], ts);
    const r = runGate({ hook_event_name: "Stop", session_id: `ac2-${Date.now()}`, transcript_path: tp });
    const out = parseOut(r.stdout);
    expect(out.decision).not.toBe("block");
    expect(out.hookSpecificOutput).toBeTruthy();
    expect(sha256(fp)).not.toBe(hashBefore);
  });
});

describe("AC3: positive controls", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-test-"));
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it("auto-fixes TS file with dense comments over cap; file written on disk", async () => {
    const fp = makeViolatorTs(tmpDir, "dense.ts");
    const hashBefore = sha256(fp);
    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [fp], ts);
    const r = runGate({ hook_event_name: "Stop", session_id: `ac3a-${Date.now()}`, transcript_path: tp });
    expect(parseOut(r.stdout).decision).not.toBe("block");
    expect(parseOut(r.stdout).hookSpecificOutput).toBeTruthy();
    expect(sha256(fp)).not.toBe(hashBefore);
  });

  it("allows TS file with no comments", async () => {
    const fp = path.join(tmpDir, "clean.ts");
    writeFileSync(fp, Array.from({ length: 20 }, (_, i) => `const v${i} = ${i};`).join("\n") + "\n");
    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [fp], ts);
    const r = runGate({ hook_event_name: "Stop", session_id: `ac3b-${Date.now()}`, transcript_path: tp });
    expect(parseOut(r.stdout).decision).not.toBe("block");
  });

  it("allows when base comments are not in added lines", async () => {
    const baseContent = Array.from({ length: 20 }, (_, i) => `// base comment ${i}`).join("\n") + "\n";
    const fp = path.join(tmpDir, "partial.ts");
    writeFileSync(fp, baseContent);
    gitCommit(tmpDir, "add base with comments");

    const logR = spawnSync("git", ["-C", tmpDir, "log", "--format=%ct", "-1"], { encoding: "utf8" });
    const baseEpoch = parseInt(logR.stdout.trim(), 10);

    const newLines = Array.from({ length: 40 }, (_, i) => `const z${i} = ${i};`).join("\n");
    writeFileSync(fp, baseContent + newLines + "\n");

    const afterBaseTs = new Date((baseEpoch + 1) * 1000).toISOString();
    const tp = makeTranscript(tmpDir, [fp], afterBaseTs);
    const r = runGate({ hook_event_name: "Stop", session_id: `ac3c-${Date.now()}`, transcript_path: tp });
    expect(parseOut(r.stdout).decision).not.toBe("block");
  });
});

describe("AC4: transcript-driven targeting", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-test-"));
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it("does not report file changed in git but absent from transcript", async () => {
    writeFileSync(
      path.join(tmpDir, "changed-not-in-transcript.ts"),
      Array.from({ length: 20 }, (_, i) => `// comment ${i}`).join("\n") + "\n",
    );
    const other = path.join(tmpDir, "other.ts");
    writeFileSync(other, "const x = 1;\n");
    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [other], ts);
    const r = runGate({ hook_event_name: "Stop", session_id: `ac4-${Date.now()}`, transcript_path: tp });
    const out = parseOut(r.stdout);
    expect(out.decision).not.toBe("block");
    if (out.reason) expect(out.reason as string).not.toContain("changed-not-in-transcript");
  });
});

describe("AC5: block limit counter", () => {
  let tmpDir: string;
  let sessionId: string;
  let fp: string;
  let tp: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-test-"));
    sessionId = `ac5-${Date.now()}`;
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");
    fp = makeUnfixableViolatorTs(tmpDir, "violator.ts");
    const ts = new Date(Date.now() - 10000).toISOString();
    tp = makeTranscript(tmpDir, [fp], ts);
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it("blocks 3 times then allows on 4th and 5th", async () => {
    const payload = { hook_event_name: "Stop", session_id: sessionId, transcript_path: tp };
    const results = Array.from({ length: 5 }, () => {
      const r = runGate(payload);
      return { out: parseOut(r.stdout), stderr: r.stderr };
    });

    expect(results[0].out.decision).toBe("block");
    expect(results[1].out.decision).toBe("block");
    expect(results[2].out.decision).toBe("block");
    expect(results[3].out.decision).not.toBe("block");
    expect(results[3].stderr).toContain("4th consecutive block");
    expect(results[4].out.decision).not.toBe("block");
  });

  it("counter resets when violating files change", async () => {
    const payload = { hook_event_name: "Stop", session_id: sessionId, transcript_path: tp };
    runGate(payload); runGate(payload); runGate(payload);

    const fp2 = makeUnfixableViolatorTs(tmpDir, "violator2.ts");
    const ts2 = new Date(Date.now() - 10000).toISOString();
    const tp2 = makeTranscript(tmpDir, [fp2], ts2);
    const r = runGate({ hook_event_name: "Stop", session_id: sessionId, transcript_path: tp2 });
    expect(parseOut(r.stdout).decision).toBe("block");
  });

  it("different agent_ids have independent counters (unfixable file)", async () => {
    const agentA = `agent-a-${Date.now()}`;
    const agentB = `agent-b-${Date.now()}`;

    const mkPayload = (agentId: string) => ({
      hook_event_name: "SubagentStop", session_id: sessionId,
      agent_id: agentId, transcript_path: tp, agent_transcript_path: tp,
    });

    runGate(mkPayload(agentA)); runGate(mkPayload(agentA)); runGate(mkPayload(agentA));
    const r4A = runGate(mkPayload(agentA));
    expect(parseOut(r4A.stdout).decision).not.toBe("block");
    expect(r4A.stderr).toContain("4th consecutive block");

    const rB = runGate(mkPayload(agentB));
    expect(parseOut(rB.stdout).decision).toBe("block");
  });
});

describe("AC6: fail-open", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-test-"));
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it("allows silently when CLAUDE_CODE_ENTRYPOINT=sdk-py", () => {
    const fp = makeViolatorTs(tmpDir, "v.ts");
    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [fp], ts);
    const r = runGate({ hook_event_name: "Stop", session_id: "ac6a", transcript_path: tp }, { CLAUDE_CODE_ENTRYPOINT: "sdk-py" });
    expect(r.stdout.trim()).toBe("");
    expect(r.status).toBe(0);
  });

  it("GROUNDWORK_COMMENT_DENSITY=0 does not skip — gate still acts on violations", () => {
    const fp = makeViolatorTs(tmpDir, "v.ts");
    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [fp], ts);
    const r = runGate({ hook_event_name: "Stop", session_id: "ac6b", transcript_path: tp }, { GROUNDWORK_COMMENT_DENSITY: "0" });
    expect(r.stdout.trim()).not.toBe("");
    expect(r.stdout.trim()).not.toBe(JSON.stringify({ continue: true }));
  });

  it("allows when transcript_path is missing", () => {
    const r = runGate({ hook_event_name: "Stop", session_id: "ac6c" });
    expect(parseOut(r.stdout).decision).not.toBe("block");
  });

  it("fixable violation is auto-fixed and allowed; file written", () => {
    const fp = makeViolatorTs(tmpDir, "v.ts");
    const hashBefore = sha256(fp);
    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [fp], ts);
    const r = runGate({ hook_event_name: "Stop", session_id: `ac6d-${Date.now()}`, transcript_path: tp });
    expect(parseOut(r.stdout).decision).not.toBe("block");
    expect(parseOut(r.stdout).hookSpecificOutput).toBeTruthy();
    expect(sha256(fp)).not.toBe(hashBefore);
  });
});

describe("AC6b: stop_hook_active does not skip check", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-test-"));
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it("stop_hook_active:true does not skip the check — auto-fixes fixable files", async () => {
    const fp = makeViolatorTs(tmpDir, "dense.ts");
    const hashBefore = sha256(fp);
    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [fp], ts);
    const r = runGate(
      { hook_event_name: "Stop", session_id: `ac6b-${Date.now()}`, transcript_path: tp, stop_hook_active: true },
    );
    const out = parseOut(r.stdout);
    expect(out.decision).not.toBe("block");
    expect(out.hookSpecificOutput).toBeTruthy();
    expect(sha256(fp)).not.toBe(hashBefore);
  });
});

describe("AC7: SubagentStop real payload shape blocks over-cap file", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-sub-test-"));
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it("SubagentStop auto-fixes over-cap file; file written", async () => {
    const fp = makeViolatorTs(tmpDir, "sub-dense.ts");
    const hashBefore = sha256(fp);
    const ts = new Date(Date.now() - 10000).toISOString();
    const agentTranscriptPath = makeTranscript(tmpDir, [fp], ts);
    const sessionTranscriptPath = path.join(tmpDir, "session.jsonl");
    writeFileSync(sessionTranscriptPath, JSON.stringify({
      type: "assistant", message: { content: [] },
      timestamp: ts, cwd: tmpDir,
    }) + "\n");

    const r = runGate({
      hook_event_name: "SubagentStop",
      session_id: `ac7-${Date.now()}`,
      agent_id: "test-subagent-id-001",
      transcript_path: sessionTranscriptPath,
      agent_transcript_path: agentTranscriptPath,
    });
    const out = parseOut(r.stdout);
    expect(out.decision).not.toBe("block");
    expect(out.hookSpecificOutput).toBeTruthy();
    expect(sha256(fp)).not.toBe(hashBefore);
  });
});

describe("AC8: end-user src/scripts files in other repos are blocked", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-fix-test-"));
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it("over-cap file at src/scripts/ in a different repo is blocked; file unchanged", () => {
    const fixtureDir = path.join(tmpDir, "src", "scripts");
    mkdirSync(fixtureDir, { recursive: true });
    const fp = path.join(fixtureDir, "a.sh");
    const lines = [
      "#!/usr/bin/env bash",
      ...Array.from({ length: 14 }, (_, i) => `echo "line ${i}"`),
      "# comment A",
      "# comment B",
      "# comment C",
      "# comment D",
      "# comment E",
    ];
    writeFileSync(fp, lines.join("\n") + "\n");
    const hashBefore = sha256(fp);
    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [fp], ts);
    const r = runGate({ hook_event_name: "Stop", session_id: `ac8-${Date.now()}`, transcript_path: tp });
    expect(parseOut(r.stdout).decision).toBe("block");
    expect(sha256(fp)).toBe(hashBefore);
  });
});

describe("AC10: real probe files block and stay on disk unchanged", () => {
  let tmpDir: string;
  let repoDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-ac10-"));
    repoDir = path.join(tmpDir, "repo");
    mkdirSync(path.join(repoDir, "deploy"), { recursive: true });
    initGitRepo(repoDir);
    writeFileSync(path.join(repoDir, "README.md"), "# x\n");
    gitCommit(repoDir, "base");
  });

  afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { } });

  it("probe.sh and pod-nonroot.yaml block; sha256 unchanged; second run also blocks", async () => {
    const src = PROBE_DIR;
    const dstSh = path.join(repoDir, "deploy", "probe.sh");
    const dstYaml = path.join(repoDir, "deploy", "pod-nonroot.yaml");
    copyFileSync(path.join(src, "probe.sh"), dstSh);
    copyFileSync(path.join(src, "pod-nonroot.yaml"), dstYaml);
    gitCommit(repoDir, "add deploy");

    const hashShBefore = sha256(dstSh);
    const hashYamlBefore = sha256(dstYaml);

    const ts = "2020-01-01T00:00:00.000Z";
    const tp = makeTranscript(tmpDir, [dstSh, dstYaml], ts);
    const sid = `ac10-${Date.now()}`;
    const payload = { hook_event_name: "Stop", session_id: sid, transcript_path: tp };

    const r1 = runGate(payload);
    expect(parseOut(r1.stdout).decision).toBe("block");
    expect(sha256(dstSh)).toBe(hashShBefore);
    expect(sha256(dstYaml)).toBe(hashYamlBefore);

    const bashCheck = spawnSync("bash", ["-n", dstSh], { encoding: "utf8" });
    expect(bashCheck.status).toBe(0);

    const r2 = runGate({ ...payload, session_id: `ac10b-${Date.now()}` });
    expect(parseOut(r2.stdout).decision).toBe("block");
    expect(sha256(dstSh)).toBe(hashShBefore);
    expect(sha256(dstYaml)).toBe(hashYamlBefore);
  });
});

describe("AC11: pre-existing comments preserved (no write)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-ac11-"));
    initGitRepo(tmpDir);
  });

  afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { } });

  it("gate auto-fixes session comments; base comments still present", async () => {
    const baseLines = Array.from({ length: 10 }, (_, i) => `// base ${i}`);
    const fp = path.join(tmpDir, "mixed.ts");
    writeFileSync(fp, baseLines.join("\n") + "\n");
    gitCommit(tmpDir, "base");

    const logR = spawnSync("git", ["-C", tmpDir, "log", "--format=%ct", "-1"], { encoding: "utf8" });
    const baseEpoch = parseInt(logR.stdout.trim(), 10);

    const sessionLines = [
      ...Array.from({ length: 34 }, (_, i) => `const z${i} = ${i};`),
      "// session A", "// session B", "// session C",
      "// session D", "// session E", "// session F",
    ];
    writeFileSync(fp, baseLines.join("\n") + "\n" + sessionLines.join("\n") + "\n");
    const hashBefore = sha256(fp);

    const afterTs = new Date((baseEpoch + 1) * 1000).toISOString();
    const tp = makeTranscript(tmpDir, [fp], afterTs);
    const r = runGate({ hook_event_name: "Stop", session_id: `ac11-${Date.now()}`, transcript_path: tp });
    expect(parseOut(r.stdout).decision).not.toBe("block");
    expect(parseOut(r.stdout).hookSpecificOutput).toBeTruthy();
    expect(sha256(fp)).not.toBe(hashBefore);

    const content = readFileSync(fp, "utf8");
    for (let i = 0; i < 10; i++) expect(content).toContain(`// base ${i}`);
  });

  it("bite: if all rows counted, base comments would be removed too", async () => {
    const baseLines = Array.from({ length: 10 }, (_, i) => `// base ${i}`);
    const fp = path.join(tmpDir, "mixed2.ts");
    writeFileSync(fp, baseLines.join("\n") + "\n");
    gitCommit(tmpDir, "base");

    const logR = spawnSync("git", ["-C", tmpDir, "log", "--format=%ct", "-1"], { encoding: "utf8" });
    const baseEpoch = parseInt(logR.stdout.trim(), 10);
    const sessionLines = [
      ...Array.from({ length: 34 }, (_, i) => `const z${i} = ${i};`),
      "// session A", "// session B", "// session C",
      "// session D", "// session E", "// session F",
    ];
    writeFileSync(fp, baseLines.join("\n") + "\n" + sessionLines.join("\n") + "\n");

    const afterTs = new Date((baseEpoch + 1) * 1000).toISOString();
    const tp = makeTranscript(tmpDir, [fp], afterTs);
    runGate({ hook_event_name: "Stop", session_id: `ac11b-${Date.now()}`, transcript_path: tp });
    const fixed = readFileSync(fp, "utf8");
    for (let i = 0; i < 10; i++) {
      expect(fixed).toContain(`// base ${i}`);
    }
  });
});

describe("GF-1: block message includes per-file unfixable reason", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "gf1-test-"));
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");
  });

  afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { } });

  it("block report includes why each file was not auto-fixed (preview lang and autofix failed)", async () => {
    const yamlFp = path.join(tmpDir, "config.yaml");
    writeFileSync(yamlFp,
      Array.from({ length: 20 }, (_, i) =>
        i % 5 === 0 ? `# comment ${i}` : `key${i}: value${i}`
      ).join("\n") + "\n"
    );

    const tsFp = path.join(tmpDir, "broken.ts");
    writeFileSync(tsFp, [
      ...Array.from({ length: 20 }, (_, i) => i % 5 === 0 ? `// r${i}` : `const x${i} = ${i};`),
      "const broken = ;",
    ].join("\n") + "\n");

    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [yamlFp, tsFp], ts);
    const sessionId = "gf1testrun";

    const result = await run(
      { hook_event_name: "Stop", session_id: sessionId, transcript_path: tp },
      process.env as Record<string, string | undefined>,
      { testOnly_tmpDir: tmpDir },
    );

    expect(JSON.parse(result.stdout.trim())).toMatchObject({ decision: "block" });

    const blockFilePath = path.join(tmpDir, "house-rules", sessionId, "stop-block.txt");
    const report = readFileSync(blockFilePath, "utf8");

    expect(report).toMatch(/config\.yaml[^\n]*—[^\n]*preview language/);
    expect(report).toMatch(/broken\.ts[^\n]*—[^\n]*autofix failed: post-strip parse: parse-error/);
  });

  it("block report includes write-failed reason with cause when disk changes mid-write", async () => {
    const fp = makeViolatorTs(tmpDir, "write-fail.ts");
    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [fp], ts);
    const sessionId = "gf1writefail";

    const result = await run(
      { hook_event_name: "Stop", session_id: sessionId, transcript_path: tp },
      process.env as Record<string, string | undefined>,
      {
        testOnly_tmpDir: tmpDir,
        testOnly_forceWrite: true,
        afterTmpWrite: (_tmp, target) => {
          writeFileSync(target, "// modified concurrently\nconst x = 1;\n");
        },
      },
    );

    expect(JSON.parse(result.stdout.trim())).toMatchObject({ decision: "block" });

    const blockFilePath = path.join(tmpDir, "house-rules", sessionId, "stop-block.txt");
    const report = readFileSync(blockFilePath, "utf8");
    expect(report).toMatch(/write-fail\.ts[^\n]*—[^\n]*write failed:/);
  });
});

describe("AC13: unfixable file blocks; fixed files mentioned in reason", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-ac13-"));
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");
  });

  afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { } });

  it("unfixable file blocks; fixable file auto-fixed; unfixable unchanged", () => {
    const fixable = makeViolatorTs(tmpDir, "fix.ts");
    const unfixable = makeUnfixableViolatorTs(tmpDir, "nofix.ts");
    const fixableHashBefore = sha256(fixable);
    const unfixableHashBefore = sha256(unfixable);
    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [fixable, unfixable], ts);
    const r = runGate({ hook_event_name: "Stop", session_id: `ac13-${Date.now()}`, transcript_path: tp });
    const out = parseOut(r.stdout);
    expect(out.decision).toBe("block");
    expect(out.reason as string).toContain("nofix.ts");
    expect(sha256(fixable)).not.toBe(fixableHashBefore);
    expect(sha256(unfixable)).toBe(unfixableHashBefore);
  });
});

describe("AC16: file mode preserved (no write)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-ac16-"));
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");
  });

  afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { } });

  it("0755 script blocks; sha256 unchanged; mode still 0755", () => {
    const lines = [
      "#!/usr/bin/env bash",
      ...Array.from({ length: 14 }, (_, i) => `echo "${i}"`),
      "# comment A", "# comment B", "# comment C", "# comment D", "# comment E",
    ];
    const fp = path.join(tmpDir, "run.sh");
    writeFileSync(fp, lines.join("\n") + "\n", { mode: 0o755 });
    const hashBefore = sha256(fp);
    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [fp], ts);
    const r = runGate({ hook_event_name: "Stop", session_id: `ac16-${Date.now()}`, transcript_path: tp });
    expect(parseOut(r.stdout).decision).toBe("block");
    expect(sha256(fp)).toBe(hashBefore);
    const { statSync: st } = require("node:fs");
    const mode = st(fp).mode & 0o777;
    expect(mode).toBe(0o755);
  });
});

describe("AC17: no-write invariant — over-cap files committed after base stay byte-identical", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-ac17-"));
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");
  });

  afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { } });

  it("over-cap fixtures committed after base → block; every file sha256 unchanged", async () => {
    const src = PROBE_DIR;
    const dstSh = path.join(tmpDir, "probe.sh");
    copyFileSync(path.join(src, "probe.sh"), dstSh);
    gitCommit(tmpDir, "add probe");

    const hashBefore = sha256(dstSh);

    const ts = "2020-01-01T00:00:00.000Z";
    const tp = makeTranscript(tmpDir, [dstSh], ts);
    const r = runGate({ hook_event_name: "Stop", session_id: `ac17-${Date.now()}`, transcript_path: tp });

    const out = parseOut(r.stdout);
    expect(out.decision).toBe("block");
    expect(sha256(dstSh)).toBe(hashBefore);
  });
});

function makeEditTranscript(transcriptDir: string, fp: string, timestamp: string): string {
  const transcriptPath = path.join(transcriptDir, `transcript-edit-${Date.now()}.jsonl`);
  writeFileSync(transcriptPath, JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: fp } }] },
    timestamp,
    cwd: transcriptDir,
  }) + "\n");
  return transcriptPath;
}

describe("BugB: transcriptPath wired to addedRanges — untracked Edit-touch not measured", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-bugb-"));
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");
  });

  afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

  it("untracked file with Edit-first-touch is not measured → gate allows", async () => {
    const fp = path.join(tmpDir, "preexisting.ts");
    writeFileSync(fp, Array.from({ length: 20 }, (_, i) =>
      i % 2 === 0 ? `// comment ${i}` : `const x${i} = ${i};`
    ).join("\n") + "\n");
    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeEditTranscript(tmpDir, fp, ts);
    const r = await run(
      { hook_event_name: "Stop", session_id: `bugb-${Date.now()}`, transcript_path: tp },
      process.env as Record<string, string | undefined>,
    );
    const out = JSON.parse(r.stdout.trim() || "{}") as Record<string, unknown>;
    expect(out.decision).not.toBe("block");
  });

  it("bite: untracked file with Write-first-touch IS measured → gate auto-fixes", async () => {
    const fp = makeViolatorTs(tmpDir, "written-by-session.ts");
    const hashBefore = sha256(fp);
    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [fp], ts);
    const r = await run(
      { hook_event_name: "Stop", session_id: `bugb-bite-${Date.now()}`, transcript_path: tp },
      process.env as Record<string, string | undefined>,
    );
    const out = JSON.parse(r.stdout.trim() || "{}") as Record<string, unknown>;
    expect(out.decision).not.toBe("block");
    expect(out.hookSpecificOutput).toBeTruthy();
    expect(sha256(fp)).not.toBe(hashBefore);
  });
});

describe("ConcurrentWrite: concurrent modification aborts rename; gate blocks; no temp files", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-conc-"));
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");
  });

  afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

  it("afterTmpWrite modifies target → rename aborted; gate blocks; file has modified content; no .cdg-* left", async () => {
    const fp = makeViolatorTs(tmpDir, "target.ts");
    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [fp], ts);
    const markerContent = "const afterwrite = true;\n";
    let seamCalled = false;

    const r = await run(
      { hook_event_name: "Stop", session_id: `conc-${Date.now()}`, transcript_path: tp },
      process.env as Record<string, string | undefined>,
      {
        testOnly_forceWrite: true,
        afterTmpWrite: (_tmp, target) => {
          seamCalled = true;
          writeFileSync(target, markerContent, { encoding: "utf8" });
        },
      },
    );

    expect(seamCalled).toBe(true);
    const out = JSON.parse(r.stdout.trim() || "{}") as Record<string, unknown>;
    expect(out.decision).toBe("block");
    expect(readFileSync(fp, "utf8")).toBe(markerContent);
    const entries = readdirSync(tmpDir) as string[];
    expect(entries.some(f => f.includes(".cdg-"))).toBe(false);
  });
});

describe("AutoFixOkFalse: ok:false from autoFix → unfixable → block path", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-okfalse-"));
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");
  });

  afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

  it("unfixable violator with autoFixEnabled=true → gate blocks; file unchanged", async () => {
    const fp = makeUnfixableViolatorTs(tmpDir, "badparse.ts");
    const hashBefore = sha256(fp);
    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [fp], ts);

    const r = await run(
      { hook_event_name: "Stop", session_id: `okfalse-${Date.now()}`, transcript_path: tp },
      process.env as Record<string, string | undefined>,
      { testOnly_forceWrite: true },
    );

    const out = JSON.parse(r.stdout.trim() || "{}") as Record<string, unknown>;
    expect(out.decision).toBe("block");
    expect(sha256(fp)).toBe(hashBefore);
  });
});

describe("S1-autofix-shadow", () => {
  let tmpDir: string;
  let shadowTmpDir: string;
  let sessionId: string;
  let fp: string;
  let tp: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-s1-"));
    shadowTmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-s1-shad-"));
    sessionId = `s1-${Date.now()}`;
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");
    fp = makeViolatorTs(tmpDir, "violator.ts");
    tp = makeTranscript(tmpDir, [fp], new Date(Date.now() - 10000).toISOString());
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    try { rmSync(shadowTmpDir, { recursive: true, force: true }); } catch {}
  });

  it("preview: no write, shadow log written, gate blocks", async () => {
    const hashBefore = sha256(fp);
    const r = await run(
      { hook_event_name: "Stop", session_id: sessionId, transcript_path: tp },
      process.env as Record<string, string | undefined>,
      { testOnly_tmpDir: shadowTmpDir, testOnly_fixTableOverride: { typescript: { stability: "preview" } } } as any,
    );
    const out = JSON.parse(r.stdout.trim() || "{}") as Record<string, unknown>;
    expect(out.decision).toBe("block");
    expect(sha256(fp)).toBe(hashBefore);
    const shadowFile = path.join(shadowTmpDir, "groundwork-autofix-shadow", `${sessionId}.jsonl`);
    expect(existsSync(shadowFile)).toBe(true);
    const firstLine = readFileSync(shadowFile, "utf8").split("\n").find(l => l.trim());
    expect(firstLine).toBeTruthy();
    const rec = JSON.parse(firstLine!) as Record<string, unknown>;
    expect((rec.removedLines as unknown[]).length).toBeGreaterThan(0);
    expect(rec.densityBefore as number).toBeGreaterThan(5);
    expect(typeof rec.densityAfter).toBe("number");
  });

  it("stable+safe table override: writes and gate allows", async () => {
    const r = await run(
      { hook_event_name: "Stop", session_id: sessionId, transcript_path: tp },
      process.env as Record<string, string | undefined>,
      { testOnly_tmpDir: shadowTmpDir, testOnly_fixTableOverride: { typescript: { stability: "stable", applicability: "safe" } } } as any,
    );
    const out = JSON.parse(r.stdout.trim() || "{}") as Record<string, unknown>;
    expect(out.decision).not.toBe("block");
    const content = readFileSync(fp, "utf8");
    const commentLines = content.split("\n").filter(l => l.trim().startsWith("//"));
    expect(commentLines.length).toBe(0);
  });

  it("stable+unsafe table override: no write, gate blocks", async () => {
    const hashBefore = sha256(fp);
    const r = await run(
      { hook_event_name: "Stop", session_id: sessionId, transcript_path: tp },
      process.env as Record<string, string | undefined>,
      { testOnly_tmpDir: shadowTmpDir, testOnly_fixTableOverride: { typescript: { stability: "stable", applicability: "unsafe" } } } as any,
    );
    const out = JSON.parse(r.stdout.trim() || "{}") as Record<string, unknown>;
    expect(out.decision).toBe("block");
    expect(sha256(fp)).toBe(hashBefore);
  });

  it("sha256 mismatch: no write, gate blocks", async () => {
    const r = await run(
      { hook_event_name: "Stop", session_id: sessionId, transcript_path: tp },
      process.env as Record<string, string | undefined>,
      {
        testOnly_forceWrite: true,
        testOnly_fixTableOverride: { typescript: { stability: "preview" } },
        afterTmpWrite: (_tmp: string, target: string) => {
          const origStat = statSync(target);
          writeFileSync(target, readFileSync(target, "utf8") + "// extra\n");
          utimesSync(target, origStat.atime, origStat.mtime);
        },
      } as any,
    );
    const out = JSON.parse(r.stdout.trim() || "{}") as Record<string, unknown>;
    expect(out.decision).toBe("block");
    const content = readFileSync(fp, "utf8");
    expect(content).toContain("// extra");
  });

  it("tmp-mismatch: written content matches original; density re-check fails; gate blocks; file unchanged", async () => {
    const hashBefore = sha256(fp);
    const originalContent = readFileSync(fp, "utf8");
    const r = await run(
      { hook_event_name: "Stop", session_id: sessionId, transcript_path: tp },
      process.env as Record<string, string | undefined>,
      {
        testOnly_forceWrite: true,
        testOnly_fixTableOverride: { typescript: { stability: "preview" } },
        afterTmpWrite: (tmp: string, _target: string) => {
          writeFileSync(tmp, originalContent);
        },
      } as any,
    );
    const out = JSON.parse(r.stdout.trim() || "{}") as Record<string, unknown>;
    expect(out.decision).toBe("block");
    expect(sha256(fp)).toBe(hashBefore);
  });

  it("shadow log failure does not change gate decision", async () => {
    const badTmpDir = path.join(shadowTmpDir, "existing-file");
    writeFileSync(badTmpDir, "not a dir");
    const r = await run(
      { hook_event_name: "Stop", session_id: sessionId, transcript_path: tp },
      process.env as Record<string, string | undefined>,
      { testOnly_tmpDir: badTmpDir, testOnly_fixTableOverride: { typescript: { stability: "preview" } } } as any,
    );
    const out = JSON.parse(r.stdout.trim() || "{}") as Record<string, unknown>;
    expect(out.decision).toBe("block");
  });
});

describe("S1b-tmp-mismatch-and-density-after-scope", () => {
  let tmpDir: string;
  let sessionId: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-s1b-"));
    sessionId = `s1b-${Date.now()}`;
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it("T-D1: tmp-mismatch guard — afterTmpWrite injects content that inflates density", async () => {
    const preCount = 400;
    const sessionCommentCount = 20;
    const preLines = Array.from({ length: preCount }, (_, i) => `const p${i} = ${i};`);
    const fp = path.join(tmpDir, "longfile.ts");
    writeFileSync(fp, preLines.join("\n") + "\n");
    gitCommit(tmpDir, "base");
    const logR = spawnSync("git", ["-C", tmpDir, "log", "--format=%ct", "-1"], { encoding: "utf8" });
    const baseEpoch = parseInt(logR.stdout.trim(), 10);

    const sessionLines = Array.from({ length: sessionCommentCount }, (_, i) => `// session comment ${i}`);
    const fullContent = preLines.join("\n") + "\n" + sessionLines.join("\n") + "\n";
    writeFileSync(fp, fullContent);
    const hashBefore = sha256(fp);

    const afterTs = new Date((baseEpoch + 1) * 1000).toISOString();
    const tp = makeTranscript(tmpDir, [fp], afterTs);

    const r = await run(
      { hook_event_name: "Stop", session_id: sessionId, transcript_path: tp },
      process.env as Record<string, string | undefined>,
      {
        testOnly_forceWrite: true,
        afterTmpWrite: (tmp: string, _target: string) => {
          writeFileSync(tmp, fullContent);
        },
      } as any,
    );
    const out = JSON.parse(r.stdout.trim() || "{}") as Record<string, unknown>;
    expect(out.decision).toBe("block");
    expect(sha256(fp)).toBe(hashBefore);
  });

  it("T-D2: shadow densityAfter is computed over added rows, not whole file", async () => {
    const baseLines = [
      "// preexisting comment",
      ...Array.from({ length: 49 }, (_, i) => `const b${i} = ${i};`),
    ];
    const fp = path.join(tmpDir, "mixed.ts");
    writeFileSync(fp, baseLines.join("\n") + "\n");
    gitCommit(tmpDir, "base");
    const logR = spawnSync("git", ["-C", tmpDir, "log", "--format=%ct", "-1"], { encoding: "utf8" });
    const baseEpoch = parseInt(logR.stdout.trim(), 10);

    const sessionLines = [
      ...Array.from({ length: 5 }, (_, i) => `const s${i} = ${i};`),
      ...Array.from({ length: 5 }, (_, i) => `// session comment ${i}`),
    ];
    writeFileSync(fp, baseLines.join("\n") + "\n" + sessionLines.join("\n") + "\n");

    const afterTs = new Date((baseEpoch + 1) * 1000).toISOString();
    const shadowTmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-s1b-shad-"));
    try {
      const tp = makeTranscript(tmpDir, [fp], afterTs);
      const r = await run(
        { hook_event_name: "Stop", session_id: sessionId, transcript_path: tp },
        process.env as Record<string, string | undefined>,
        { testOnly_tmpDir: shadowTmpDir, testOnly_fixTableOverride: { typescript: { stability: "preview" } } } as any,
      );
      const out = JSON.parse(r.stdout.trim() || "{}") as Record<string, unknown>;
      expect(out.decision).toBe("block");
      const shadowFile = path.join(shadowTmpDir, "groundwork-autofix-shadow", `${sessionId}.jsonl`);
      expect(existsSync(shadowFile)).toBe(true);
      const rec = JSON.parse(readFileSync(shadowFile, "utf8").split("\n").find(l => l.trim())!) as Record<string, unknown>;
      expect(rec.densityBefore as number).toBeGreaterThan(5);
      expect(rec.densityAfter).toBe(0);
    } finally {
      try { rmSync(shadowTmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  it("T-D3: tmp-mismatch guard — testOnly_overrideFixed injects preExisting removal", async () => {
    const baseLines = [
      "// base comment",
      ...Array.from({ length: 14 }, (_, i) => `const b${i} = ${i};`),
    ];
    const fp = path.join(tmpDir, "withbase.ts");
    writeFileSync(fp, baseLines.join("\n") + "\n");
    gitCommit(tmpDir, "base");
    const logR = spawnSync("git", ["-C", tmpDir, "log", "--format=%ct", "-1"], { encoding: "utf8" });
    const baseEpoch = parseInt(logR.stdout.trim(), 10);

    const sessionLines = [
      ...Array.from({ length: 5 }, (_, i) => `const s${i} = ${i};`),
      ...Array.from({ length: 5 }, (_, i) => `// session comment ${i}`),
    ];
    writeFileSync(fp, baseLines.join("\n") + "\n" + sessionLines.join("\n") + "\n");
    const hashBefore = sha256(fp);

    const afterTs = new Date((baseEpoch + 1) * 1000).toISOString();
    const tp = makeTranscript(tmpDir, [fp], afterTs);
    const r = await run(
      { hook_event_name: "Stop", session_id: sessionId, transcript_path: tp },
      process.env as Record<string, string | undefined>,
      {
        testOnly_forceWrite: true,
        testOnly_overrideFixed: (_txt: string, fixed: string, _rowSet: Set<number>) => {
          const lines = fixed.split("\n");
          const idx = lines.findIndex(l => l.trim() === "// base comment");
          if (idx >= 0) { lines.splice(idx, 1); }
          return lines.join("\n");
        },
      } as any,
    );
    const out = JSON.parse(r.stdout.trim() || "{}") as Record<string, unknown>;
    expect(out.decision).toBe("block");
    expect(sha256(fp)).toBe(hashBefore);
  });
});

describe("AC9: dogfood — gate and test files ≤5/100", () => {
  async function checkFileDensity(filePath: string): Promise<number> {
    const { density, detectLanguage } = await import("../../src/hooks/lib/comment-density.js");
    const text = readFileSync(filePath, "utf8");
    const lang = detectLanguage(filePath);
    if (!lang) return 0;
    const allRows = new Set(text.split("\n").map((_, i) => i));
    const result = await density(text, lang, allRows);
    return result.total > 0 ? result.effective / result.total * 100 : 0;
  }

  it("gate file is ≤5/100", async () => {
    expect(await checkFileDensity(GATE_PATH)).toBeLessThanOrEqual(5);
  });

  it("test file is ≤5/100", async () => {
    const testPath = path.join(import.meta.dir, "gate.test.ts");
    expect(await checkFileDensity(testPath)).toBeLessThanOrEqual(5);
  });
});

describe("S1c-trailing-comment-regression", () => {
  let tmpDir: string;
  let shadowDir: string;
  let sessionId: string;
  let fp: string;
  let tp: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-s1c-trail-"));
    shadowDir = mkdtempSync(path.join(os.tmpdir(), "cdg-s1c-trail-shad-"));
    sessionId = `s1c-trail-${Date.now()}`;
    initGitRepo(tmpDir);
    const preLines = ["const p0 = 0;", "const p1 = 1;", "const p2 = 2;"];
    fp = path.join(tmpDir, "trail.ts");
    writeFileSync(fp, preLines.join("\n") + "\n");
    gitCommit(tmpDir, "base");
    const logR = spawnSync("git", ["-C", tmpDir, "log", "--format=%ct", "-1"], { encoding: "utf8" });
    const baseEpoch = parseInt(logR.stdout.trim(), 10);
    const sessionLines = Array.from({ length: 20 }, (_, i) =>
      i === 0 || i === 6 || i === 12 || i === 18
        ? `const a${i} = ${i}; // set a${i}`
        : `const a${i} = ${i};`
    );
    const fullLines = [...sessionLines, ...preLines];
    writeFileSync(fp, fullLines.join("\n") + "\n");
    const afterTs = new Date((baseEpoch + 1) * 1000).toISOString();
    tp = makeTranscript(tmpDir, [fp], afterTs);
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    try { rmSync(shadowDir, { recursive: true, force: true }); } catch {}
  });

  it("shadow mode: no preExisting in removedLines; densityAfter ≤5", async () => {
    const r = await run(
      { hook_event_name: "Stop", session_id: sessionId, transcript_path: tp },
      process.env as Record<string, string | undefined>,
      { testOnly_tmpDir: shadowDir, testOnly_fixTableOverride: { typescript: { stability: "preview" } } } as any,
    );
    const out = JSON.parse(r.stdout.trim() || "{}") as Record<string, unknown>;
    expect(out.decision).toBe("block");
    const shadowFile = path.join(shadowDir, "groundwork-autofix-shadow", `${sessionId}.jsonl`);
    expect(existsSync(shadowFile)).toBe(true);
    const rec = JSON.parse(readFileSync(shadowFile, "utf8").split("\n").find(l => l.trim())!) as Record<string, unknown>;
    const removed = rec.removedLines as Array<{ lineNum: number; text: string; preExisting: boolean }>;
    for (const entry of removed) expect(entry.preExisting).toBe(false);
    const preTexts = new Set(["const p0 = 0;", "const p1 = 1;", "const p2 = 2;"]);
    for (const entry of removed) expect(preTexts.has(entry.text)).toBe(false);
    expect(rec.densityAfter as number).toBeLessThanOrEqual(5);
  });

  it("write mode: gate allows; pre-existing lines preserved", async () => {
    const r = await run(
      { hook_event_name: "Stop", session_id: sessionId, transcript_path: tp },
      process.env as Record<string, string | undefined>,
      { testOnly_fixTableOverride: { typescript: { stability: "stable", applicability: "safe" } } } as any,
    );
    const out = JSON.parse(r.stdout.trim() || "{}") as Record<string, unknown>;
    expect(out.decision).not.toBe("block");
    const content = readFileSync(fp, "utf8");
    expect(content).toContain("const p0 = 0;");
    expect(content).toContain("const p1 = 1;");
    expect(content).toContain("const p2 = 2;");
  });
});

describe("S1c-duplicate-comment-regression", () => {
  let tmpDir: string;
  let shadowDir: string;
  let sessionId: string;
  let fp: string;
  let tp: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-s1c-dup-"));
    shadowDir = mkdtempSync(path.join(os.tmpdir(), "cdg-s1c-dup-shad-"));
    sessionId = `s1c-dup-${Date.now()}`;
    initGitRepo(tmpDir);
    fp = path.join(tmpDir, "dup.ts");
    const preLines = ["const p0 = 0;", "// x", "const p1 = 1;"];
    writeFileSync(fp, preLines.join("\n") + "\n");
    gitCommit(tmpDir, "base");
    const logR = spawnSync("git", ["-C", tmpDir, "log", "--format=%ct", "-1"], { encoding: "utf8" });
    const baseEpoch = parseInt(logR.stdout.trim(), 10);
    const sessionLines = Array.from({ length: 20 }, (_, i) => {
      if (i === 1 || i === 7 || i === 13) return `// comment ${i}`;
      if (i === 19) return "// x";
      return `const a${i} = ${i};`;
    });
    writeFileSync(fp, [...sessionLines, ...preLines].join("\n") + "\n");
    const afterTs = new Date((baseEpoch + 1) * 1000).toISOString();
    tp = makeTranscript(tmpDir, [fp], afterTs);
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    try { rmSync(shadowDir, { recursive: true, force: true }); } catch {}
  });

  it("pre-existing duplicate comment not flagged as session removal", async () => {
    const r = await run(
      { hook_event_name: "Stop", session_id: sessionId, transcript_path: tp },
      process.env as Record<string, string | undefined>,
      { testOnly_tmpDir: shadowDir, testOnly_fixTableOverride: { typescript: { stability: "preview" } } } as any,
    );
    const out = JSON.parse(r.stdout.trim() || "{}") as Record<string, unknown>;
    expect(out.decision).toBe("block");
    const shadowFile = path.join(shadowDir, "groundwork-autofix-shadow", `${sessionId}.jsonl`);
    expect(existsSync(shadowFile)).toBe(true);
    const rec = JSON.parse(readFileSync(shadowFile, "utf8").split("\n").find(l => l.trim())!) as Record<string, unknown>;
    const removed = rec.removedLines as Array<{ lineNum: number; text: string; preExisting: boolean }>;
    for (const entry of removed) expect(entry.preExisting).toBe(false);
    expect(isFinite(rec.densityAfter as number)).toBe(true);
    expect(rec.densityAfter as number).toBeLessThanOrEqual(20);
  });
});

describe("S1c-sha256-same-size", () => {
  let tmpDir: string;
  let sessionId: string;
  let fp: string;
  let tp: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-s1c-sha-"));
    sessionId = `s1c-sha-${Date.now()}`;
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");
    fp = makeViolatorTs(tmpDir, "sha.ts");
    { const st = statSync(fp); utimesSync(fp, st.atime, new Date(Math.floor(st.mtimeMs))); }
    tp = makeTranscript(tmpDir, [fp], new Date(Date.now() - 10000).toISOString());
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it("same-size character swap detected via sha256; rename aborted", async () => {
    const r = await run(
      { hook_event_name: "Stop", session_id: sessionId, transcript_path: tp },
      process.env as Record<string, string | undefined>,
      {
        testOnly_forceWrite: true,
        afterTmpWrite: (_tmp: string, target: string) => {
          const content = readFileSync(target, "utf8");
          const st = statSync(target);
          writeFileSync(target, content.replace("const", "Const"));
          utimesSync(target, st.atime, st.mtime);
        },
      } as any,
    );
    const out = JSON.parse(r.stdout.trim() || "{}") as Record<string, unknown>;
    expect(out.decision).toBe("block");
    expect(readFileSync(fp, "utf8")).toContain("Const");
  });
});

describe("S1c-toctou-concurrent-edit", () => {
  let tmpDir: string;
  let sessionId: string;
  let fp: string;
  let tp: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-s1c-toctou-"));
    sessionId = `s1c-toctou-${Date.now()}`;
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");
    fp = makeViolatorTs(tmpDir, "toctou.ts");
    tp = makeTranscript(tmpDir, [fp], new Date(Date.now() - 10000).toISOString());
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it("concurrent user write in toctou window: gate blocks; file retains user content; no temp files remain", async () => {
    const userEdit = "const toctou = true;\n";
    const r = await run(
      { hook_event_name: "Stop", session_id: sessionId, transcript_path: tp },
      process.env as Record<string, string | undefined>,
      {
        testOnly_forceWrite: true,
        afterTmpWrite: (_tmp: string, target: string) => {
          writeFileSync(target, userEdit);
        },
      } as any,
    );
    const out = JSON.parse(r.stdout.trim() || "{}") as Record<string, unknown>;
    expect(out.decision).toBe("block");
    expect(readFileSync(fp, "utf8")).toBe(userEdit);
    const tempFiles = readdirSync(tmpDir).filter(f => f.includes(".cdg-"));
    expect(tempFiles.length).toBe(0);
  });
});

describe("S1c-remap-sensitive", () => {
  let tmpDir: string;
  let shadowDir: string;
  let sessionId: string;
  let fp: string;
  let tp: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-s1c-remap-"));
    shadowDir = mkdtempSync(path.join(os.tmpdir(), "cdg-s1c-remap-shad-"));
    sessionId = `s1c-remap-${Date.now()}`;
    initGitRepo(tmpDir);
    fp = path.join(tmpDir, "remap.ts");
    const preLines = ["// pre 0", "// pre 1", "// pre 2", "// pre 3", "// pre 4"];
    writeFileSync(fp, preLines.join("\n") + "\n");
    gitCommit(tmpDir, "base");
    const logR = spawnSync("git", ["-C", tmpDir, "log", "--format=%ct", "-1"], { encoding: "utf8" });
    const baseEpoch = parseInt(logR.stdout.trim(), 10);
    const sessionComments = ["// session 0", "// session 1", "// session 2", "// session 3", "// session 4"];
    const sessionCode = ["const s0 = 0;", "const s1 = 1;", "const s2 = 2;", "const s3 = 3;", "const s4 = 4;"];
    writeFileSync(fp, [...sessionComments, ...sessionCode, ...preLines].join("\n") + "\n");
    const afterTs = new Date((baseEpoch + 1) * 1000).toISOString();
    tp = makeTranscript(tmpDir, [fp], afterTs);
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    try { rmSync(shadowDir, { recursive: true, force: true }); } catch {}
  });

  it("sub-test A: shadow densityAfter=0; no preExisting removed", async () => {
    const r = await run(
      { hook_event_name: "Stop", session_id: sessionId, transcript_path: tp },
      process.env as Record<string, string | undefined>,
      { testOnly_tmpDir: shadowDir, testOnly_fixTableOverride: { typescript: { stability: "preview" } } } as any,
    );
    const out = JSON.parse(r.stdout.trim() || "{}") as Record<string, unknown>;
    expect(out.decision).toBe("block");
    const shadowFile = path.join(shadowDir, "groundwork-autofix-shadow", `${sessionId}.jsonl`);
    expect(existsSync(shadowFile)).toBe(true);
    const rec = JSON.parse(readFileSync(shadowFile, "utf8").split("\n").find(l => l.trim())!) as Record<string, unknown>;
    expect(rec.densityAfter as number).toBe(0);
    const removed = rec.removedLines as Array<{ preExisting: boolean }>;
    for (const entry of removed) expect(entry.preExisting).toBe(false);
  });

  it("sub-test B: write removes session comments; preserves pre-existing", async () => {
    const r = await run(
      { hook_event_name: "Stop", session_id: sessionId, transcript_path: tp },
      process.env as Record<string, string | undefined>,
      { testOnly_fixTableOverride: { typescript: { stability: "stable", applicability: "safe" } } } as any,
    );
    const out = JSON.parse(r.stdout.trim() || "{}") as Record<string, unknown>;
    expect(out.decision).not.toBe("block");
    const content = readFileSync(fp, "utf8");
    expect(content).not.toContain("// session");
    expect(content).toContain("// pre 0");
  });
});

describe("S2-gate-net-growth: reword pre-existing comment", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-s2-"));
    initGitRepo(tmpDir);
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it("reword of a committed comment → allows", async () => {
    const lines = [
      "const a0 = 0;", "const a1 = 1;", "const a2 = 2;", "const a3 = 3;",
      "const a4 = 4;", "const a5 = 5;", "const a6 = 6;", "const a7 = 7;",
      "const a8 = 8;", "// original why comment",
      "const a10 = 10;", "const a11 = 11;", "const a12 = 12;", "const a13 = 13;",
      "const a14 = 14;", "const a15 = 15;", "const a16 = 16;", "const a17 = 17;",
      "const a18 = 18;", "const a19 = 19;",
    ];
    const fp = path.join(tmpDir, "reword.ts");
    writeFileSync(fp, lines.join("\n") + "\n");
    gitCommit(tmpDir, "add file");
    const logR = spawnSync("git", ["-C", tmpDir, "log", "--format=%ct", "-1"], { encoding: "utf8" });
    const baseEpoch = parseInt(logR.stdout.trim(), 10);

    const reworded = lines.map((l, i) => i === 9 ? "// reworded why comment" : l);
    writeFileSync(fp, reworded.join("\n") + "\n");

    const afterTs = new Date((baseEpoch + 1) * 1000).toISOString();
    const tp = makeTranscript(tmpDir, [fp], afterTs);
    const r = runGate({ hook_event_name: "Stop", session_id: `s2a-${Date.now()}`, transcript_path: tp });
    const out = parseOut(r.stdout);
    expect(out.decision).not.toBe("block");
  });

  it("reword + one genuinely new comment → blocks; rows names only new line", async () => {
    const lines = [
      "const b0 = 0;", "const b1 = 1;", "const b2 = 2;", "const b3 = 3;",
      "// pre-existing comment",
      "const b5 = 5;", "const b6 = 6;", "const b7 = 7;", "const b8 = 8;",
      "const b9 = 9;",
    ];
    const fp = path.join(tmpDir, "mixed.ts");
    writeFileSync(fp, lines.join("\n") + "\n");
    gitCommit(tmpDir, "add file");
    const logR = spawnSync("git", ["-C", tmpDir, "log", "--format=%ct", "-1"], { encoding: "utf8" });
    const baseEpoch = parseInt(logR.stdout.trim(), 10);

    const updated = [
      "const b0 = 0;", "const b1 = 1;", "const b2 = 2;", "const b3 = 3;",
      "// reworded comment",
      "const b5 = 5;", "// genuinely new comment",
      "const b7 = 7;", "const b8 = 8;", "const b9 = 9;",
    ];
    writeFileSync(fp, updated.join("\n") + "\n");

    const afterTs = new Date((baseEpoch + 1) * 1000).toISOString();
    const tp = makeTranscript(tmpDir, [fp], afterTs);
    const s2bId = `s2b-${Date.now()}`;
    const r = runGate({ hook_event_name: "Stop", session_id: s2bId, transcript_path: tp }, { TMPDIR: tmpDir });
    const out = parseOut(r.stdout);
    expect(out.decision).toBe("block");
    const reason = out.reason as string;
    expect(reason).toContain("full list:");
    const listMatch = reason.match(/full list: (\S+)/);
    expect(listMatch).toBeDefined();
    const fullReport = readFileSync(listMatch![1], "utf8");
    expect(fullReport).toContain("rows 7");
    expect(fullReport).not.toMatch(/rows.*\b5\b/);
  });

  it("SubagentStop auto-fixes over-cap TypeScript file; allows", async () => {
    const fp = makeViolatorTs(tmpDir, "sub.ts");
    const ts = new Date(Date.now() - 10000).toISOString();
    const agentTp = makeTranscript(tmpDir, [fp], ts);
    const sessionTp = path.join(tmpDir, "session.jsonl");
    writeFileSync(sessionTp, JSON.stringify({ type: "assistant", message: { content: [] }, timestamp: ts, cwd: tmpDir }) + "\n");
    const r = runGate({
      hook_event_name: "SubagentStop",
      session_id: `s2c-${Date.now()}`,
      agent_id: "sub-001",
      transcript_path: sessionTp,
      agent_transcript_path: agentTp,
    });
    const out = parseOut(r.stdout);
    expect(out.decision).not.toBe("block");
    expect(out.hookSpecificOutput).toBeTruthy();
  });
});
