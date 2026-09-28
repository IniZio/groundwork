// AC7: JS-family autofix through guard.ts / gate.ts spawned by path, as plugin.json registers them.

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

const JS_OVER_BUDGET = [
  ...Array.from({ length: 20 }, (_, i) => `const v${i} = ${i};`),
  "// narrative comment one: this variable is used for something important",
  "// narrative comment two: the following call logs the result to stdout",
  "// narrative comment three: we need this for debugging purposes",
  "// narrative comment four: this is explaining the architecture",
  "// narrative comment five: more explanation of the design decision",
  "// narrative comment six: final note about what happens next",
  "// eslint-disable-next-line no-console",
  "console.log(v0);",
].join("\n");

const JSX_OVER_BUDGET = [
  'import React from "react";',
  "",
  "function Component() {",
  ...Array.from({ length: 10 }, (_, i) => `  const x${i} = ${i};`),
  "  return (",
  "    <div>",
  "      {/* First narrative JSX comment describing the heading section */}",
  "      <h1>Title</h1>",
  "      {/* Second narrative JSX comment describing the paragraph section */}",
  "      <p>Hello</p>",
  "      {/* Third narrative JSX comment describing the footer section */}",
  "      <footer>Footer</footer>",
  "    </div>",
  "  );",
  "}",
  "",
  "export default Component;",
].join("\n");

describe("AC7-JS: guard Write of over-budget .js strips narrative, keeps directive", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ac7-js-"));
  const jsPath = path.join(tmpDir, "module.js");

  it("updatedInput.content: narrative comments gone, code lines intact, eslint directive kept", async () => {
    const payload = {
      tool_name: "Write",
      tool_input: { file_path: jsPath, content: JS_OVER_BUDGET },
    };

    const { stdout, exit } = await spawnGuard(payload, tmpDir);
    expect(exit).toBe(0);

    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("permissionDecision");

    const hso = parsed.hookSpecificOutput as Record<string, unknown>;
    expect(hso).toHaveProperty("updatedInput");

    const ui = hso.updatedInput as Record<string, unknown>;
    const updated = ui.content as string;

    const origNarrative = JS_OVER_BUDGET.split("\n").filter(l =>
      l.trim().startsWith("//") && !l.includes("eslint-disable"),
    );
    const updNarrative = updated.split("\n").filter(l =>
      l.trim().startsWith("//") && !l.includes("eslint-disable"),
    );
    expect(updNarrative.length).toBeLessThan(origNarrative.length);

    for (let i = 0; i < 20; i++) {
      expect(updated).toContain(`const v${i} = ${i};`);
    }

    expect(updated).toContain("// eslint-disable-next-line no-console");

    const ctx = hso.additionalContext as string;
    expect(ctx).toContain("not another session's edit");
  });
});

describe("AC7-JSX: guard Write of over-budget .jsx strips {/* narrative */} with no leftover {}", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ac7-jsx-"));
  const jsxPath = path.join(tmpDir, "component.jsx");

  it("updatedInput.content: JSX narrative comment gone, no orphaned {} line", async () => {
    const payload = {
      tool_name: "Write",
      tool_input: { file_path: jsxPath, content: JSX_OVER_BUDGET },
    };

    const { stdout, exit } = await spawnGuard(payload, tmpDir);
    expect(exit).toBe(0);

    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    const hso = parsed.hookSpecificOutput as Record<string, unknown>;
    expect(hso).toHaveProperty("updatedInput");

    const ui = hso.updatedInput as Record<string, unknown>;
    const updated = ui.content as string;

    expect(updated).not.toContain("{/* Second narrative JSX comment describing the paragraph section */}");

    const updLines = updated.split("\n");
    const hasOrphanedBraces = updLines.some(l => l.trim() === "{}");
    expect(hasOrphanedBraces).toBe(false);

    expect(updated).toContain("<p>Hello</p>");

    const origCommentLines = JSX_OVER_BUDGET.split("\n").filter(l =>
      l.trim().startsWith("//") || l.trim().startsWith("{/*"),
    );
    const updCommentLines = updated.split("\n").filter(l =>
      l.trim().startsWith("//") || l.trim().startsWith("{/*"),
    );
    expect(updCommentLines.length).toBeLessThan(origCommentLines.length);
  });
});

describe("AC7-MJS: gate Stop autofix of over-budget .mjs — file fixed on disk, stdout reports autofix", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ac7-mjs-"));
  const mjsPath = path.join(tmpDir, "utils.mjs");

  const MJS_OVER_BUDGET = [
    ...Array.from({ length: 20 }, (_, i) => `export const u${i} = ${i};`),
    "// narrative mjs comment one: this module exports utilities",
    "// narrative mjs comment two: each export is a numeric constant",
    "// narrative mjs comment three: these are used across the codebase",
    "// narrative mjs comment four: the values are sequential integers",
    "// narrative mjs comment five: this file follows the ESM convention",
    "// narrative mjs comment six: imported via import { uN } from this file",
    "",
  ].join("\n");

  it("gate removes narrative comments from disk; stdout is hookSpecificOutput with auto-removed text", () => {
    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");

    writeFileSync(mjsPath, MJS_OVER_BUDGET);

    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [mjsPath], ts);

    const r = spawnGate({
      hook_event_name: "Stop",
      session_id: `ac7-mjs-${Date.now()}`,
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

    const diskContent = readFileSync(mjsPath, "utf8");
    expect(diskContent).not.toContain("// narrative mjs comment one");
    expect(diskContent).not.toContain("// narrative mjs comment two");

    for (let i = 0; i < 20; i++) {
      expect(diskContent).toContain(`export const u${i} = ${i};`);
    }
  });
});

describe("AC7-JSX-BLOCK: gate Stop blocks unfixable over-budget .jsx; density figure in reason", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ac7-jsx-block-"));
  const jsxPath = path.join(tmpDir, "component.jsx");

  const BASE_CONTENT = [
    'import React from "react";',
    "",
    "function Component() {",
    "  return (",
    "    <div>",
    "      <p>initial paragraph</p>",
    "      {",
    "      }",
    "    </div>",
    "  );",
    "}",
    "",
    "export default Component;",
    "",
  ].join("\n");

  const POST_CONTENT = [
    'import React from "react";',
    "",
    "function Component() {",
    "  return (",
    "    <div>",
    "      <p>initial paragraph</p>",
    "      {",
    "        /* narrative comment: explaining why this section renders items */",
    "      }",
    "      <p>item one</p>",
    "      <p>item two</p>",
    "      <p>item three</p>",
    "      <p>item four</p>",
    "      <p>item five</p>",
    "      <p>item six</p>",
    "      <p>item seven</p>",
    "      <p>item eight</p>",
    "      <p>item nine</p>",
    "    </div>",
    "  );",
    "}",
    "",
    "export default Component;",
    "",
  ].join("\n");

  it("gate blocks: comment inside pre-existing JSX braces not removable; reason has density figure", () => {
    initGitRepo(tmpDir);
    writeFileSync(jsxPath, BASE_CONTENT);
    gitCommit(tmpDir, "initial");

    writeFileSync(jsxPath, POST_CONTENT);

    const ts = new Date(Date.now() + 10000).toISOString();
    const tp = makeTranscript(tmpDir, [jsxPath], ts);

    const r = spawnGate(
      {
        hook_event_name: "Stop",
        session_id: `ac7-jsx-block-${Date.now()}`,
        transcript_path: tp,
        cwd: tmpDir,
        stop_hook_active: false,
      },
      { TMPDIR: "/dev/null" },
    );

    expect(r.status).toBe(0);

    const parsed = JSON.parse(r.stdout.trim()) as Record<string, unknown>;

    expect(parsed.decision).toBe("block");
    expect(parsed.reason as string).toContain("component.jsx");
    expect(parsed.reason as string).toContain("10.0/100 (1 comment in 10 added lines; rows 8)");
  });
});
