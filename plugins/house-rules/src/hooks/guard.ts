/**
 * PreToolUse autocorrect guard — strips over-budget comments (TypeScript and Go only)
 * before the edit lands; other languages are passed through (Stop gate enforces them).
 * Trigger: Edit | Write | MultiEdit.
 * Budget: 5 effective comment lines per 100 lines added this session for each file.
 * Returns updatedInput when stripping succeeds; falls back to advisory when ambiguous.
 * Never emits permissionDecision.
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  detectLanguage,
  findComments,
  reconstructPostEdit,
  newComments as findNewComments,
  netNewCommentRows,
  autoFix,
  type Comment,
  type GetParserFn,
  type Lang,
} from "./lib/comment-density.js";
import { getParser as defaultGetParser } from "./lib/tree-sitter-loader.js";
import { sessionBase, addedRanges, diffTextToHunks } from "./lib/work-scope.js";
import { removedTextsFor, normalizeCommentText } from "./lib/autofix-ledger.js";
import { loadRules } from "../engine/registry.js";
import { runRules, isBlocking } from "../engine/run.js";
import { BUILTIN_POLICY, DEFAULT_IGNORE } from "../engine/policy.js";
import { LANG_FIX_TABLE } from "./gate.js";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

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

function deny(reason: string): HookResult {
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", additionalContext: reason },
    }) + "\n",
    stderr: "",
    exit: 0,
  };
}

function isIgnoredByDefault(filePath: string, cwd: string | null): boolean {
  let dir = cwd ?? path.dirname(filePath);
  // Walk up to the nearest existing directory (the target path may not exist yet)
  while (dir !== path.dirname(dir) && !existsSync(dir)) {
    dir = path.dirname(dir);
  }
  const r = spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (r.status !== 0) return false;
  const repoRoot = r.stdout.trim();
  const relPath = path.relative(repoRoot, filePath);
  return DEFAULT_IGNORE.some((pattern) => new Bun.Glob(pattern).match(relPath));
}

async function checkStray(filePath: string, cwd: string | null): Promise<HookResult | null> {
  const dir = cwd ?? path.dirname(filePath);
  const rootResult = spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (rootResult.status !== 0) return null;
  const repoRoot = rootResult.stdout.trim();
  const relPath = path.relative(repoRoot, filePath);
  const rulesDir = path.join(import.meta.dir, "../../rules");
  const allRules = await loadRules(rulesDir);
  const treeRules = allRules.filter((r) => r.vehicles.includes("tree"));
  const ctx: import("../engine/types.js").RuleContext = {
    repoRoot,
    mode: "guard",
    files: [{ path: relPath, baseText: "", addedHunks: [], tracked: false, sessionCreated: true }],
  };
  const findings = await runRules(treeRules, ctx, BUILTIN_POLICY, DEFAULT_IGNORE);
  if (!isBlocking(findings)) return null;
  return deny(findings[0].message);
}

const WRITE_TOOLS = new Set(["edit", "write", "multiedit"]);

function normalTool(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const lower = raw.toLowerCase();
  return lower.startsWith("fast_") ? lower.slice(5) : lower;
}

type EditEntry = { old_string: string; new_string: string; replace_all?: boolean };

function getBaseText(filePath: string, base: string): string | null {
  if (!base || base === EMPTY_TREE) return null;
  const dir = path.dirname(filePath);
  const rootResult = spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (rootResult.status !== 0) return null;
  const repoRoot = rootResult.stdout.trim();
  const relPath = path.relative(repoRoot, filePath);
  const showResult = spawnSync("git", ["-C", repoRoot, "show", `${base}:${relPath}`], { encoding: "utf8" });
  if (showResult.status !== 0) return null;
  return showResult.stdout;
}

function mapEditToInput(
  ti: Record<string, unknown>,
  pre: string,
  post: string,
  stripped_post: string,
): Record<string, unknown> | null {
  const old_string = typeof ti.old_string === "string" ? ti.old_string : "";
  const new_string = typeof ti.new_string === "string" ? ti.new_string : "";
  const replace_all = !!ti.replace_all;

  if (!replace_all) {
    const idx = pre.indexOf(old_string);
    if (idx === -1) return null;

    // Derive the actual changed span by comparing post vs stripped_post.
    let sfx = 0;
    const maxSfx = Math.min(post.length, stripped_post.length);
    while (sfx < maxSfx && post[post.length - 1 - sfx] === stripped_post[stripped_post.length - 1 - sfx]) sfx++;

    let pfx = 0;
    const maxPfx = Math.min(post.length - sfx, stripped_post.length - sfx);
    while (pfx < maxPfx && post[pfx] === stripped_post[pfx]) pfx++;

    const changeStart = pfx;
    const changeEnd = post.length - sfx;
    const editStart = idx;
    const editEnd = idx + new_string.length;

    // Change must be within [editStart-1, editEnd] (allow 1 char before for whole-line \n removal)
    if (changeStart < editStart - 1 || changeEnd > editEnd) return null;

    const new_sn = sfx > 0 ? stripped_post.slice(pfx, stripped_post.length - sfx) : stripped_post.slice(pfx);

    if (changeStart >= editStart) {
      // Change is entirely within the edit span
      const pre_in_new = changeStart - editStart;
      const post_in_new = editEnd - changeEnd;
      const unchanged_prefix = new_string.slice(0, pre_in_new);
      const unchanged_suffix = post_in_new > 0 ? new_string.slice(new_string.length - post_in_new) : "";
      return { ...ti, new_string: unchanged_prefix + new_sn + unchanged_suffix };
    } else {
      // changeStart == editStart - 1: a char before the edit (e.g. preceding \n) was also removed
      const extra = pre.slice(changeStart, editStart);
      const post_in_new = editEnd - changeEnd;
      const unchanged_suffix = post_in_new > 0 ? new_string.slice(new_string.length - post_in_new) : "";
      return { ...ti, old_string: extra + old_string, new_string: new_sn + unchanged_suffix };
    }
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
  _post: string,
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
  post: string,
  stripped_post: string,
): Record<string, unknown> | null {
  if (tool === "write") return { ...ti, content: stripped_post };
  if (tool === "edit") return mapEditToInput(ti, pre, post, stripped_post);
  if (tool === "multiedit") return mapMultiEditToInput(ti, pre, post, stripped_post);
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
  mode: "rewrite" | "advisory" = "rewrite",
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

  if (mode === "advisory") {
    return [
      `groundwork comment-density: ${N} comment(s) in your ${displayTool} to ${filePath} were not stripped — could not map edit automatically.`,
      `Why: code convention — at most 5 comment lines per 100 lines added this session. This file: ${A} lines added, ${C} comments already added, budget left before this edit: ${B}.`,
      `Would-be stripped:\n${rows}`,
      `These comments remain in the file as written. Remove them manually before your next Edit to this region.`,
      readdLine,
    ].join("\n");
  }

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
  ledgerDir?: string;
}

function buildReaddLines(nc: Comment[], filePath: string, ledgerDir?: string): string[] {
  try {
    const ledgerOpts = ledgerDir !== undefined ? { dir: ledgerDir } : undefined;
    const removed = removedTextsFor(filePath, ledgerOpts);
    if (removed.length === 0) return [];
    const lines: string[] = [];
    for (const c of nc) {
      const norm = normalizeCommentText(c.text);
      const match = removed.find(r => normalizeCommentText(r.text) === norm);
      if (match) {
        lines.push(
          `L${c.startRow + 1}: this comment was removed from ${filePath} by house-rules autofix at ${match.ts} (${match.reason}). Fold the information into names or drop it — don't re-add it.`,
        );
      }
    }
    return lines;
  } catch {
    return [];
  }
}

export async function check(input: unknown, opts: CheckOpts = {}): Promise<HookResult> {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) return allow();
    const inp = input as Record<string, unknown>;

    const tool = normalTool(inp.tool_name);
    if (!WRITE_TOOLS.has(tool)) return allow();

    const ti = (inp.tool_input && typeof inp.tool_input === "object" && !Array.isArray(inp.tool_input))
      ? inp.tool_input as Record<string, unknown>
      : {};

    const filePath = typeof ti.file_path === "string" ? ti.file_path : "";
    if (!filePath) return allow();
    const transcriptPath = typeof inp.transcript_path === "string" ? inp.transcript_path : null;
    const cwd = typeof inp.cwd === "string" ? inp.cwd : null;
    if (isIgnoredByDefault(filePath, cwd)) return allow();

    const readFile = opts.readFile ?? ((p: string) => { try { return readFileSync(p, "utf8"); } catch { return null; } });
    const pre = readFile(filePath);

    // Stray-artifacts check runs for any new file (pre === null), regardless of type.
    if (pre === null) {
      const strayResult = await checkStray(filePath, cwd);
      if (strayResult !== null) return strayResult;
    }

    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".md") return allow();

    const firstLine = tool === "write" && typeof ti.content === "string"
      ? ti.content.split("\n")[0]
      : undefined;
    const lang = detectLanguage(filePath, firstLine);
    if (lang === null) return allow();

    const getParser = opts.getParser ?? defaultGetParser;
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

    const repo = cwd ?? path.dirname(filePath);

    let priorAddedCount = 0;
    let priorAddedComments = 0;
    let base: string | null = null;
    let baseText: string | null = null;

    if (transcriptPath && pre !== null) {
      const b = sessionBase(transcriptPath, repo);
      base = b;
      const priorRows = addedRanges(filePath, b);
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
      baseText = getBaseText(filePath, b);
      if (baseText !== null) {
        const hunksBasePre = diffTextToHunks(baseText, pre);
        const netNewPreResult = await netNewCommentRows(baseText, pre, lang, hunksBasePre, getParser);
        if (netNewPreResult.ok) {
          priorAddedComments = netNewPreResult.rows.length;
        }
      }
    }

    const budget = Math.floor(0.05 * (priorAddedCount + changedRows.size)) - priorAddedComments;

    // Base-aware new-comment detection
    let nc: Comment[];
    if (base !== null && pre !== null) {
      if (baseText !== null) {
        const hunksBasePost = diffTextToHunks(baseText, post);
        const netNewResult = await netNewCommentRows(baseText, post, lang, hunksBasePost, getParser);
        if (netNewResult.ok) {
          const netNewRows = new Set(netNewResult.rows);
          nc = postFindResult.comments.filter(c => {
            if (c.exempt) return false;
            for (let r = c.startRow; r <= c.endRow; r++) {
              if (changedRows.has(r) && netNewRows.has(r + 1)) return true;
            }
            return false;
          });
        } else {
          nc = findNewComments(preComments, postFindResult.comments, changedRows);
        }
      } else {
        nc = findNewComments(preComments, postFindResult.comments, changedRows);
      }
    } else {
      nc = findNewComments(preComments, postFindResult.comments, changedRows);
    }

    if (nc.length === 0) return allow();

    const readdLines = buildReaddLines(nc, filePath, opts.ledgerDir);
    const readdCtx = readdLines.length > 0 ? readdLines.join("\n") : null;

    // Only stable+safe langs get in-flight stripping; preview langs defer to Stop gate.
    const fixEntry = LANG_FIX_TABLE[lang as Lang];
    const isStableAndSafe = !!fixEntry && fixEntry.stability === "stable" && fixEntry.applicability === "safe";
    if (!isStableAndSafe) {
      if (readdCtx) return advisory(readdCtx);
      return allow();
    }

    const ncRowSet = new Set<number>();
    for (const c of nc) {
      for (let r = c.startRow; r <= c.endRow; r++) ncRowSet.add(r);
    }

    if (ncRowSet.size <= Math.max(0, budget)) {
      if (readdCtx) return advisory(readdCtx);
      return allow();
    }

    const ncSet = new Set(nc.map(c => c.startIndex));
    const autoFixRows = new Set<number>(changedRows);
    for (const c of postFindResult.comments) {
      if (c.exempt) continue;
      if (ncSet.has(c.startIndex)) continue;
      for (let r = c.startRow; r <= c.endRow; r++) autoFixRows.delete(r);
    }

    const ar = await autoFix(post, lang, autoFixRows, getParser, ncRowSet, { maxAllowedRows: Math.max(0, budget) });
    if (!ar.ok || ar.removed === 0) {
      const ctx = buildCtx(tool, filePath, nc, budget, 0, priorAddedCount, priorAddedComments, "advisory");
      return advisory(readdCtx ? ctx + "\n" + readdCtx : ctx);
    }

    const removedTextSet = new Set(ar.removedTexts);
    const stripped_comments = nc.filter(c => removedTextSet.has(c.text));
    const stripped_post = ar.fixed;
    const updatedTi = mapToInput(tool, ti, pre ?? "", post, stripped_post);

    if (updatedTi !== null) {
      const verified = reconstructPostEdit(tool, updatedTi as Parameters<typeof reconstructPostEdit>[1], pre);
      if (verified && verified.post === stripped_post) {
        const ctx = buildCtx(tool, filePath, stripped_comments, budget, 0, priorAddedCount, priorAddedComments);
        return rewrite(updatedTi, readdCtx ? ctx + "\n" + readdCtx : ctx);
      }
    }

    const ctx = buildCtx(tool, filePath, nc, budget, 0, priorAddedCount, priorAddedComments, "advisory");
    return advisory(readdCtx ? ctx + "\n" + readdCtx : ctx);
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
