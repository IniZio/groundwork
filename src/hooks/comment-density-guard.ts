/**
 * PreToolUse autocorrect guard — strips over-budget comments before the edit lands.
 * Trigger: Edit | Write | MultiEdit.
 * Budget: 5 effective comment lines per 100 lines added this session for each file.
 * Returns updatedInput when stripping succeeds; falls back to advisory when ambiguous.
 * Never emits permissionDecision.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import {
  detectLanguage,
  findComments,
  reconstructPostEdit,
  newComments as findNewComments,
  stripComments,
  type Comment,
  type GetParserFn,
} from "./lib/comment-density.js";
import { getParser as defaultGetParser } from "./lib/tree-sitter-loader.js";
import { sessionBase, addedRanges } from "./lib/work-scope.js";

export interface HookResult { stdout: string; stderr: string; exit: number }

function allow(): HookResult { return { stdout: "", stderr: "", exit: 0 }; }

function rewrite(updatedInput: Record<string, unknown>, ctx: string): HookResult {
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput, additionalContext: ctx },
    }) + "\n",
    stderr: "",
    exit: 0,
  };
}

function advisory(ctx: string, stderrLine?: string): HookResult {
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: ctx },
    }) + "\n",
    stderr: stderrLine ? stderrLine + "\n" : "",
    exit: 0,
  };
}

const WRITE_TOOLS = new Set(["edit", "write", "multiedit"]);

function normalTool(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const lower = raw.toLowerCase();
  return lower.startsWith("fast_") ? lower.slice(5) : lower;
}

type EditEntry = { old_string: string; new_string: string; replace_all?: boolean };

function mapEditToInput(
  ti: Record<string, unknown>,
  pre: string,
  stripped_post: string,
): Record<string, unknown> | null {
  const old_string = typeof ti.old_string === "string" ? ti.old_string : "";
  const new_string = typeof ti.new_string === "string" ? ti.new_string : "";
  const replace_all = !!ti.replace_all;

  if (!replace_all) {
    const idx = pre.indexOf(old_string);
    if (idx === -1) return null;
    const suffix_len = pre.length - idx - old_string.length;
    const sn = suffix_len > 0
      ? stripped_post.slice(idx, stripped_post.length - suffix_len)
      : stripped_post.slice(idx);
    return { ...ti, new_string: sn };
  }

  const occs: number[] = [];
  let s = 0;
  while (true) {
    const idx = pre.indexOf(old_string, s);
    if (idx === -1) break;
    occs.push(idx);
    s = idx + old_string.length;
  }
  if (occs.length === 0) return null;

  const delta = new_string.length - old_string.length;
  const post_len = pre.length + occs.length * delta;
  const sns = occs.map((idx, i) => {
    const start = idx + i * delta;
    const end = start + new_string.length;
    const suf = post_len - end;
    return suf > 0 ? stripped_post.slice(start, stripped_post.length - suf) : stripped_post.slice(start);
  });

  const first = sns[0];
  if (!sns.every(sn => sn === first)) return null;
  return { ...ti, new_string: first };
}

function mapMultiEditToInput(
  ti: Record<string, unknown>,
  pre: string,
  stripped_post: string,
): Record<string, unknown> | null {
  const edits = Array.isArray(ti.edits) ? ti.edits as EditEntry[] : [];
  if (edits.length === 0) return null;

  let text = pre;
  let cumDelta = 0;
  const ranges: Array<{ start: number; end: number }> = [];

  for (const e of edits) {
    if (e.replace_all) return null;
    const idx = text.indexOf(e.old_string);
    if (idx === -1) return null;
    const start = idx + cumDelta;
    const end = start + e.new_string.length;
    ranges.push({ start, end });
    cumDelta += e.new_string.length - e.old_string.length;
    text = text.slice(0, idx) + e.new_string + text.slice(idx + e.old_string.length);
  }

  const post_len = text.length;
  const new_edits = edits.map((e, i) => {
    const { start, end } = ranges[i];
    const suf = post_len - end;
    const sn = suf > 0
      ? stripped_post.slice(start, stripped_post.length - suf)
      : stripped_post.slice(start);
    return { ...e, new_string: sn };
  });

  return { ...ti, edits: new_edits };
}

function mapToInput(
  tool: string,
  ti: Record<string, unknown>,
  pre: string,
  stripped_post: string,
): Record<string, unknown> | null {
  if (tool === "write") return { ...ti, content: stripped_post };
  if (tool === "edit") return mapEditToInput(ti, pre, stripped_post);
  if (tool === "multiedit") return mapMultiEditToInput(ti, pre, stripped_post);
  return null;
}

export function buildCtx(
  tool: string,
  filePath: string,
  stripped: Comment[],
  budgetBefore: number,
  remainder: number,
  priorAddedCount: number,
  priorAddedComments: number,
): string {
  const N = stripped.length;
  const displayTool = tool.charAt(0).toUpperCase() + tool.slice(1);
  const A = priorAddedCount;
  const C = priorAddedComments;
  const B = Math.max(0, budgetBefore);
  const K = Math.max(0, remainder);

  const rows = stripped
    .map(c => `  L${c.startRow + 1}: ${c.text.split("\n")[0].slice(0, 80)}`)
    .join("\n");

  const readdLine = K === 0
    ? "No comment budget remains for this file; express intent through naming instead."
    : `You may re-add up to ${K} short comment(s) (one line, explaining why, not what), or accept the removal.`;

  return [
    `groundwork comment-density: removed ${N} comment(s) from your ${displayTool} to ${filePath} before it was applied.`,
    `Why: code convention — at most 5 comment lines per 100 lines added this session. This file: ${A} lines added, ${C} comments already added, budget left before this edit: ${B}.`,
    `This is groundwork's automatic correction — not another session's edit, a merge, or a bug.`,
    `Removed:\n${rows}`,
    `The file will not contain these comments. Re-Read the file before your next Edit to this region; your old_string must match the corrected text.`,
    readdLine,
  ].join("\n");
}

export interface CheckOpts {
  getParser?: GetParserFn;
  readFile?: (p: string) => string | null;
}

export async function check(input: unknown, opts: CheckOpts = {}): Promise<HookResult> {
  try {
    if (process.env.GROUNDWORK_COMMENT_DENSITY === "0") return allow();

    if (!input || typeof input !== "object" || Array.isArray(input)) return allow();
    const inp = input as Record<string, unknown>;

    const tool = normalTool(inp.tool_name);
    if (!WRITE_TOOLS.has(tool)) return allow();

    const ti = (inp.tool_input && typeof inp.tool_input === "object" && !Array.isArray(inp.tool_input))
      ? inp.tool_input as Record<string, unknown>
      : {};

    const filePath = typeof ti.file_path === "string" ? ti.file_path : "";
    if (!filePath) return allow();

    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".md") return allow();

    const firstLine = tool === "write" && typeof ti.content === "string"
      ? ti.content.split("\n")[0]
      : undefined;
    const lang = detectLanguage(filePath, firstLine);
    if (lang === null) return allow();

    const getParser = opts.getParser ?? defaultGetParser;
    const readFile = opts.readFile ?? ((p: string) => { try { return readFileSync(p, "utf8"); } catch { return null; } });

    const pre = readFile(filePath);
    const reconResult = reconstructPostEdit(tool, ti as Parameters<typeof reconstructPostEdit>[1], pre);
    if (!reconResult) return allow();
    const { post, changedRows } = reconResult;

    const postFindResult = await findComments(post, lang, getParser);
    if (!postFindResult.ok) {
      const reason = postFindResult.reason;
      return advisory(
        `groundwork comment-density: tree-sitter unavailable (${reason}) — advisory only`,
        `[comment-density-guard] tree-sitter unavailable: ${reason}`,
      );
    }

    const preFindResult = pre !== null ? await findComments(pre, lang, getParser) : null;
    const preComments = preFindResult?.ok ? preFindResult.comments : null;

    const transcriptPath = typeof inp.transcript_path === "string" ? inp.transcript_path : null;
    const cwd = typeof inp.cwd === "string" ? inp.cwd : null;
    const repo = cwd ?? path.dirname(filePath);

    let priorAddedCount = 0;
    let priorAddedComments = 0;

    if (transcriptPath && pre !== null) {
      const base = sessionBase(transcriptPath, repo);
      const priorRows = addedRanges(filePath, base);
      if (priorRows) {
        priorAddedCount = priorRows.length;
        const priorRowSet = new Set(priorRows);
        if (preComments) {
          priorAddedComments = preComments.filter(c => {
            if (c.exempt) return false;
            for (let r = c.startRow; r <= c.endRow; r++) {
              if (priorRowSet.has(r + 1)) return true;
            }
            return false;
          }).length;
        }
      }
    }

    const budget = Math.floor(0.05 * (priorAddedCount + changedRows.size)) - priorAddedComments;
    const nc = findNewComments(preComments, postFindResult.comments, changedRows);

    const keep = Math.max(budget, 0);
    if (nc.length <= keep) return allow();

    const to_strip = nc.slice(keep);
    const stripped_post = stripComments(post, to_strip);

    const updatedTi = mapToInput(tool, ti, pre ?? "", stripped_post);

    const remainder = Math.max(0, budget - keep);

    if (updatedTi !== null) {
      const verified = reconstructPostEdit(tool, updatedTi as Parameters<typeof reconstructPostEdit>[1], pre);
      if (verified && verified.post === stripped_post) {
        const ctx = buildCtx(tool, filePath, to_strip, budget, remainder, priorAddedCount, priorAddedComments);
        return rewrite(updatedTi, ctx);
      }
    }

    const ctx = buildCtx(tool, filePath, to_strip, budget, remainder, priorAddedCount, priorAddedComments);
    return advisory(ctx);
  } catch {
    return allow();
  }
}

if (import.meta.main) {
  const raw = await Bun.stdin.text();
  let input: unknown = {};
  try { input = JSON.parse(raw); } catch { /* fail-open */ }
  const result = await check(input);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.exit);
}
