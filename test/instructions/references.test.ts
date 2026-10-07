import { describe, it, expect } from "bun:test";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(import.meta.dir, "../..");

function resolveMpSkillsRoot(): string | null {
  const cacheDir = path.join(os.homedir(), ".claude", "plugins", "cache", "mattpocock", "mattpocock-skills");
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
  ? `mattpocock-skills not found under ${path.join(os.homedir(), ".claude/plugins/cache/mattpocock/mattpocock-skills")}`
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

function gwResolves(name: string): boolean {
  return (
    existsSync(path.join(ROOT, "agents", `${name}.md`)) ||
    existsSync(path.join(ROOT, "skills", name, "SKILL.md"))
  );
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

  it("groundwork:vertical-slice resolves to a plugin skill", () => {
    expect(gwResolves("vertical-slice")).toBe(true);
  });

  it("groundwork:nope does not resolve", () => {
    expect(gwResolves("nope")).toBe(false);
  });

  for (const file of allFiles) {
    const rel = path.relative(ROOT, file);
    const content = readFileSync(file, "utf8");
    const { groundwork, mattpocock } = extractRefs(content);

    for (const name of groundwork) {
      it(`${rel}: groundwork:${name} agent or skill exists`, () => {
        expect(gwResolves(name)).toBe(true);
      });
    }

    for (const name of mattpocock) {
      it.skipIf(MP_SKIP_REASON !== null)(`${rel}: mattpocock-skills:${name} skill exists`, () => {
        expect(mpSkillExists(name)).toBe(true);
      });
    }
  }
});

function extractSkillToolRefs(content: string): string[] {
  const re = /skill tool with `([^`]+)`/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) out.push(m[1]);
  return out;
}

function skillRefProblem(ref: string, mpExists: (n: string) => boolean = mpSkillExists): string | null {
  const m = /^([a-z][a-z0-9-]*):([a-z][a-z0-9-]*)$/.exec(ref);
  if (!m) return `"${ref}" lacks a plugin: prefix`;
  if (m[1] === "groundwork") return gwResolves(m[2]) ? null : `"${ref}" does not resolve`;
  if (m[1] === "mattpocock-skills") return mpExists(m[2]) ? null : `"${ref}" not in mattpocock cache`;
  return `"${ref}" has unknown plugin`;
}

describe("references — Skill tool phrases name a resolvable plugin:skill", () => {
  it("extractor sees PRESENT phrases, case-insensitive", () => {
    expect(extractSkillToolRefs("(call the Skill tool with `vertical-slice`) Call the Skill tool with `groundwork:nope`"))
      .toEqual(["vertical-slice", "groundwork:nope"]);
    expect(extractSkillToolRefs("no phrase here")).toEqual([]);
  });

  it("bare vertical-slice fails", () => {
    expect(skillRefProblem("vertical-slice")).toContain("prefix");
  });

  it("groundwork:nope fails", () => {
    expect(skillRefProblem("groundwork:nope")).toContain("does not resolve");
  });

  it("groundwork:vertical-slice passes", () => {
    expect(skillRefProblem("groundwork:vertical-slice")).toBeNull();
  });

  it("mattpocock-skills ref resolved through injected lookup", () => {
    expect(skillRefProblem("mattpocock-skills:tdd", n => n === "tdd")).toBeNull();
    expect(skillRefProblem("mattpocock-skills:zzz", () => false)).toContain("not in mattpocock cache");
  });

  const files = [
    ...collectFiles(path.join(ROOT, "skills"), "SKILL.md"),
    ...collectFiles(path.join(ROOT, "agents"), ".md"),
    ...collectFiles(path.join(ROOT, "rules"), ".md"),
  ];
  const found: { rel: string; ref: string }[] = [];
  for (const f of files) {
    for (const ref of extractSkillToolRefs(readFileSync(f, "utf8"))) found.push({ rel: path.relative(ROOT, f), ref });
  }

  it("scan finds phrases in the real tree, including rules/routing.md", () => {
    expect(found.length).toBeGreaterThan(0);
    expect(found.some(x => x.rel === "rules/routing.md")).toBe(true);
  });

  for (const { rel, ref } of found) {
    const isMp = ref.startsWith("mattpocock-skills:");
    it.skipIf(isMp && MP_SKIP_REASON !== null)(`${rel}: Skill tool with ${ref} resolves`, () => {
      expect(skillRefProblem(ref)).toBeNull();
    });
  }
});
