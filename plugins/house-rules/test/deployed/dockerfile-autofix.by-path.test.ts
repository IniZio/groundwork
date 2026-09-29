// Dockerfile autofix through guard.ts / gate.ts spawned by path, as plugin.json registers them.

import { describe, it, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const REPO = path.resolve(import.meta.dir, "../..");
const GUARD = path.join(REPO, "src/hooks/guard.ts");
const GATE = path.join(REPO, "src/hooks/gate.ts");

async function spawnGuard(payload: unknown, tmpDir: string): Promise<{ stdout: string; exit: number }> {
  const proc = Bun.spawn(["bun", GUARD], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CLAUDE_PROJECT_DIR: "/decoy/project/dir", CLAUDE_PLUGIN_ROOT: REPO } as Record<string, string>,
    cwd: tmpDir,
  });
  proc.stdin.write(JSON.stringify(payload));
  proc.stdin.end();
  const [stdout] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { stdout, exit: await proc.exited };
}

function spawnGate(payload: unknown): { stdout: string; status: number | null } {
  const r = spawnSync("bun", [GATE], {
    input: JSON.stringify(payload),
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: REPO },
    encoding: "utf8",
  });
  return { stdout: r.stdout ?? "", status: r.status };
}

function sh(dir: string, args: string[]): void {
  spawnSync("git", args, { cwd: dir, encoding: "utf8" });
}

function makeTranscript(tmpDir: string, files: string[], timestamp: string): string {
  const transcriptPath = path.join(tmpDir, `transcript-${Date.now()}.jsonl`);
  const lines = files.map((fp) =>
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Write", input: { file_path: fp, content: readFileSync(fp, "utf8") } }] },
      timestamp,
      cwd: tmpDir,
    }),
  );
  writeFileSync(transcriptPath, lines.join("\n") + "\n");
  return transcriptPath;
}

const NARRATIVE = [
  "# narrative one: this image builds the service from the module cache",
  "# narrative two: the runtime layer carries only the compiled binary",
  "# narrative three: apt indexes are removed to keep the layer small",
  "# narrative four: the port is documented for the desktop UI listing",
  "# narrative five: the unprivileged user limits container escape damage",
  "# narrative six: see the release notes for the base image policy",
];

const DIRECTIVES = ["# syntax=docker/dockerfile:1", "# check=skip=JSONArgsRecommended"];
const MARKER = "# hadolint ignore=DL3008";

const CONTENT = [
  ...DIRECTIVES,
  "FROM debian:bookworm-slim",
  "WORKDIR /app",
  ...Array.from({ length: 12 }, (_, i) => `ENV KEY_${i}=${i}`),
  "",
  ...NARRATIVE,
  "",
  MARKER,
  "RUN apt-get update \\",
  "    # inner continuation prose one here",
  "    && apt-get install -y curl \\",
  "    # inner continuation prose two here",
  "    && rm -rf /var/lib/apt/lists/*",
  "RUN <<EOF",
  "# heredoc shell comment stays",
  "echo hi",
  "EOF",
  'ENV NOTE="value # not a comment"',
  "USER nobody",
  "",
].join("\n");

const NAMES = ["Dockerfile", "Containerfile", "service.dockerfile"];

function assertFixed(updated: string): void {
  const survivors = updated.split("\n").filter((l) => /^\s*# (?:narrative|inner continuation)/.test(l));
  expect(survivors.length).toBeLessThanOrEqual(1);
  expect(updated.split("\n").length).toBeLessThan(CONTENT.split("\n").length - 6);
  expect(updated.split("\n").slice(0, 2)).toEqual(DIRECTIVES);
  expect(updated).toContain(MARKER);
  const noInner = updated.replace(/^ {4}# inner continuation prose.*\n/gm, "");
  expect(noInner).toContain("RUN apt-get update \\\n    && apt-get install -y curl \\\n    && rm -rf /var/lib/apt/lists/*\n");
  expect(updated).toContain("RUN <<EOF\n# heredoc shell comment stays\necho hi\nEOF\n");
  expect(updated).toContain('ENV NOTE="value # not a comment"');
  for (let i = 0; i < 12; i++) expect(updated).toContain(`ENV KEY_${i}=${i}`);
  expect(updated).toContain("USER nobody");
}

describe("guard Write of over-budget Dockerfile-family file strips narrative", () => {
  for (const name of NAMES) {
    it(`${name}: exit 0, updatedInput fixed`, async () => {
      const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ac-docker-guard-"));
      const { stdout, exit } = await spawnGuard(
        { tool_name: "Write", tool_input: { file_path: path.join(tmpDir, name), content: CONTENT } },
        tmpDir,
      );
      expect(exit).toBe(0);
      const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
      const hso = parsed.hookSpecificOutput as Record<string, unknown>;
      expect(hso).toHaveProperty("updatedInput");
      assertFixed((hso.updatedInput as Record<string, unknown>).content as string);
      expect(hso.additionalContext as string).toContain("not another session's edit");
    });
  }
});

describe("gate Stop autofix of over-budget Dockerfile-family file fixes disk", () => {
  for (const name of NAMES) {
    it(`${name}: file fixed on disk, stdout reports autofix`, () => {
      const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ac-docker-gate-"));
      sh(tmpDir, ["init"]);
      sh(tmpDir, ["config", "user.email", "test@test.com"]);
      sh(tmpDir, ["config", "user.name", "Test"]);
      writeFileSync(path.join(tmpDir, ".gitkeep"), "");
      sh(tmpDir, ["add", "-A"]);
      sh(tmpDir, ["commit", "--allow-empty", "-m", "initial"]);

      const fp = path.join(tmpDir, name);
      writeFileSync(fp, CONTENT);
      const tp = makeTranscript(tmpDir, [fp], new Date(Date.now() - 10000).toISOString());

      const r = spawnGate({
        hook_event_name: "Stop",
        session_id: `ac-docker-gate-${name}-${Date.now()}`,
        transcript_path: tp,
        cwd: tmpDir,
        stop_hook_active: false,
      });
      expect(r.status).toBe(0);
      const parsed = JSON.parse(r.stdout.trim()) as Record<string, unknown>;
      expect(parsed.decision).not.toBe("block");
      const ctx = (parsed.hookSpecificOutput as Record<string, unknown>).additionalContext as string;
      expect(ctx).toContain("auto-removed");
      expect(ctx).toContain(name);
      assertFixed(readFileSync(fp, "utf8"));
    });
  }
});
