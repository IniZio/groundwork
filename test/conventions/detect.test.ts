import { describe, it, expect, afterEach } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { detect } from "../../src/conventions/detect.js";

const TMP = "/tmp/gw-detect-test";
mkdirSync(TMP, { recursive: true });
const repos: string[] = [];

function makeFixtureRepo(label: string): string {
  const dir = path.join(TMP, `${label}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  execSync("git init", { cwd: dir });
  execSync('git config user.email "test@test.com"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  repos.push(dir);
  return dir;
}

function hashTree(dir: string): Map<string, string> {
  const result = new Map<string, string>();
  function walk(d: string) {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      result.set(path.relative(dir, full), readFileSync(full).toString("base64"));
    }
  }
  walk(dir);
  return result;
}

afterEach(() => {
  for (const r of repos) { try { rmSync(r, { recursive: true, force: true }); } catch { /* ok */ } }
  repos.length = 0;
});

describe("detect", () => {
  it("returns findings array without writing any files", () => {
    const repo = makeFixtureRepo("basic");
    mkdirSync(path.join(repo, "src"), { recursive: true });
    writeFileSync(path.join(repo, "src/index.ts"), 'export const x = 1;\n');
    execSync("git add -A && git commit -m 'feat: init'", { cwd: repo, shell: "/bin/bash" });

    const before = hashTree(repo);
    const findings = detect(repo);
    const after = hashTree(repo);

    expect(Array.isArray(findings)).toBe(true);
    expect(findings.length).toBeGreaterThan(0);

    for (const [k, v] of after) {
      expect(before.get(k)).toBe(v);
    }
    for (const [k] of before) {
      expect(after.has(k)).toBe(true);
    }
  });

  it("detects conventional commit style when majority of commits use it", () => {
    const repo = makeFixtureRepo("cc");
    writeFileSync(path.join(repo, "a.txt"), "a");
    execSync("git add -A && git commit -m 'feat: initial'", { cwd: repo, shell: "/bin/bash" });
    writeFileSync(path.join(repo, "b.txt"), "b");
    execSync("git add -A && git commit -m 'fix: bug'", { cwd: repo, shell: "/bin/bash" });

    const findings = detect(repo);
    const commitFinding = findings.find(f => f.id === "commit-conventional");
    expect(commitFinding).toBeDefined();
    expect(commitFinding!.proposed_write?.path).toBe(".gitmessage");
    expect(commitFinding!.proposed_write?.content).toContain("<type>");
  });

  it("detects code-rules when TypeScript files present", () => {
    const repo = makeFixtureRepo("ts");
    mkdirSync(path.join(repo, "src"), { recursive: true });
    writeFileSync(path.join(repo, "src/x.ts"), "export const x = 1;\n");
    execSync("git add -A && git commit -m 'chore: add ts'", { cwd: repo, shell: "/bin/bash" });

    const findings = detect(repo);
    const rulesFinding = findings.find(f => f.id === "code-rules");
    expect(rulesFinding).toBeDefined();
    expect(rulesFinding!.proposed_write?.path).toBe("Makefile");
    expect(rulesFinding!.proposed_write?.content).toContain("# groundwork-rule: no-console-log");
    expect(rulesFinding!.proposed_write?.content).toContain("# groundwork-rule: no-ts-any");
  });
});
