/**
 * PreToolUse config guard — agents may pin or tighten .house-rules.json, never loosen it.
 * Trigger: Edit | Write | MultiEdit | Bash.
 */

import { readFileSync, existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { reconstructPostEdit, type EditInput } from "./lib/pending-edit.js";
import { resolveConfigText } from "../config/resolve.mjs";
import { detectPreset } from "../config/detect.mjs";

export interface HookResult { stdout: string; stderr: string; exit: number }

const CONFIG_NAME = ".house-rules.json";
const RULE_IDS = ["commit-message", "comment-density", "stray-artifacts"] as const;
const RANK: Record<string, number> = { off: 0, warn: 1, error: 2 };
const ASK = "Loosening house-rules config is a human decision. Ask the user to make this change.";

function allow(): HookResult { return { stdout: "", stderr: "", exit: 0 }; }

function deny(reason: string): HookResult {
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
        additionalContext: reason,
      },
    }) + "\n",
    stderr: "",
    exit: 0,
  };
}

function readText(file: string): string | null {
  try { return readFileSync(file, "utf8"); } catch { return null; }
}

function findRepoRoot(abs: string): string | null {
  let dir = path.dirname(abs);
  while (dir !== path.dirname(dir) && !existsSync(dir)) dir = path.dirname(dir);
  const r = spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

function isConfigTarget(abs: string, repoRoot: string): boolean {
  if (abs === path.join(repoRoot, CONFIG_NAME)) return true;
  try {
    const real = path.join(realpathSync(path.dirname(abs)), path.basename(abs));
    return real === path.join(realpathSync(repoRoot), CONFIG_NAME);
  } catch { return false; }
}

function findLoosenings(repoRoot: string, oldText: string | null, newText: string): string[] {
  let oldCfg;
  try { oldCfg = resolveConfigText(repoRoot, oldText); }
  catch { oldCfg = resolveConfigText(repoRoot, null); }
  const newCfg = resolveConfigText(repoRoot, newText);
  const out: string[] = [];
  for (const id of RULE_IDS) {
    const o = oldCfg.rules[id].severity;
    const n = newCfg.rules[id].severity;
    if (RANK[n] < RANK[o]) out.push(`  rules["${id}"]: ${o} → ${n}`);
  }
  const oMax = oldCfg.rules["comment-density"].options.max_per_100;
  const nMax = newCfg.rules["comment-density"].options.max_per_100;
  if (nMax > oMax) out.push(`  rules["comment-density"].max_per_100: ${oMax} → ${nMax}`);
  const oPre = oldCfg.rules["commit-message"].options.preset;
  const nPre = newCfg.rules["commit-message"].options.preset;
  if (nPre !== oPre && nPre !== detectPreset(repoRoot).value) {
    out.push(`  rules["commit-message"].preset: ${oPre} → ${nPre}`);
  }
  return out;
}

function checkEdit(tool: string, ti: Record<string, unknown>, cwd: string): HookResult {
  const filePath = typeof ti.file_path === "string" ? ti.file_path : "";
  if (!filePath || path.basename(filePath) !== CONFIG_NAME) return allow();
  const abs = path.resolve(cwd, filePath);
  const repoRoot = findRepoRoot(abs);
  if (!repoRoot || !isConfigTarget(abs, repoRoot)) return allow();

  const current = readText(abs);
  const recon = reconstructPostEdit(tool, ti as EditInput, current);
  if (!recon) return allow();

  try {
    const loose = findLoosenings(repoRoot, current, recon.post);
    if (loose.length === 0) return allow();
    return deny(
      "house-rules config-guard: this change loosens the effective house-rules config:\n" +
      loose.join("\n") + "\n" + ASK,
    );
  } catch (err) {
    if (err instanceof Error && err.name === "ConfigError") {
      return deny(
        `house-rules config-guard: the proposed ${CONFIG_NAME} is invalid — ${err.message}\n` +
        "Loosening or breaking house-rules config is a human decision. Ask the user to make this change.",
      );
    }
    return allow();
  }
}

const isCfg = (tok: string): boolean => tok.endsWith(CONFIG_NAME);
const WRITES_ANY = new Set(["tee", "rm", "mv", "truncate", "ln"]);
const GIT_MUTATORS = new Set(["checkout", "restore", "rm"]);

function segmentMutates(segment: string): boolean {
  const toks = segment.trim().split(/\s+/).map(t => t.replace(/^['"]|['"]$/g, "")).filter(Boolean);
  let i = 0;
  while (i < toks.length && (/^\w+=/.test(toks[i]) || toks[i] === "sudo")) i++;
  const cmd = path.basename(toks[i] ?? "");
  const args = toks.slice(i + 1);
  if (!args.some(isCfg) && !args.some(a => a.startsWith("of=") && isCfg(a))) return false;
  if (WRITES_ANY.has(cmd)) return true;
  if (cmd === "dd") return args.some(a => a.startsWith("of=") && isCfg(a));
  if (cmd === "git") return GIT_MUTATORS.has(args.find(a => !a.startsWith("-")) ?? "");
  if (cmd === "sed" || cmd === "perl") return args.some(a => /^-[a-zA-Z]*i|^--in-place/.test(a));
  if (cmd === "cp" || cmd === "install") {
    const paths = args.filter(a => !a.startsWith("-"));
    return isCfg(paths[paths.length - 1] ?? "");
  }
  return false;
}

// Best-effort only: shell syntax cannot be parsed fully, so obfuscated writes may slip through.
function checkBash(ti: Record<string, unknown>): HookResult {
  const command = typeof ti.command === "string" ? ti.command : "";
  if (!command.includes(CONFIG_NAME)) return allow();
  const redirects = />>?\s*['"]?\S*\.house-rules\.json/.test(command);
  if (!redirects && !command.split(/;|&&|\|\||\|/).some(segmentMutates)) return allow();
  return deny(
    `house-rules config-guard: this shell command would modify ${CONFIG_NAME}, which cannot be checked for loosening. ` +
    "Use Edit or Write to tighten or pin values. " + ASK,
  );
}

export function check(input: unknown): HookResult {
  try {
    const inp = (input ?? {}) as Record<string, unknown>;
    const tool = String(inp.tool_name ?? "").toLowerCase().replace(/^fast_/, "");
    const ti = (inp.tool_input ?? {}) as Record<string, unknown>;
    if (tool === "bash") return checkBash(ti);
    if (tool !== "write" && tool !== "edit" && tool !== "multiedit") return allow();
    const cwd = typeof inp.cwd === "string" ? inp.cwd : process.cwd();
    return checkEdit(tool, ti, cwd);
  } catch {
    return allow();
  }
}

if (import.meta.main) {
  let input: unknown = {};
  try { input = JSON.parse(await Bun.stdin.text()); } catch { /* fail-open */ }
  const r = check(input);
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exit(r.exit);
}
