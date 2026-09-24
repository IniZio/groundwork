import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, copyFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { run } from "../../src/hooks/comment-density-gate.js";

const GATE_PATH = path.join(import.meta.dir, "../../src/hooks/comment-density-gate.ts");
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
    expect(out.decision).toBe("block");
    expect(sha256(fp)).toBe(hashBefore);
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

  it("blocks TS file with dense comments over cap; file unchanged on disk", async () => {
    const fp = makeViolatorTs(tmpDir, "dense.ts");
    const hashBefore = sha256(fp);
    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [fp], ts);
    const r = runGate({ hook_event_name: "Stop", session_id: `ac3a-${Date.now()}`, transcript_path: tp });
    expect(parseOut(r.stdout).decision).toBe("block");
    expect(sha256(fp)).toBe(hashBefore);
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

  it("fixable violation blocks; file unchanged on disk", () => {
    const fp = makeViolatorTs(tmpDir, "v.ts");
    const hashBefore = sha256(fp);
    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [fp], ts);
    const r = runGate({ hook_event_name: "Stop", session_id: `ac6d-${Date.now()}`, transcript_path: tp });
    expect(parseOut(r.stdout).decision).toBe("block");
    expect(sha256(fp)).toBe(hashBefore);
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

  it("stop_hook_active:true does not skip the check — blocks fixable files", async () => {
    const fp = makeViolatorTs(tmpDir, "dense.ts");
    const hashBefore = sha256(fp);
    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [fp], ts);
    const r = runGate(
      { hook_event_name: "Stop", session_id: `ac6b-${Date.now()}`, transcript_path: tp, stop_hook_active: true },
    );
    const out = parseOut(r.stdout);
    expect(out.decision).toBe("block");
    expect(sha256(fp)).toBe(hashBefore);
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

  it("SubagentStop blocks over-cap file; file unchanged on disk", async () => {
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
    expect(out.decision).toBe("block");
    expect(out.reason as string).toContain("sub-dense.ts");
    expect(sha256(fp)).toBe(hashBefore);
  });
});

describe("AC8: end-user test/fixtures in other repos are blocked", () => {
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

  it("over-cap file at test/fixtures/ in a different repo is blocked; file unchanged", () => {
    const fixtureDir = path.join(tmpDir, "test", "fixtures");
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

  it("gate blocks; file unchanged; base comments still present", async () => {
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
    expect(parseOut(r.stdout).decision).toBe("block");
    expect(sha256(fp)).toBe(hashBefore);

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

describe("AC13: unfixable file blocks; fixed files mentioned in reason", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-ac13-"));
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");
  });

  afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { } });

  it("fixable + unfixable: blocks; reason mentions both files; neither written", () => {
    const fixable = makeViolatorTs(tmpDir, "fix.ts");
    const unfixable = makeUnfixableViolatorTs(tmpDir, "nofix.ts");
    const hashFix = sha256(fixable);
    const hashNofix = sha256(unfixable);
    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [fixable, unfixable], ts);
    const r = runGate({ hook_event_name: "Stop", session_id: `ac13-${Date.now()}`, transcript_path: tp });
    const out = parseOut(r.stdout);
    expect(out.decision).toBe("block");
    expect(out.reason as string).toContain("nofix.ts");
    expect(out.reason as string).toContain("fix.ts");
    expect(sha256(fixable)).toBe(hashFix);
    expect(sha256(unfixable)).toBe(hashNofix);
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

  it("bite: untracked file with Write-first-touch IS measured → gate blocks", async () => {
    const fp = makeViolatorTs(tmpDir, "written-by-session.ts");
    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [fp], ts);
    const r = await run(
      { hook_event_name: "Stop", session_id: `bugb-bite-${Date.now()}`, transcript_path: tp },
      process.env as Record<string, string | undefined>,
    );
    const out = JSON.parse(r.stdout.trim() || "{}") as Record<string, unknown>;
    expect(out.decision).toBe("block");
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
        autoFixEnabled: true,
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
      { autoFixEnabled: true },
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
    const testPath = path.join(import.meta.dir, "comment-density-gate.test.ts");
    expect(await checkFileDensity(testPath)).toBeLessThanOrEqual(5);
  });
});
