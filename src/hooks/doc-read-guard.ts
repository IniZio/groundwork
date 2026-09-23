/**
 * PreToolUse hook — doc-read-guard.
 *
 * Enforces progressive disclosure for large doc-class files using only
 * built-in Claude Code tools (no gw/doc CLI verbs).
 *
 * Rules:
 *   AC 2 — A full Read (no offset, no limit) of an over-budget doc-class
 *           file → deny. Hint: "Grep '^#' <path> for headings, then Read
 *           with offset/limit."
 *   AC 2b — A Read with offset or limit already set → always allow (that IS
 *            the progressive-disclosure path).
 *   AC 3 — Bash cat/head/less of an over-budget doc-class file → deny with
 *           the same hint.
 *   AC 4 — Never deny Grep, Edit, Write, or MultiEdit.
 *   AC 6 — FAIL-OPEN: any error → emit nothing, exit 0.
 *
 * Progressive disclosure model: the model calls Grep to list headings, then
 * uses Read with offset/limit to load only the section it needs. No session
 * state needed — partial reads are detected by the presence of offset/limit.
 *
 * RETARGET vs v1:
 *   - "doc toc" / "doc show" hints replaced with Grep + Read offset/limit
 *     (those v1 CLI verbs do not exist in v2).
 *   - Session TOC tmp-file state removed (no longer needed).
 *   - "less" added to Bash denial pattern.
 *   - Accepts optional rootDir argument so tests can pass an explicit root
 *     without calling process.chdir().
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifyDoc, estimateTokens } from "./doc-io.js";

export interface HookResult { stdout: string; stderr: string; exit: number }

function allow(): HookResult { return { stdout: "", stderr: "", exit: 0 }; }

function deny(reason: string): HookResult {
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }) + "\n",
    stderr: "",
    exit: 0,
  };
}

function isEmbeddedAgent(): boolean {
  const ep = process.env.CLAUDE_CODE_ENTRYPOINT;
  return ep === "sdk-py" || ep === "sdk-js";
}

/** Denial hint using only real Claude Code tools (no doc/gw verbs). */
function hint(absPath: string, tokens: number, budget: number): string {
  return (
    `doc-read-guard: ${absPath} is over budget (~${tokens} tok > ${budget}). ` +
    `Reading it whole injects the full file into context.\n` +
    `Progressive disclosure: Grep '^#' in ${absPath} to list headings, ` +
    `then Read with offset/limit to load only the section you need.`
  );
}

// ---------------------------------------------------------------------------
// Path extraction
// ---------------------------------------------------------------------------

/**
 * Extract file paths from cat / head / less commands.
 * Handles flags like "head -n 50 path" and two-word "-n 50" style.
 */
function extractPagerPaths(command: string): string[] {
  const paths: string[] = [];
  const re = /(?:^|[|;&\n])\s*(?:cat|head|less)\s+(?:-[^\s]*(?:\s+\d+)?\s+)*([^\s|;&\n>-][^\s|;&\n>]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(command)) !== null) {
    paths.push(m[1]);
  }
  return paths;
}

// ---------------------------------------------------------------------------
// Per-tool handlers
// ---------------------------------------------------------------------------

function handleRead(inp: Record<string, unknown>, rootDir: string): HookResult {
  const ti = (inp.tool_input && typeof inp.tool_input === "object" ? inp.tool_input : {}) as Record<string, unknown>;
  const fp = typeof ti.file_path === "string" ? ti.file_path : "";
  if (!fp) return allow();

  // AC 2b: partial read — already using progressive disclosure.
  const hasOffset = ti.offset !== undefined && ti.offset !== null;
  const hasLimit = ti.limit !== undefined && ti.limit !== null;
  if (hasOffset || hasLimit) return allow();

  let absPath: string;
  try { absPath = resolve(rootDir, fp); } catch { return allow(); }

  const cls = classifyDoc(absPath, rootDir);
  if (!cls) return allow();

  let content: string;
  try { content = readFileSync(absPath, "utf8"); } catch { return allow(); }

  const tokens = estimateTokens(content);
  if (tokens <= cls.budget) return allow();

  return deny(hint(absPath, tokens, cls.budget));
}

function handleBash(inp: Record<string, unknown>, rootDir: string): HookResult {
  const command = (inp.tool_input as Record<string, unknown>)?.command;
  if (typeof command !== "string" || !command) return allow();

  for (const rawPath of extractPagerPaths(command)) {
    let absPath: string;
    try { absPath = resolve(rootDir, rawPath); } catch { continue; }

    const cls = classifyDoc(absPath, rootDir);
    if (!cls) continue;

    let content: string;
    try { content = readFileSync(absPath, "utf8"); } catch { continue; }

    const tokens = estimateTokens(content);
    if (tokens <= cls.budget) continue;

    return deny(hint(absPath, tokens, cls.budget));
  }

  return allow();
}

// ---------------------------------------------------------------------------
// Exported check function (v2 style)
// ---------------------------------------------------------------------------

/** Optional rootDir for testing without process.chdir(). */
export function check(input: unknown, rootDir?: string): HookResult {
  try {
    if (isEmbeddedAgent()) return allow();

    const root = rootDir ?? process.cwd();
    const inp = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const rawTool = typeof inp.tool_name === "string" ? inp.tool_name : "";
    const toolNorm = rawTool.toLowerCase().replace(/^fast_/, "");

    // AC 4: never deny these.
    if (["edit", "write", "multiedit", "grep"].includes(toolNorm)) return allow();

    if (toolNorm === "read") return handleRead(inp, root);
    if (toolNorm === "bash") return handleBash(inp, root);
  } catch { /* AC 6: fail-open */ }

  return allow();
}

// ---------------------------------------------------------------------------
// Standalone entry (Bun)
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const raw = await Bun.stdin.text();
  let input: unknown = {};
  try { input = JSON.parse(raw); } catch { /* fail-open */ }
  const result = check(input);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.exit);
}
