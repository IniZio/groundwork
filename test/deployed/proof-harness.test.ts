import { describe, it, expect, afterAll } from "bun:test";
import { statSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, copyFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");
const HARNESS = path.join(ROOT, "scripts/proof-harness.sh");
const SCRATCH = path.join(ROOT, "test/deployed/_proof-harness-scratch");

const EXPECTED_VERSION: string = JSON.parse(
  readFileSync(path.join(ROOT, "package.json"), "utf8")
).version;

mkdirSync(SCRATCH, { recursive: true });
afterAll(() => { try { rmSync(SCRATCH, { recursive: true, force: true }); } catch { /**/ } });

function makeLog(dir: string, initEvent: Record<string, unknown>): string {
  const logPath = path.join(dir, "stdout.log");
  writeFileSync(logPath, JSON.stringify(initEvent) + "\n");
  return logPath;
}

function runCheckLog(logPath: string): { exit: number; stdout: string } {
  try {
    const stdout = execSync(`bash "${HARNESS}" --check-log "${logPath}"`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { exit: 0, stdout };
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string };
    return { exit: e.status ?? 1, stdout: e.stdout ?? "" };
  }
}

describe("proof-harness.sh — script presence and executability", () => {
  it("exists at scripts/proof-harness.sh", () => {
    expect(existsSync(HARNESS)).toBe(true);
  });

  it("is executable", () => {
    const mode = statSync(HARNESS).mode;
    expect(mode & 0o111).not.toBe(0);
  });
});

describe("proof-harness.sh --check-log — init check bites on bad input", () => {
  it("exits non-zero when system/init event is absent", () => {
    const dir = path.join(SCRATCH, "no-init");
    mkdirSync(dir, { recursive: true });
    const log = makeLog(dir, { type: "assistant", content: "hello" });
    const result = runCheckLog(log);
    expect(result.exit).not.toBe(0);
    expect(result.stdout).toContain("FAIL");
  });

  it("exits non-zero when groundwork plugin is missing from init event", () => {
    const dir = path.join(SCRATCH, "no-gw");
    mkdirSync(dir, { recursive: true });
    const log = makeLog(dir, {
      type: "system",
      subtype: "init",
      plugins: [{ name: "mattpocock-skills", version: "1.0.0" }],
      agents: [],
    });
    const result = runCheckLog(log);
    expect(result.exit).not.toBe(0);
    expect(result.stdout).toContain("FAIL");
    expect(result.stdout).toContain(`groundwork ${EXPECTED_VERSION} not found`);
  });

  it("exits non-zero when groundwork has wrong version", () => {
    const dir = path.join(SCRATCH, "wrong-ver");
    mkdirSync(dir, { recursive: true });
    const log = makeLog(dir, {
      type: "system",
      subtype: "init",
      plugins: [
        { name: "groundwork", version: "3.7.0" },
        { name: "mattpocock-skills", version: "1.0.0" },
      ],
      agents: [
        { name: "groundwork:advisor" },
        { name: "groundwork:implementer" },
        { name: "groundwork:orchestrator" },
        { name: "groundwork:qa" },
      ],
    });
    const result = runCheckLog(log);
    expect(result.exit).not.toBe(0);
    expect(result.stdout).toContain("FAIL");
    expect(result.stdout).toContain("unexpected groundwork versions");
  });

  it("exits non-zero when an agent is missing", () => {
    const dir = path.join(SCRATCH, "no-agent");
    mkdirSync(dir, { recursive: true });
    const log = makeLog(dir, {
      type: "system",
      subtype: "init",
      plugins: [
        { name: "groundwork", version: EXPECTED_VERSION },
        { name: "mattpocock-skills", version: "1.0.0" },
      ],
      agents: [
        { name: "groundwork:advisor" },
        { name: "groundwork:orchestrator" },
      ],
    });
    const result = runCheckLog(log);
    expect(result.exit).not.toBe(0);
    expect(result.stdout).toContain("FAIL");
  });

  it("exits 0 when all conditions are met", () => {
    const dir = path.join(SCRATCH, "pass");
    mkdirSync(dir, { recursive: true });
    const log = makeLog(dir, {
      type: "system",
      subtype: "init",
      plugins: [
        { name: "groundwork", version: EXPECTED_VERSION },
        { name: "mattpocock-skills", version: "1.0.0" },
      ],
      agents: [
        { name: "groundwork:advisor" },
        { name: "groundwork:implementer" },
        { name: "groundwork:orchestrator" },
        { name: "groundwork:qa" },
      ],
    });
    const result = runCheckLog(log);
    expect(result.exit).toBe(0);
    expect(result.stdout).toContain("PASS");
    expect(result.stdout).not.toContain("FAIL");
  });
});

describe("proof-harness.sh — version follows package.json", () => {
  it("fails when package.json declares a different version than the log", () => {
    const treeDir = path.join(SCRATCH, "alt-pkg-tree");
    const scriptsDir = path.join(treeDir, "scripts");
    mkdirSync(scriptsDir, { recursive: true });

    copyFileSync(HARNESS, path.join(scriptsDir, "proof-harness.sh"));
    execSync(`chmod +x "${path.join(scriptsDir, "proof-harness.sh")}"`);

    const altVersion = "9.9.9";
    writeFileSync(
      path.join(treeDir, "package.json"),
      JSON.stringify({ name: "groundwork", version: altVersion }),
    );

    const logDir = path.join(SCRATCH, "alt-pkg-log");
    mkdirSync(logDir, { recursive: true });
    const log = makeLog(logDir, {
      type: "system",
      subtype: "init",
      plugins: [
        { name: "groundwork", version: EXPECTED_VERSION },
        { name: "mattpocock-skills", version: "1.0.0" },
      ],
      agents: [
        { name: "groundwork:advisor" },
        { name: "groundwork:implementer" },
        { name: "groundwork:orchestrator" },
        { name: "groundwork:qa" },
      ],
    });

    const altHarness = path.join(scriptsDir, "proof-harness.sh");
    let exit = 0;
    let stdout = "";
    try {
      stdout = execSync(`bash "${altHarness}" --check-log "${log}"`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err: unknown) {
      const e = err as { status?: number; stdout?: string };
      exit = e.status ?? 1;
      stdout = e.stdout ?? "";
    }

    expect(exit).not.toBe(0);
    expect(stdout).toContain("FAIL");
    expect(stdout).toContain(`groundwork ${altVersion} not found`);
  });
});

describe("proof-harness.sh --check-log — session-start marker detection", () => {
  function makeSessionStartLog(dir: string, secondLine: Record<string, unknown>): string {
    mkdirSync(dir, { recursive: true });
    const initEvent = JSON.stringify({
      type: "system",
      subtype: "init",
      plugins: [
        { name: "groundwork", version: EXPECTED_VERSION },
        { name: "mattpocock-skills", version: "1.0.0" },
      ],
      agents: [
        { name: "groundwork:advisor" },
        { name: "groundwork:implementer" },
        { name: "groundwork:orchestrator" },
        { name: "groundwork:qa" },
      ],
    });
    const logPath = path.join(dir, "stdout.log");
    writeFileSync(logPath, initEvent + "\n" + JSON.stringify(secondLine) + "\n");
    return logPath;
  }

  it("reports PRESENT when log contains v2.7.2 SessionStart hook_response", () => {
    const dir = path.join(SCRATCH, "ss-v2");
    const log = makeSessionStartLog(dir, {
      type: "system",
      subtype: "hook_response",
      hook_event: "SessionStart",
      output: "# groundwork v2.7.2 (abc1234) — /x\n",
    });
    const result = runCheckLog(log);
    expect(result.exit).toBe(0);
    expect(result.stdout).toContain("PRESENT");
  });

  it("reports PRESENT when log contains v3.0.0 SessionStart hook_response", () => {
    const dir = path.join(SCRATCH, "ss-v3");
    const log = makeSessionStartLog(dir, {
      type: "system",
      subtype: "hook_response",
      hook_event: "SessionStart",
      output: "# groundwork v3.0.0 (abc1234) — /x\n",
    });
    const result = runCheckLog(log);
    expect(result.exit).toBe(0);
    expect(result.stdout).toContain("PRESENT");
  });

  it("reports ABSENT when log contains only a user message mentioning 'groundwork v2'", () => {
    const dir = path.join(SCRATCH, "ss-prose");
    const log = makeSessionStartLog(dir, {
      type: "user",
      message: "groundwork v2 is great; spawn groundwork:advisor",
    });
    const result = runCheckLog(log);
    expect(result.exit).toBe(0);
    expect(result.stdout).toContain("ABSENT");
  });
});

describe("proof-harness.sh — missing-plugin bite proof", () => {
  it("exits non-zero when plugin name is changed (simulating wrong plugin)", () => {
    const dir = path.join(SCRATCH, "wrong-name");
    mkdirSync(dir, { recursive: true });
    const log = makeLog(dir, {
      type: "system",
      subtype: "init",
      plugins: [
        { name: "not-groundwork", version: EXPECTED_VERSION },
        { name: "mattpocock-skills", version: "1.0.0" },
      ],
      agents: [
        { name: "groundwork:advisor" },
        { name: "groundwork:implementer" },
        { name: "groundwork:orchestrator" },
        { name: "groundwork:qa" },
      ],
    });
    const result = runCheckLog(log);
    expect(result.exit).not.toBe(0);
    expect(result.stdout).toContain("FAIL");
    expect(result.stdout).toContain(`groundwork ${EXPECTED_VERSION} not found`);
  });
});
