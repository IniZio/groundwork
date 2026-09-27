import path from "node:path";
import {
  findComments,
  newComments as findNewComments,
  netNewCommentRows,
  autoFix,
  type Comment,
  type GetParserFn,
} from "../../src/hooks/lib/comment-density.js";
import { removedTextsFor, normalizeCommentText } from "../../src/hooks/lib/autofix-ledger.js";
import { fixEntryFor } from "./languages.js";
import type { Language } from "../../src/hooks/languages/registry.js";
import type { PendingEdit, EditCheckEnv, EditCheckResult } from "../../src/engine/types.js";

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

export async function commentDensityEditCheck(edit: PendingEdit, env: EditCheckEnv): Promise<EditCheckResult> {
  const filePath = edit.path;
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".md") return { findings: [] };

  const lang = edit.lang;
  if (lang === null) return { findings: [] };

  const { post, changedRows, pre, session, tool } = edit;
  const getParser = env.parserFactory as unknown as GetParserFn;

  const postFindResult = await findComments(post, lang, getParser);
  if (!postFindResult.ok) {
    const reason = postFindResult.reason;
    return {
      findings: [],
      notice: `groundwork comment-density: tree-sitter unavailable (${reason}) — advisory only`,
      stderr: `[comment-density-guard] tree-sitter unavailable: ${reason}`,
    };
  }

  const preFindResult = pre !== null ? await findComments(pre, lang, getParser) : null;
  const preComments = preFindResult?.ok ? preFindResult.comments : null;

  let priorAddedCount = 0;
  let priorAddedComments = 0;

  if (session !== null && pre !== null) {
    const priorRows = session.addedRows;
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
    if (session.baseText !== null && session.preHunks !== null) {
      const netNewPreResult = await netNewCommentRows(session.baseText, pre, lang, session.preHunks as Parameters<typeof netNewCommentRows>[3], getParser);
      if (netNewPreResult.ok) {
        priorAddedComments = netNewPreResult.rows.length;
      }
    }
  }

  const budget = Math.floor(0.05 * (priorAddedCount + changedRows.size)) - priorAddedComments;

  // Base-aware new-comment detection
  let nc: Comment[];
  if (session !== null && pre !== null) {
    if (session.baseText !== null && session.postHunks !== null) {
      const netNewResult = await netNewCommentRows(session.baseText, post, lang, session.postHunks as Parameters<typeof netNewCommentRows>[3], getParser);
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

  if (nc.length === 0) return { findings: [] };

  const readdLines = buildReaddLines(nc, filePath, env.ledgerDir);
  const readdCtx = readdLines.length > 0 ? readdLines.join("\n") : null;

  // Only stable+safe langs get in-flight stripping; preview langs defer to Stop gate.
  const fixEntry = fixEntryFor(lang as Language);
  const isStableAndSafe = fixEntry.stability === "stable" && fixEntry.applicability === "safe";
  if (!isStableAndSafe) {
    if (readdCtx) return { findings: [], notice: readdCtx };
    return { findings: [] };
  }

  const ncRowSet = new Set<number>();
  for (const c of nc) {
    for (let r = c.startRow; r <= c.endRow; r++) ncRowSet.add(r);
  }

  if (ncRowSet.size <= Math.max(0, budget)) {
    if (readdCtx) return { findings: [], notice: readdCtx };
    return { findings: [] };
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
    return { findings: [], notice: readdCtx ? ctx + "\n" + readdCtx : ctx };
  }

  const remaining = [...nc];
  const stripped_comments: Comment[] = [];
  for (const text of ar.removedTexts) {
    const idx = remaining.findIndex(c => c.text === text);
    if (idx !== -1) {
      stripped_comments.push(remaining[idx]);
      remaining.splice(idx, 1);
    }
  }

  const noticeText = buildCtx(tool, filePath, stripped_comments, budget, 0, priorAddedCount, priorAddedComments);
  const refusedNoticeText = buildCtx(tool, filePath, nc, budget, 0, priorAddedCount, priorAddedComments, "advisory");

  return {
    findings: [],
    edits: [{ start: 0, end: post.length, text: ar.fixed }],
    notice: readdCtx ? noticeText + "\n" + readdCtx : noticeText,
    refusedNotice: readdCtx ? refusedNoticeText + "\n" + readdCtx : refusedNoticeText,
  };
}
