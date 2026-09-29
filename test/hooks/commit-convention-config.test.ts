import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { lintMessage } from "../../hooks/lib/commit-convention.mjs";

const roots: string[] = [];

function git(root: string, ...args: string[]) {
  spawnSync("git", args, { cwd: root, encoding: "utf8" });
}

function makeRepo(opts: { files?: Record<string, string>; subjects?: string[] } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "cc-config-"));
  roots.push(root);
  git(root, "init", "--initial-branch=main");
  git(root, "config", "user.email", "test@test.com");
  git(root, "config", "user.name", "Test");
  git(root, "config", "commit.gpgsign", "false");
  for (const [name, content] of Object.entries(opts.files ?? {})) {
    writeFileSync(join(root, name), content);
  }
  for (const s of opts.subjects ?? []) {
    git(root, "commit", "--allow-empty", "-m", s);
  }
  return root;
}

const explicit = (preset: string) =>
  JSON.stringify({ rules: { "commit-message": ["error", { preset }] } });

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("lintMessage config resolution", () => {
  it("explicit conventional beats .gitmessage", () => {
    const root = makeRepo({
      files: { ".house-rules.json": explicit("conventional"), ".gitmessage": "\n" },
    });
    const r = lintMessage("Add thing", { repoRoot: root, motiveSlugs: [] });
    expect(r.violations.length).toBeGreaterThan(0);
    expect(r.pointer).toContain("source: explicit");
    expect(r.pointer).toContain("active: conventional");
  });

  it(".gitmessage only is subject-only: any subject passes, body fails", () => {
    const root = makeRepo({ files: { ".gitmessage": "\n" } });
    const ok = lintMessage("anything goes here", { repoRoot: root, motiveSlugs: [] });
    expect(ok.violations).toEqual([]);
    const bad = lintMessage("anything goes here\n\nbody content here", { repoRoot: root, motiveSlugs: [] });
    expect(bad.violations.length).toBeGreaterThan(0);
    expect(bad.pointer).toBe('rules["commit-message"].preset (active: subject-only, source: gitmessage)');
  });

  it("config without commit-message key falls through to history", () => {
    const subjects: string[] = [];
    for (let i = 0; i < 12; i++) subjects.push(`feat: change ${i}`);
    for (let i = 0; i < 8; i++) subjects.push(`Change number ${i}`);
    const root = makeRepo({
      files: { ".house-rules.json": JSON.stringify({ rules: { "comment-density": ["error"] } }) },
      subjects,
    });
    const r = lintMessage("Add thing", { repoRoot: root, motiveSlugs: [] });
    expect(r.violations.length).toBeGreaterThan(0);
    expect(r.pointer).toBe('rules["commit-message"].preset (active: conventional, source: history)');
  });

  it("invalid preset yields exactly one ConfigError violation, no fallback", () => {
    const root = makeRepo({ files: { ".house-rules.json": explicit("bogus") } });
    const r = lintMessage("Add thing", { repoRoot: root, motiveSlugs: [] });
    expect(r.violations.length).toBe(1);
    const reason: string = r.violations[0].reason;
    expect(reason).toContain('rules["commit-message"][1].preset');
    expect(reason).toContain(".house-rules.json");
    expect(reason).toContain("allowed: handbook, conventional, subject-only");
  });

  it("explicit conventional pointer string is exact", () => {
    const root = makeRepo({ files: { ".house-rules.json": explicit("conventional") } });
    const r = lintMessage("Add thing", { repoRoot: root, motiveSlugs: [] });
    expect(r.pointer).toBe('rules["commit-message"].preset (active: conventional, source: explicit)');
  });

  it("passing message has no pointer property", () => {
    const root = makeRepo({ files: { ".house-rules.json": explicit("conventional") } });
    const r = lintMessage("feat(x): add thing", { repoRoot: root, motiveSlugs: [] });
    expect(r.violations).toEqual([]);
    expect("pointer" in r).toBe(false);
  });

  it("null repoRoot uses handbook", () => {
    const bad = lintMessage("feat: x", { repoRoot: null, motiveSlugs: [] });
    expect(bad.violations.length).toBeGreaterThan(0);
    const ok = lintMessage("Add thing", { repoRoot: null, motiveSlugs: [] });
    expect(ok.violations).toEqual([]);
  });
});
