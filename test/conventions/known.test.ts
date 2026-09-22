import { describe, it, expect, afterEach } from "bun:test";
import { mkdirSync, existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { initKnown } from "../../src/conventions/known.js";
import { promote } from "../../src/conventions/promote.js";
import { addUnknown } from "../../src/conventions/unknown.js";

const TMP = "/tmp/gw-known-test";
mkdirSync(TMP, { recursive: true });
const repos: string[] = [];

function makeRepo(label: string): string {
  const dir = path.join(TMP, `${label}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  repos.push(dir);
  return dir;
}

afterEach(() => {
  for (const r of repos) { try { rmSync(r, { recursive: true, force: true }); } catch { /* ok */ } }
  repos.length = 0;
});

describe("initKnown — three D-4 artifacts created", () => {
  it("creates profile.md, skills/, unknowns.md on first run", () => {
    const repo = makeRepo("first");
    initKnown(repo);
    expect(existsSync(path.join(repo, ".groundwork/profile.md"))).toBe(true);
    expect(existsSync(path.join(repo, ".groundwork/skills"))).toBe(true);
    expect(existsSync(path.join(repo, ".groundwork/unknowns.md"))).toBe(true);
  });

  it("second run appends to profile.md, never truncates", () => {
    const repo = makeRepo("accrete");
    initKnown(repo);
    const after1 = readFileSync(path.join(repo, ".groundwork/profile.md"), "utf8");
    initKnown(repo);
    const after2 = readFileSync(path.join(repo, ".groundwork/profile.md"), "utf8");
    expect(after2.length).toBeGreaterThan(after1.length);
    expect(after2).toContain(after1.slice(0, 20));
  });
});

describe("promote — SKILL.md format", () => {
  it("writes SKILL.md with name and description frontmatter", () => {
    const repo = makeRepo("promote");
    mkdirSync(path.join(repo, ".groundwork/skills"), { recursive: true });
    const dest = promote(repo, { name: "my-skill", description: "Does a thing" });
    expect(existsSync(dest)).toBe(true);
    const content = readFileSync(dest, "utf8");
    expect(content).toContain("name: my-skill");
    expect(content).toContain('description: "Does a thing"');
    expect(content.startsWith("---\n")).toBe(true);
  });

  it("description containing colon is quoted correctly", () => {
    const repo = makeRepo("colon-desc");
    const dest = promote(repo, { name: "colon-skill", description: "Does: a thing" });
    const content = readFileSync(dest, "utf8");
    expect(content).toContain('description: "Does: a thing"');
  });

  it("rejects non-kebab-case names", () => {
    const repo = makeRepo("bad-name");
    expect(() => promote(repo, { name: "My Skill", description: "x" })).toThrow(/kebab-case/);
    expect(() => promote(repo, { name: "_bad", description: "x" })).toThrow(/kebab-case/);
  });

  it("places SKILL.md at .groundwork/skills/<name>/SKILL.md", () => {
    const repo = makeRepo("path-check");
    const dest = promote(repo, { name: "test-skill", description: "Test" });
    expect(dest).toBe(path.join(path.resolve(repo), ".groundwork", "skills", "test-skill", "SKILL.md"));
  });
});

describe("addUnknown", () => {
  it("appends question to unknowns.md", () => {
    const repo = makeRepo("unknown");
    addUnknown(repo, "why is X?");
    const content = readFileSync(path.join(repo, ".groundwork/unknowns.md"), "utf8");
    expect(content).toContain("why is X?");
  });

  it("second call appends without truncating", () => {
    const repo = makeRepo("unknown2");
    addUnknown(repo, "first question");
    addUnknown(repo, "second question");
    const content = readFileSync(path.join(repo, ".groundwork/unknowns.md"), "utf8");
    expect(content).toContain("first question");
    expect(content).toContain("second question");
  });
});
