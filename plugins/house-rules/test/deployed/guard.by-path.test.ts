import { describe, it, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const REPO = path.resolve(import.meta.dir, "../..");
const GUARD = path.join(REPO, "src/hooks/comment-density-guard.ts");
const PROBE_SH = path.join(REPO, "test/fixtures/comment-density/nexus-probe/probe.sh");

async function spawnGuard(payload: unknown, tmpDir: string): Promise<{ stdout: string; stderr: string; exit: number }> {
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

describe("comment-density-guard deployed path (probe.sh Write)", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "cdg-deployed-"));
  const targetPath = path.join(tmpDir, "probe-copy.sh");

  it("AC8: updatedInput.content has fewer comment lines, ctx says not another session's edit, no permissionDecision", async () => {
    const content = await Bun.file(PROBE_SH).text();
    const payload = {
      tool_name: "Write",
      tool_input: { file_path: targetPath, content },
    };

    const { stdout, exit } = await spawnGuard(payload, tmpDir);
    expect(exit).toBe(0);

    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("permissionDecision");

    const hso = parsed.hookSpecificOutput as Record<string, unknown>;
    expect(hso).toHaveProperty("updatedInput");
    expect(hso).not.toHaveProperty("permissionDecision");

    const ui = hso.updatedInput as Record<string, unknown>;
    const updatedContent = ui.content as string;
    const originalLines = content.split("\n").filter(l => l.trim().match(/^#[^!]/));
    const updatedLines = updatedContent.split("\n").filter(l => l.trim().match(/^#[^!]/));
    expect(updatedLines.length).toBeLessThan(originalLines.length);

    const ctx = hso.additionalContext as string;
    expect(ctx).toContain("not another session's edit");
  });

  it("AC9: median wall-clock of 10 spawns ≤ 15s each", async () => {
    const content = await Bun.file(PROBE_SH).text();
    const payload = {
      tool_name: "Write",
      tool_input: { file_path: targetPath, content },
    };

    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = Date.now();
      await spawnGuard(payload, tmpDir);
      times.push(Date.now() - start);
    }

    times.sort((a, b) => a - b);
    const median = times[4];
    console.log(`Latency: ${times.join(", ")} ms; median=${median} ms`);
    expect(median).toBeLessThan(15000);
  });
});
