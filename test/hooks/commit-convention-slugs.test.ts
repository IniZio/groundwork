import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { lintMessage } from "../../hooks/lib/commit-convention.mjs";
import { renderCommitMsgHook } from "../../hooks/lib/commit-msg-template.mjs";
import { check } from "../../src/hooks/commit-message-guard.js";

const GW_HOOKS_LIB = join(import.meta.dir, "../../hooks/lib");

function makeTempRepo(opts: {
  motiveSlugs?: string[];
  marketplaceJson?: string | null;
}): string {
  const root = mkdtempSync(join(tmpdir(), "cc-slugs-"));
  for (const slug of opts.motiveSlugs ?? []) {
    mkdirSync(join(root, ".groundwork", "motives", slug), { recursive: true });
  }
  if (opts.marketplaceJson !== undefined && opts.marketplaceJson !== null) {
    mkdirSync(join(root, ".claude-plugin"), { recursive: true });
    writeFileSync(join(root, ".claude-plugin", "marketplace.json"), opts.marketplaceJson);
  }
  return root;
}

function makeGitRepo(opts: {
  motiveSlugs?: string[];
  marketplaceJson?: string;
}): string {
  const root = mkdtempSync(join(tmpdir(), "cc-hook-"));
  spawnSync("git", ["init", "--initial-branch=main"], { cwd: root, encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "test@test.com"], { cwd: root, encoding: "utf8" });
  spawnSync("git", ["config", "user.name", "Test"], { cwd: root, encoding: "utf8" });
  writeFileSync(join(root, ".house-rules.json"), JSON.stringify({ "commit-message": { preset: "conventional" } }));
  for (const slug of opts.motiveSlugs ?? []) {
    mkdirSync(join(root, ".groundwork", "motives", slug), { recursive: true });
  }
  if (opts.marketplaceJson !== undefined) {
    mkdirSync(join(root, ".claude-plugin"), { recursive: true });
    writeFileSync(join(root, ".claude-plugin", "marketplace.json"), opts.marketplaceJson);
  }
  const hookContent = renderCommitMsgHook({ hooksLibPath: GW_HOOKS_LIB, version: "0.0.0" });
  mkdirSync(join(root, ".git", "hooks"), { recursive: true });
  const hookPath = join(root, ".git", "hooks", "commit-msg");
  writeFileSync(hookPath, hookContent);
  chmodSync(hookPath, 0o755);
  return root;
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const d of tempDirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ── Direct lintMessage tests (array-format fixture) ────────────────────────

describe("commit-convention — marketplace plugin slug exclusion", () => {
  it("feat(house-rules): add rule passes when motives/house-rules exists AND marketplace lists house-rules", () => {
    const root = makeTempRepo({
      motiveSlugs: ["house-rules"],
      marketplaceJson: JSON.stringify([{ name: "house-rules" }]),
    });
    tempDirs.push(root);
    const { violations } = lintMessage("feat(house-rules): add rule", { repoRoot: root });
    const slugViolations = violations.filter((v) =>
      v.reason.includes('contains motive slug "house-rules"')
    );
    expect(slugViolations).toHaveLength(0);
  });

  it("non-plugin slug graph-pilot in subject is still rejected with existing message text", () => {
    const root = makeTempRepo({
      motiveSlugs: ["house-rules", "graph-pilot"],
      marketplaceJson: JSON.stringify([{ name: "house-rules" }]),
    });
    tempDirs.push(root);
    const { violations } = lintMessage("feat(auth): improve graph-pilot integration", { repoRoot: root });
    const slugViolations = violations.filter((v) =>
      v.reason.includes('contains motive slug "graph-pilot"')
    );
    expect(slugViolations.length).toBeGreaterThan(0);
    expect(slugViolations[0].reason).toContain("process vocabulary not for commit messages");
  });

  it("no marketplace.json → house-rules slug is rejected (fallback)", () => {
    const root = makeTempRepo({
      motiveSlugs: ["house-rules"],
      marketplaceJson: null,
    });
    tempDirs.push(root);
    const { violations } = lintMessage("feat(house-rules): add rule", { repoRoot: root });
    const slugViolations = violations.filter((v) =>
      v.reason.includes('contains motive slug "house-rules"')
    );
    expect(slugViolations.length).toBeGreaterThan(0);
  });

  it("malformed marketplace.json → same fallback, no throw", () => {
    const root = makeTempRepo({
      motiveSlugs: ["house-rules"],
      marketplaceJson: "THIS IS NOT JSON {{{",
    });
    tempDirs.push(root);
    let result: ReturnType<typeof lintMessage> | undefined;
    expect(() => {
      result = lintMessage("feat(house-rules): add rule", { repoRoot: root });
    }).not.toThrow();
    const slugViolations = (result?.violations ?? []).filter((v) =>
      v.reason.includes('contains motive slug "house-rules"')
    );
    expect(slugViolations.length).toBeGreaterThan(0);
  });
});

// ── Direct lintMessage tests (object-format fixture — real marketplace.json shape) ──

describe("commit-convention — object-format marketplace.json (real file format)", () => {
  it("feat(house-rules): add rule passes when marketplace.json is {plugins:[{name}]} listing house-rules", () => {
    const root = makeTempRepo({
      motiveSlugs: ["house-rules"],
      marketplaceJson: JSON.stringify({ plugins: [{ name: "house-rules" }] }),
    });
    tempDirs.push(root);
    const { violations } = lintMessage("feat(house-rules): add rule", { repoRoot: root });
    const slugViolations = violations.filter((v) =>
      v.reason.includes('contains motive slug "house-rules"')
    );
    expect(slugViolations).toHaveLength(0);
  });

  it("non-plugin slug graph-pilot still rejected when marketplace has object format", () => {
    const root = makeTempRepo({
      motiveSlugs: ["house-rules", "graph-pilot"],
      marketplaceJson: JSON.stringify({ plugins: [{ name: "house-rules" }] }),
    });
    tempDirs.push(root);
    const { violations } = lintMessage("feat: tune graph-pilot flow", { repoRoot: root });
    const slugViolations = violations.filter((v) =>
      v.reason.includes('contains motive slug "graph-pilot"')
    );
    expect(slugViolations.length).toBeGreaterThan(0);
  });
});

// ── Spawned commit-msg hook (real deployment path) ─────────────────────────

describe("commit-convention — spawned commit-msg hook (real deployment path)", () => {
  it("feat(house-rules): add rule exits 0 when motives/house-rules exists and marketplace lists house-rules", () => {
    const root = makeGitRepo({
      motiveSlugs: ["house-rules"],
      marketplaceJson: JSON.stringify({ plugins: [{ name: "house-rules" }] }),
    });
    tempDirs.push(root);
    const msgFile = join(root, "msg.txt");
    writeFileSync(msgFile, "feat(house-rules): add rule\n");
    const hookPath = join(root, ".git", "hooks", "commit-msg");
    const result = spawnSync(hookPath, [msgFile], { cwd: root, encoding: "utf8" });
    expect(result.status).toBe(0);
  });

  it("feat: tune graph-pilot integration exits 1 — graph-pilot is a non-plugin slug", () => {
    const root = makeGitRepo({
      motiveSlugs: ["house-rules", "graph-pilot"],
      marketplaceJson: JSON.stringify({ plugins: [{ name: "house-rules" }] }),
    });
    tempDirs.push(root);
    const msgFile = join(root, "msg.txt");
    writeFileSync(msgFile, "feat: tune graph-pilot integration\n");
    const hookPath = join(root, ".git", "hooks", "commit-msg");
    const result = spawnSync(hookPath, [msgFile], { cwd: root, encoding: "utf8" });
    expect(result.status).toBe(1);
  });
});

// ── PreToolUse guard (check()) with marketplace plugin exclusion ───────────

describe("commit-convention — PreToolUse guard (check()) with marketplace plugin exclusion", () => {
  function bashTool(command: string, cwd: string) {
    return { tool_name: "Bash", tool_input: { command, cwd } };
  }

  it("feat(house-rules): add rule is allowed when marketplace lists house-rules in the cwd repo", () => {
    const root = makeGitRepo({
      motiveSlugs: ["house-rules"],
      marketplaceJson: JSON.stringify({ plugins: [{ name: "house-rules" }] }),
    });
    tempDirs.push(root);
    const result = check(bashTool('git commit -m "feat(house-rules): add rule"', root));
    expect(result.stdout).toBe("");
    expect(result.exit).toBe(0);
  });

  it("feat: tune graph-pilot integration is denied when graph-pilot is a motive but not a plugin", () => {
    const root = makeGitRepo({
      motiveSlugs: ["house-rules", "graph-pilot"],
      marketplaceJson: JSON.stringify({ plugins: [{ name: "house-rules" }] }),
    });
    tempDirs.push(root);
    const result = check(bashTool('git commit -m "feat: tune graph-pilot integration"', root));
    const out = JSON.parse(result.stdout.trim()) as { hookSpecificOutput: { permissionDecision: string } };
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
  });
});
