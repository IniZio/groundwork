/**
 * Family: Best-practice enforcement on new code only.
 * Trigger: Stop + SubagentStop.
 * "New code" = added lines in `git diff HEAD` plus all lines of untracked files.
 * Reads active rules from Makefile (# groundwork-rule: <name>). No rule → no block.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export interface HookResult { stdout: string; stderr: string; exit: number }

function block(reason: string): HookResult {
  return { stdout: JSON.stringify({ decision: "block", reason }) + "\n", stderr: "", exit: 0 };
}
function allow(): HookResult { return { stdout: JSON.stringify({ continue: true }) + "\n", stderr: "", exit: 0 }; }

interface Violation { rule: string; file: string; line: number; text: string }

const RULES: Record<string, (file: string, lineText: string) => boolean> = {
  "no-console-log": (_f, t) => t.includes("console.log("),
  "no-ts-any": (f, t) => (f.endsWith(".ts") || f.endsWith(".tsx")) && (/(:\s*any\b)|(as\s+any\b)/.test(t)),
};

function readActiveRules(repo: string): Set<string> {
  const makefile = path.join(repo, "Makefile");
  if (!existsSync(makefile)) return new Set();
  const lines = readFileSync(makefile, "utf8").split("\n");
  const active = new Set<string>();
  for (const l of lines) {
    const m = l.match(/^#\s*groundwork-rule:\s*(\S+)/);
    if (m) active.add(m[1]);
  }
  return active;
}

interface AddedLine { file: string; lineNo: number; text: string }

function parseDiff(diffOutput: string): AddedLine[] {
  const result: AddedLine[] = [];
  let currentFile = "";
  let newLineNo = 0;
  for (const raw of diffOutput.split("\n")) {
    if (raw.startsWith("+++ ") && !raw.includes("/dev/null")) {
      currentFile = raw.slice(4);
      continue;
    }
    const hunkMatch = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) { newLineNo = parseInt(hunkMatch[1], 10) - 1; continue; }
    if (raw.startsWith("---") || raw.startsWith("diff ") || raw.startsWith("index ")) continue;
    if (raw.startsWith("+")) {
      newLineNo++;
      result.push({ file: currentFile, lineNo: newLineNo, text: raw.slice(1) });
    } else if (!raw.startsWith("-")) {
      newLineNo++;
    }
  }
  return result;
}

function untrackedLines(repo: string): AddedLine[] {
  const result: AddedLine[] = [];
  let out = "";
  try { out = execSync("git ls-files --others --exclude-standard", { cwd: repo, encoding: "utf8" }); } catch { return result; }
  for (const rel of out.trim().split("\n").filter(Boolean)) {
    const abs = path.join(repo, rel);
    try {
      if (!statSync(abs).isFile()) continue;
      const lines = readFileSync(abs, "utf8").split("\n");
      lines.forEach((text, i) => result.push({ file: rel, lineNo: i + 1, text }));
    } catch { /* skip */ }
  }
  return result;
}

export function check(repo: string): Violation[] {
  const activeRules = readActiveRules(repo);
  if (activeRules.size === 0) return [];

  let diffOut = "";
  try { diffOut = execSync("git diff --no-prefix HEAD", { cwd: repo, encoding: "utf8" }); } catch { /* no repo or no HEAD */ }

  const added: AddedLine[] = [...parseDiff(diffOut), ...untrackedLines(repo)];
  const violations: Violation[] = [];

  for (const { file, lineNo, text } of added) {
    for (const rule of activeRules) {
      const fn = RULES[rule];
      if (fn && fn(file, text)) {
        violations.push({ rule, file, line: lineNo, text: text.trim() });
      }
    }
  }
  return violations;
}

export function run(input: unknown, env: Record<string, string | undefined>): HookResult {
  try {
    if (env.CLAUDE_CODE_ENTRYPOINT === "sdk-py" || env.CLAUDE_CODE_ENTRYPOINT === "sdk-js") return allow();
    const inp = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const cwd = typeof inp.cwd === "string" ? inp.cwd : (env.CLAUDE_PROJECT_DIR ?? process.cwd());
    const violations = check(cwd);
    if (violations.length === 0) return allow();
    const msg = violations.map(v => `new-code-gate: ${v.rule} ${v.file}:${v.line}`).join("; ");
    return block(msg);
  } catch { return allow(); }
}

if (import.meta.main) {
  const raw = await Bun.stdin.text();
  let input: unknown = {};
  try { input = JSON.parse(raw); } catch { /* fail-open */ }
  const result = run(input, process.env as Record<string, string | undefined>);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.exit);
}
