import { describe, it, expect } from "bun:test";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(import.meta.dir, "../..");

function resolveMpSkillsRoot(): string | null {
  const cacheDir = path.join(os.homedir(), ".claude", "plugins", "cache", "claude-plugins-official", "mattpocock-skills");
  if (!statSync(cacheDir, { throwIfNoEntry: false })?.isDirectory()) return null;
  const versions = readdirSync(cacheDir).filter(v => /^\d+\.\d+\.\d+$/.test(v)).sort((a, b) => {
    const [am, an, ap] = a.split(".").map(Number);
    const [bm, bn, bp] = b.split(".").map(Number);
    return bm - am || bn - an || bp - ap;
  });
  if (versions.length === 0) return null;
  const candidate = path.join(cacheDir, versions[0], "skills");
  return statSync(candidate, { throwIfNoEntry: false })?.isDirectory() ? candidate : null;
}

const MP_SKILLS_ROOT = resolveMpSkillsRoot();
const MP_SKIP_REASON = MP_SKILLS_ROOT === null
  ? `mattpocock-skills not found under ${path.join(os.homedir(), ".claude/plugins/cache/claude-plugins-official/mattpocock-skills")}`
  : null;

function collectFiles(dir: string, ext: string): string[] {
  const results: string[] = [];
  if (!statSync(dir, { throwIfNoEntry: false })) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...collectFiles(full, ext));
    else if (entry.isFile() && entry.name.endsWith(ext)) results.push(full);
  }
  return results;
}

function mpSkillExists(name: string): boolean {
  if (!MP_SKILLS_ROOT) return false;
  const found = collectFiles(MP_SKILLS_ROOT, "SKILL.md");
  return found.some(f => path.dirname(f).endsWith("/" + name));
}

function extractRefs(content: string): { groundwork: string[]; mattpocock: string[] } {
  const groundwork: string[] = [];
  const mattpocock: string[] = [];
  const gwRe = /`groundwork:([a-z][a-z0-9-]*)`/g;
  const mpRe = /`mattpocock-skills:([a-z][a-z0-9-]*)`/g;
  let m: RegExpExecArray | null;
  while ((m = gwRe.exec(content)) !== null) groundwork.push(m[1]);
  while ((m = mpRe.exec(content)) !== null) mattpocock.push(m[1]);
  return { groundwork, mattpocock };
}

describe("references — all agent/skill cross-references resolve", () => {
  const agentFiles = collectFiles(path.join(ROOT, "agents"), ".md");
  const skillFiles = collectFiles(path.join(ROOT, "skills"), "SKILL.md");
  const allFiles = [...agentFiles, ...skillFiles];

  it("file set non-empty", () => {
    expect(allFiles.length).toBeGreaterThan(0);
  });

  for (const file of allFiles) {
    const rel = path.relative(ROOT, file);
    const content = readFileSync(file, "utf8");
    const { groundwork, mattpocock } = extractRefs(content);

    for (const name of groundwork) {
      it(`${rel}: groundwork:${name} agent exists`, () => {
        expect(existsSync(path.join(ROOT, "agents", `${name}.md`))).toBe(true);
      });
    }

    for (const name of mattpocock) {
      it.skipIf(MP_SKIP_REASON !== null)(`${rel}: mattpocock-skills:${name} skill exists`, () => {
        expect(mpSkillExists(name)).toBe(true);
      });
    }
  }
});
