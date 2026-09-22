/**
 * Convention detector — scans a repo and prints findings JSON.
 * WRITES NOTHING to the repo. All proposals are in `proposed_write` only.
 * Usage: bun src/conventions/detect.ts <repo> [--pretty]
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface Finding {
  id: string;
  kind: string;
  evidence: string;
  proposed_write?: { path: string; content: string };
  fallback?: boolean;
}

function git(repo: string, cmd: string): string {
  try { return execSync(cmd, { cwd: repo, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }); }
  catch { return ""; }
}

function hasFiles(repo: string, exts: string[]): boolean {
  try {
    const out = execSync(
      `find . -type f \\( ${exts.map(e => `-name "*.${e}"`).join(" -o ")} \\) -not -path "./.git/*" -not -path "./node_modules/*" 2>/dev/null | head -1`,
      { cwd: repo, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    );
    return out.trim().length > 0;
  } catch { return false; }
}

function detectCommitStyle(repo: string): Finding | null {
  const log = git(repo, "git log --oneline -20 2>/dev/null");
  const lines = log.trim().split("\n").filter(l => l.trim());
  if (!lines.length) return null;
  const conventionalRe = /^[a-f0-9]+ (feat|fix|chore|docs|test|refactor|style|perf|ci|build|revert)(\(.+\))?:/;
  const matches = lines.filter(l => conventionalRe.test(l)).length;
  if (matches / lines.length >= 0.5) {
    const existing = existsSync(path.join(repo, ".gitmessage")) ? readFileSync(path.join(repo, ".gitmessage"), "utf8") : "";
    if (existing.includes("<type>")) return null; // already written
    return {
      id: "commit-conventional",
      kind: "commit-style",
      evidence: `${matches}/${lines.length} commits use conventional-commit format`,
      proposed_write: {
        path: ".gitmessage",
        content: "<type>(<scope>): <subject>\n\n[body]\n\n[footer]\n"
      }
    };
  }
  return null;
}

function detectPrTemplate(repo: string): Finding | null {
  const target = ".github/pull_request_template.md";
  if (existsSync(path.join(repo, target))) return null;
  return {
    id: "pr-template",
    kind: "pr-template",
    evidence: "No pull_request_template.md found",
    proposed_write: {
      path: target,
      content: "## Summary\n\n## Test plan\n\n## Checklist\n- [ ] Tests pass\n- [ ] Docs updated\n"
    }
  };
}

function detectMakefileTargets(repo: string): Finding | null {
  if (existsSync(path.join(repo, "Makefile"))) return null;
  return {
    id: "makefile-targets",
    kind: "makefile",
    evidence: "No Makefile found",
    proposed_write: {
      path: "Makefile",
      content: ".PHONY: test lint\ntest:\n\tbun test\nlint:\n\tbunx tsc --noEmit\n"
    }
  };
}

function detectFormatterConfig(repo: string): Finding | null {
  const configs = [".prettierrc", ".prettierrc.json", "biome.json", ".editorconfig"];
  const found = configs.find(c => existsSync(path.join(repo, c)));
  if (found) return null;
  return { id: "no-formatter-config", kind: "formatter-config", evidence: "No formatter/editor config found" };
}

function detectTestLayout(repo: string): Finding | null {
  const testDirs = ["test", "tests", "__tests__", "spec"];
  const found = testDirs.find(d => existsSync(path.join(repo, d)));
  if (found) return null;
  return {
    id: "test-layout",
    kind: "test-layout",
    evidence: "No test directory found",
    proposed_write: undefined
  };
}

function detectCodeRules(repo: string): Finding[] {
  const hasTs = hasFiles(repo, ["ts", "tsx"]);
  const hasJs = hasFiles(repo, ["js", "jsx", "mjs", "cjs"]);
  if (!hasTs && !hasJs) return [];
  const makePath = path.join(repo, "Makefile");
  const existing = existsSync(makePath) ? readFileSync(makePath, "utf8") : "";
  if (existing.includes("# groundwork-rule: no-console-log")) return [];
  const appended = existing.trimEnd() + "\n# groundwork-rule: no-console-log\n# groundwork-rule: no-ts-any\n";
  return [{
    id: "code-rules",
    kind: "code-rule",
    evidence: `${hasTs ? "TypeScript" : "JavaScript"} files detected; no groundwork rules in Makefile`,
    proposed_write: { path: "Makefile", content: appended }
  }];
}

export function detect(repo: string): Finding[] {
  const abs = path.resolve(repo);
  const findings: Finding[] = [];
  const commit = detectCommitStyle(abs);
  if (commit) findings.push(commit);
  const pr = detectPrTemplate(abs);
  if (pr) findings.push(pr);
  const make = detectMakefileTargets(abs);
  if (make) findings.push(make);
  const fmt = detectFormatterConfig(abs);
  if (fmt) findings.push(fmt);
  const test = detectTestLayout(abs);
  if (test) findings.push(test);
  findings.push(...detectCodeRules(abs));
  return findings;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const pretty = args.includes("--pretty");
  const repo = args.find(a => !a.startsWith("--")) ?? ".";
  const findings = detect(repo);
  const out = pretty ? JSON.stringify(findings, null, 2) : JSON.stringify(findings);
  process.stdout.write(out + "\n");
}
