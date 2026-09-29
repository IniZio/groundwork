// YAML autofix through guard.ts / gate.ts spawned by path, as plugin.json registers them.

import { describe, it, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { getParser } from "../../src/hooks/lib/tree-sitter-loader.js";
import { parseText } from "../../src/hooks/languages/parse.js";

const REPO = path.resolve(import.meta.dir, "../..");
const GUARD = path.join(REPO, "src/hooks/guard.ts");
const GATE = path.join(REPO, "src/hooks/gate.ts");

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

function spawnGate(payload: unknown): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync("bun", [GATE], {
    input: JSON.stringify(payload),
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: REPO },
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
  const lines = files.map((fp) =>
    JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Write", input: { file_path: fp, content: readFileSync(fp, "utf8") } }],
      },
      timestamp,
      cwd: tmpDir,
    }),
  );
  writeFileSync(transcriptPath, lines.join("\n") + "\n");
  return transcriptPath;
}

async function assertParsesClean(content: string, label: string): Promise<void> {
  const r = await parseText(content, "yaml", getParser);
  expect(r.ok, `${label}: parse failed: ${r.ok ? "" : r.reason}`).toBe(true);
  if (r.ok) {
    expect(r.errorRows.size, `${label}: ERROR/MISSING nodes on rows: ${[...r.errorRows].join(",")}`).toBe(0);
  }
}

function sameData(before: string, after: string): void {
  expect(Bun.YAML.parse(after)).toEqual(Bun.YAML.parse(before));
}

const DIRECTIVE_LINES = [
  "# yaml-language-server: $schema=https://json.schemastore.org/github-workflow.json",
  "# yamllint disable rule:line-length",
  "# prettier-ignore",
];

function expectProseWithinBudget(out: string): void {
  const survivors = out.split("\n").filter((l) => l.includes("# narrative"));
  expect(survivors.length).toBeLessThan(4);
}

function buildYaml(tag: string): { text: string; narrative: string[] } {
  const narrative = [
    `# narrative ${tag} one: this workflow builds the service on every push`,
    `# narrative ${tag} two: caching is handled by the setup action below`,
    `# narrative ${tag} three: the matrix runs the suite on two runtimes`,
    `# narrative ${tag} four: deploy is gated on the main branch only`,
    `# narrative ${tag} five: secrets are injected by the environment`,
    `# narrative ${tag} six: artifacts are kept for seven days`,
  ];
  const text = [
    ...DIRECTIVE_LINES,
    "",
    "name: ci",
    "on:",
    "  push:",
    "    branches: [main] # narrative trailing on a key",
    "env:",
    '  URL: "https://example.dev/#frag # not a comment"',
    "  ISSUE: 'see #42'",
    ...Array.from({ length: 20 }, (_, i) => `  VAR_${i}: ${i}`),
    "",
    ...narrative,
    "",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      # narrative indented whole-line comment before a step",
    "      - run: |",
    "          # hash line in a literal block is data",
    '          echo "# still text"',
    "      - uses: actions/checkout@v4 # renovate: datasource=github-tags",
    "---",
    "# narrative comment in the second document",
    "extra: 1",
    "",
  ].join("\n");
  return { text, narrative };
}

describe("AC-YAML-GUARD: guard Write of over-budget .yaml strips narrative, keeps directives and data", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ac-yaml-guard-"));
  const yPath = path.join(tmpDir, "ci.yaml");
  const { text, narrative } = buildYaml("guard");

  it("exit 0; updatedInput.content: narrative gone, directives + hazards kept, data identical", async () => {
    await assertParsesClean(text, "input fixture");

    const { stdout, exit } = await spawnGuard(
      { tool_name: "Write", tool_input: { file_path: yPath, content: text } },
      tmpDir,
    );
    expect(exit).toBe(0);

    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("permissionDecision");
    const hso = parsed.hookSpecificOutput as Record<string, unknown>;
    expect(hso).toHaveProperty("updatedInput");
    const updated = (hso.updatedInput as Record<string, unknown>).content as string;

    await assertParsesClean(updated, "guard updatedInput.content");

    for (const line of narrative) expect(updated).not.toContain(line);
    expectProseWithinBudget(updated);

    const lines = updated.split("\n");
    for (const d of DIRECTIVE_LINES) expect(lines).toContain(d);
    expect(updated).toContain("# renovate: datasource=github-tags");
    expect(lines).toContain('  URL: "https://example.dev/#frag # not a comment"');
    expect(lines).toContain("  ISSUE: 'see #42'");
    expect(lines).toContain("          # hash line in a literal block is data");
    expect(lines.some((l) => /^ {4}branches: \[main\](?: # narrative trailing on a key)?$/.test(l))).toBe(true);
    expect(lines.filter((l) => l === "---")).toHaveLength(1);
    expect(lines.filter((l) => /[ \t]+$/.test(l))).toEqual([]);

    sameData(text, updated);

    expect(hso.additionalContext as string).toContain("not another session's edit");
  });
});

describe("AC-YAML-GATE: gate Stop autofix of over-budget .yaml fixes file on disk", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ac-yaml-gate-"));
  const yPath = path.join(tmpDir, "pipeline.yaml");
  const { text, narrative } = buildYaml("gate");

  it("gate removes narrative from disk; directives + data survive; stdout reports auto-removed", async () => {
    await assertParsesClean(text, "gate input fixture");

    initGitRepo(tmpDir);
    writeFileSync(path.join(tmpDir, ".gitkeep"), "");
    gitCommit(tmpDir, "initial");

    writeFileSync(yPath, text);
    const ts = new Date(Date.now() - 10000).toISOString();
    const tp = makeTranscript(tmpDir, [yPath], ts);

    const r = spawnGate({
      hook_event_name: "Stop",
      session_id: `ac-yaml-gate-${Date.now()}`,
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
    expect(ctx).toContain("pipeline.yaml");

    const disk = readFileSync(yPath, "utf8");
    await assertParsesClean(disk, "gate disk result");

    for (const line of narrative) expect(disk).not.toContain(line);
    expectProseWithinBudget(disk);

    const lines = disk.split("\n");
    for (const d of DIRECTIVE_LINES) expect(lines).toContain(d);
    expect(disk).toContain("# renovate: datasource=github-tags");
    expect(lines).toContain('  URL: "https://example.dev/#frag # not a comment"');
    expect(lines).toContain("          # hash line in a literal block is data");
    expect(lines.filter((l) => /[ \t]+$/.test(l))).toEqual([]);

    sameData(text, disk);
  });
});
