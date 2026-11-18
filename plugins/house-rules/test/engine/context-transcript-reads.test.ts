import { describe, it, expect, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildContext } from "../../src/engine/context.js";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): void {
  const r = spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" });
  expect(r.status, `git ${args.join(" ")}: ${r.stderr}`).toBe(0);
}

const PAD_LINE = JSON.stringify({ type: "summary", note: "x".repeat(2000) });

/** A repo of `count` committed files, each edited through one Edit entry of a transcript followed by `padLines` unrelated entries. */
function editedRepo(count: number, padLines: number) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "hr-ctx-reads-")));
  roots.push(root);
  const repo = path.join(root, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  const files = Array.from({ length: count }, (_, i) => path.join(repo, `f${i}.ts`));
  for (const f of files) writeFileSync(f, "export const a = 1;\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "init");
  const lines = files.map((f, i) => {
    writeFileSync(f, "export const a = 2;\n");
    const input = { file_path: f, old_string: "1", new_string: "2" };
    return JSON.stringify({ type: "assistant", cwd: repo, timestamp: new Date().toISOString(),
      message: { content: [{ type: "tool_use", id: `e${i}`, name: "Edit", input }] } });
  });
  for (let i = 0; i < padLines; i++) lines.push(PAD_LINE);
  const transcript = path.join(root, "s1.jsonl");
  writeFileSync(transcript, lines.join("\n") + "\n");
  return { repo, transcript };
}

/** Bytes this process has read through read(2), from /proc. */
function bytesRead(): number {
  return Number(/^rchar: (\d+)$/m.exec(readFileSync("/proc/self/io", "utf8"))![1]);
}

/** Bytes read while building the gate context over a transcript of the given padding. */
function buildCost(files: number, padLines: number) {
  const { repo, transcript } = editedRepo(files, padLines);
  const build = () => buildContext({ repoRoot: repo, mode: "gate", transcriptPath: transcript, sessionId: "s1" });
  build();
  const before = bytesRead();
  const ctx = build();
  return { bytes: bytesRead() - before, size: readFileSync(transcript).length, files: ctx.files?.length };
}

describe.skipIf(!existsSync("/proc/self/io"))("gate buildContext reads the transcript once per file in scope", () => {
  it("reads a padded transcript a bounded number of times however many files are in scope", () => {
    const plain = buildCost(12, 0);
    const padded = buildCost(12, 500);

    expect(padded.files).toBe(12);
    const transcriptReads = (padded.bytes - plain.bytes) / (padded.size - plain.size);
    expect(transcriptReads).toBeLessThan(4);
  });
});
