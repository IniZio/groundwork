/**
 * PostToolUse hook — doc-size-guard.
 *
 * Fires after Write, Edit, or MultiEdit. If the target is a doc-class file
 * that exceeds its class token budget AND is missing a summary-header or
 * section-anchor, prints an advisory violation message.
 *
 * Design (ported from v1 hooks/doc-size-guard.mjs, D18):
 *   AC 1 — violation printed for over-budget doc-class file missing structural
 *           elements (summary-header and/or section-anchor).
 *   AC 6 — FAIL-OPEN: any error → emit nothing, exit 0.
 *   AC 7 — registered for Write, Edit, MultiEdit only.
 *
 * RETARGET vs v1: spec machinery (doc/specs/ class) removed per D18; only the
 * six classes from doc-io.ts are checked. Advisory output format unchanged.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifyDoc, estimateTokens, checkStructure } from "./doc-io.js";

export interface HookResult { stdout: string; stderr: string; exit: number }

function allow(): HookResult { return { stdout: "", stderr: "", exit: 0 }; }

function advise(msg: string): HookResult {
  return { stdout: msg, stderr: "", exit: 0 };
}

function isEmbeddedAgent(): boolean {
  const ep = process.env.CLAUDE_CODE_ENTRYPOINT;
  return ep === "sdk-py" || ep === "sdk-js";
}

const GUARDED = new Set(["write", "edit", "multiedit"]);

/** Optional rootDir for testing without process.chdir(). */
export function check(input: unknown, rootDir?: string): HookResult {
  try {
    if (isEmbeddedAgent()) return allow();

    const root = rootDir ?? process.cwd();
    const inp = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const rawTool = typeof inp.tool_name === "string" ? inp.tool_name : "";
    const toolNorm = rawTool.toLowerCase().replace(/^fast_/, "");
    if (!GUARDED.has(toolNorm)) return allow();

    const ti = (inp.tool_input && typeof inp.tool_input === "object" ? inp.tool_input : {}) as Record<string, unknown>;
    const fp = typeof ti.file_path === "string" ? ti.file_path : "";
    if (!fp) return allow();

    const absPath = resolve(root, fp);
    const cls = classifyDoc(absPath, root);
    if (!cls) return allow();

    let content: string;
    try { content = readFileSync(absPath, "utf8"); } catch { return allow(); }

    const tokens = estimateTokens(content);
    if (tokens <= cls.budget) return allow();

    const { hasSummaryHeader, hasSectionAnchor } = checkStructure(content);
    if (hasSummaryHeader && hasSectionAnchor) return allow();

    const missing: string[] = [];
    if (!hasSummaryHeader) missing.push("summary-header");
    if (!hasSectionAnchor) missing.push("section-anchor");

    return advise(
      `doc-size-guard: violation\n` +
      `  path:    ${absPath}\n` +
      `  class:   ${cls.name}\n` +
      `  tokens:  ~${tokens} (budget ${cls.budget})\n` +
      `  missing: ${missing.join(", ")}\n`,
    );
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
