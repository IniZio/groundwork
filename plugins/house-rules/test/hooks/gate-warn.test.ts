import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const GATE_PATH = path.join(import.meta.dir, "../../src/hooks/gate.ts");
const VIOLATION = "const v = Reflect.get(o, k);";

function git(dir: string, ...args: string[]): void {
  spawnSync("git", args, { cwd: dir, encoding: "utf8" });
}

function runGate(payload: unknown): { stdout: string; status: number | null } {
  const r = spawnSync("bun", [GATE_PATH], { input: JSON.stringify(payload), env: { ...process.env }, encoding: "utf8" });
  return { stdout: r.stdout ?? "", status: r.status };
}

function parse(stdout: string): Record<string, unknown> {
  return stdout.trim() ? JSON.parse(stdout.trim()) as Record<string, unknown> : {};
}

describe("gate warn findings", () => {
  let tmpDir: string;
  let n = 0;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "hr-warn-"));
    git(tmpDir, "init");
    git(tmpDir, "config", "user.email", "t@t.com");
    git(tmpDir, "config", "user.name", "T");
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    git(tmpDir, "add", "-A");
    git(tmpDir, "commit", "-m", "base");
  });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  function stop(files: Record<string, string>): { out: Record<string, unknown>; status: number | null; session: string } {
    const writes: string[] = [];
    const ts = new Date(Date.now() - 5000).toISOString();
    for (const [rel, content] of Object.entries(files)) {
      const fp = path.join(tmpDir, rel);
      mkdirSync(path.dirname(fp), { recursive: true });
      writeFileSync(fp, content);
      writes.push(JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Write", input: { file_path: fp, content } }] },
        timestamp: ts,
        cwd: tmpDir,
      }));
    }
    const tp = path.join(tmpDir, `transcript-${++n}.jsonl`);
    writeFileSync(tp, writes.join("\n") + "\n");
    const session = `warn-${process.pid}-${Date.now()}-${n}`;
    const r = runGate({ hook_event_name: "Stop", session_id: session, transcript_path: tp, cwd: tmpDir });
    return { out: parse(r.stdout), status: r.status, session };
  }

  const counterFile = (session: string) => path.join(os.tmpdir(), "house-rules-comment-density", `${session}-main.json`);

  it("AC1/AC2: warn-only run shows path:line ruleId message in systemMessage, no block, no counter", () => {
    const { out, status, session } = stop({ "a.ts": `${VIOLATION}\n` });
    expect(status).toBe(0);
    expect(out.decision).toBeUndefined();
    const msg = out.systemMessage as string;
    expect(msg).toContain("house-rules warnings:");
    expect(msg).toMatch(/a\.ts:1 code-smells .*Reflect\.get/);
    expect(existsSync(counterFile(session))).toBe(false);
  });

  it("AC3: warn findings stay out of the block counter signature", () => {
    const { out, session } = stop({ "tmp-notes.md": "# notes\n", "a.ts": `${VIOLATION}\n` });
    expect(out.decision).toBe("block");
    const state = JSON.parse(readFileSync(counterFile(session), "utf8")) as { sig: string };
    expect(state.sig).toBe(path.join(tmpDir, "tmp-notes.md"));
    expect(state.sig).not.toContain("a.ts");
  });

  it("AC4: config severity off suppresses the rule", () => {
    writeFileSync(path.join(tmpDir, ".house-rules.json"), JSON.stringify({ rules: { "code-smells": ["off"] } }));
    const { out } = stop({ "a.ts": `${VIOLATION}\n` });
    expect(out.systemMessage).toBeUndefined();
    expect(out.decision).toBeUndefined();
  });

  it("AC5: list capped at 20 lines plus a tail", () => {
    const body = Array.from({ length: 25 }, (_, i) => `const v${i} = Reflect.get(o, k${i});`).join("\n\n") + "\n";
    const { out } = stop({ "a.ts": body });
    const lines = (out.systemMessage as string).split("\n");
    expect(lines.filter(l => /^a\.ts:\d+ code-smells /.test(l)).length).toBe(20);
    expect(lines[lines.length - 1]).toBe("… 5 more");
  });

  it("AC6: baselined findings are not shown", () => {
    const fp = createHash("sha256").update("code-smells\0a.ts\0no-reflect-get " + VIOLATION.trim().replace(/\s+/g, " ")).digest("hex");
    mkdirSync(path.join(tmpDir, ".house-rules"), { recursive: true });
    const first = stop({ "a.ts": `${VIOLATION}\n` });
    expect(first.out.systemMessage).toBeDefined();
    const alt = createHash("sha256").update("code-smells\0a.ts\0" + `no-reflect-get\n${VIOLATION}`).digest("hex");
    writeFileSync(path.join(tmpDir, ".house-rules", "baseline.json"), JSON.stringify({
      version: 1,
      entries: [fp, alt].map(f => ({ rule: "code-smells", path: "a.ts", fingerprint: f })),
    }));
    const { out } = stop({ "a.ts": `${VIOLATION}\n` });
    expect(out.systemMessage).toBeUndefined();
  });
});
