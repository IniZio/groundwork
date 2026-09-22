import { describe, it, expect } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");

interface Violation { rule: string; line: number; text: string }

const FILLER_OPENERS = /^(In order to|Please note|It is important to|Note that|It should be noted)/i;
const HEDGE_PHRASES = /\b(you might want to|consider doing|it may be worth|might want to)\b/i;
const MAX_LINE_CHARS = 140;

function articlesPerHundredWords(line: string): number {
  const words = line.trim().split(/\s+/).filter(Boolean);
  if (words.length < 10) return 0;
  const articles = words.filter(w => /^(the|a|an)$/i.test(w.replace(/[^a-zA-Z]/g, ""))).length;
  return (articles / words.length) * 100;
}

export function checkAuthoringRules(content: string): Violation[] {
  const violations: Violation[] = [];
  const lines = content.split("\n");
  let inFrontmatter = false;
  let frontmatterDone = false;
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    const lineNo = i + 1;

    if (i === 0 && text.trim() === "---") { inFrontmatter = true; continue; }
    if (inFrontmatter) {
      if (text.trim() === "---") { inFrontmatter = false; frontmatterDone = true; }
      continue;
    }
    if (text.trim().startsWith("```")) { inCodeBlock = !inCodeBlock; continue; }
    if (inCodeBlock) continue;

    const stripped = text.replace(/^\s*[-*>|`#]+\s*/, "").trim();
    if (FILLER_OPENERS.test(stripped)) {
      violations.push({ rule: "filler-opener", line: lineNo, text });
    }
    const hedgeText = text.replace(/\([^)]*\)/g, "");
    if (HEDGE_PHRASES.test(hedgeText)) {
      violations.push({ rule: "hedge-phrase", line: lineNo, text });
    }
    if (text.length > MAX_LINE_CHARS) {
      violations.push({ rule: "line-too-long", line: lineNo, text: text.slice(0, 80) + "…" });
    }
    if (articlesPerHundredWords(text) > 20) {
      violations.push({ rule: "article-dense", line: lineNo, text });
    }
  }
  void frontmatterDone;
  return violations;
}

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

describe("authoring-rules — fixture violations", () => {
  const FILLER_FIXTURE = "In order to use the system, you must first initialize it.";
  const HEDGE_FIXTURE = "You might want to consider doing this step carefully.";
  const LONG_FIXTURE = "a".repeat(141);
  const ARTICLE_FIXTURE = "The the a an the a an the a an the a an the process requires the configuration of the system.";

  it("detects filler-opener", () => {
    const v = checkAuthoringRules(FILLER_FIXTURE);
    expect(v.some(x => x.rule === "filler-opener")).toBe(true);
  });

  it("detects hedge-phrase", () => {
    const v = checkAuthoringRules(HEDGE_FIXTURE);
    expect(v.some(x => x.rule === "hedge-phrase")).toBe(true);
  });

  it("detects line-too-long", () => {
    const v = checkAuthoringRules(LONG_FIXTURE);
    expect(v.some(x => x.rule === "line-too-long")).toBe(true);
  });

  it("detects article-dense", () => {
    const v = checkAuthoringRules(ARTICLE_FIXTURE);
    expect(v.some(x => x.rule === "article-dense")).toBe(true);
  });

  it("clean text passes all rules", () => {
    const clean = "Run `gw init` to create work store. Capture write token T.";
    const v = checkAuthoringRules(clean);
    expect(v).toHaveLength(0);
  });
});

describe("authoring-rules — shipped agent and skill files", () => {
  const agentsDir = path.join(ROOT, "agents");
  const skillsDir = path.join(ROOT, "skills");

  const agentFiles = collectFiles(agentsDir, ".md");
  const skillFiles = collectFiles(skillsDir, "SKILL.md");
  const allFiles = [...agentFiles, ...skillFiles];

  it("shipped file set is non-empty", () => {
    expect(allFiles.length).toBeGreaterThan(0);
  });

  for (const file of allFiles) {
    const rel = path.relative(ROOT, file);
    it(`${rel} passes authoring rules`, () => {
      const content = readFileSync(file, "utf8");
      const violations = checkAuthoringRules(content);
      if (violations.length > 0) {
        const msg = violations.map(v => `  line ${v.line} [${v.rule}]: ${v.text.slice(0, 80)}`).join("\n");
        expect.assertions(1);
        expect(violations, `Violations in ${rel}:\n${msg}`).toHaveLength(0);
      }
    });
  }
});
