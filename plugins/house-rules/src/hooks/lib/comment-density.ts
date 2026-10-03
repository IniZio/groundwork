import { getParser as defaultGetParser } from "./tree-sitter-loader.js";
import type { Node } from "./tree-sitter.js";
import type { DiffHunk } from "./work-scope.js";
import type { Language } from "../languages/registry.js";
import { isCommentNode, parseText, classifyComments } from "../languages/parse.js";
import type { ClassifiedComment } from "../languages/comments.js";
import { commentInnerText as stripMarkers } from "../languages/comments.js";
import { languageHookFor, type RemovalGrouping } from "../../../rules/comment-density/languages.js";

export interface Comment {
  startIndex: number;
  endIndex: number;
  startRow: number;
  endRow: number;
  text: string;
  nodeType: string;
  exempt: boolean;
  exemptReason?: string;
}

export type FindResult =
  | { ok: true; comments: Comment[]; errorRows: Set<number> }
  | { ok: false; reason: string; errorRows: Set<number> };

export type DensityResult =
  | { ok: true; total: number; effective: number; commentRows: number[]; errorRows: Set<number> }
  | { ok: false; reason: string };

export type GetParserFn = typeof defaultGetParser;

const ANNOT_TAG_RE = /^@\w/;
const REGION_RE = /^#?(?:region|endregion)/i;
export const URL_RE = /^https?:\/\/\S+$/;
const DIVIDER_RE = /^(?:[─-╿━═]{2,}|[-=#*~_]{4,})$/u;
// go/doc treats any [A-Z]{2,}(uid): as a note marker (TODO, BUG, FIXME, NOTE, XXX, HACK…)
export const NOTE_MARKER_RE = /^[A-Z]{2,}\([^)]+\)/;
const GW_RULE_RE = /^groundwork-rule:/;

function isExemptInner(inner: string): boolean {
  if (
    ANNOT_TAG_RE.test(inner) ||
    REGION_RE.test(inner) ||
    URL_RE.test(inner) ||
    DIVIDER_RE.test(inner) ||
    NOTE_MARKER_RE.test(inner) ||
    GW_RULE_RE.test(inner)
  ) return true;
  return false;
}

function checkExempt(
  raw: string,
  label: string | undefined,
  directive: boolean,
): { exempt: boolean; reason?: string } {
  if (label !== undefined) return { exempt: true, reason: label };

  const trimmed0 = raw.trimStart();
  const lines = raw.split("\n");

  if (trimmed0.startsWith("/*")) {
    // Block comment: exempt only when every non-blank inner line is exempt.
    let firstReason: string | undefined;
    let hasNonBlank = false;
    for (const line of lines) {
      const inner = stripMarkers(line);
      if (!inner) continue;
      hasNonBlank = true;
      if (DIVIDER_RE.test(inner)) { firstReason ??= "divider"; continue; }
      if (isExemptInner(inner)) { firstReason ??= inner.slice(0, 30); continue; }
      if (directive) { firstReason ??= inner.slice(0, 30); continue; }
      return { exempt: false };
    }
    if (!hasNonBlank) return { exempt: false };
    return { exempt: true, reason: firstReason };
  }

  for (const line of lines) {
    const inner = stripMarkers(line);
    if (!inner) {
      if (line.trim().startsWith("//")) return { exempt: true, reason: "spacer" };
      continue;
    }
    if (DIVIDER_RE.test(inner)) return { exempt: true, reason: "divider" };
    if (isExemptInner(inner) || directive) return { exempt: true, reason: inner.slice(0, 30) };
  }

  return { exempt: false };
}

function collectComments(root: Node, text: string, lang: Language, classified: Map<number, ClassifiedComment>): Comment[] {
  const results: Comment[] = [];

  function walk(node: Node): void {
    if (isCommentNode(node, lang)) {
      const raw = node.text ?? text.slice(node.startIndex, node.endIndex);
      let startIndex = node.startIndex;
      let endIndex = node.endIndex;
      let startRow = node.startPosition.row;
      let endRow = node.endPosition.row;

      const parent = node.parent;
      if (parent?.type === "jsx_expression" && parent.namedChildCount === 1) {
        startIndex = parent.startIndex;
        endIndex = parent.endIndex;
        startRow = parent.startPosition.row;
        endRow = parent.endPosition.row;
      }

      const cls = classified.get(node.startIndex)!;
      let { exempt, reason } = checkExempt(raw, cls.label, cls.fallbackLabel === undefined ? cls.directive : false);
      if (!exempt && cls.kind === "doc") { exempt = true; reason = `${lang}-doc`; }
      if (!exempt && cls.header) { exempt = true; reason = `${lang}-file-header`; }
      if (!exempt && cls.fallbackLabel !== undefined) { exempt = true; reason = cls.fallbackLabel; }
      results.push({
        startIndex,
        endIndex,
        startRow,
        endRow,
        text: raw,
        nodeType: node.type,
        exempt,
        exemptReason: reason,
      });
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walk(child);
    }
  }

  walk(root);
  return results;
}

async function findClassifiedComments(
  text: string,
  lang: Language,
  getParser: GetParserFn,
): Promise<
  | { ok: true; comments: Comment[]; errorRows: Set<number>; groupOf: Map<number, number | null> }
  | { ok: false; reason: string; errorRows: Set<number> }
> {
  const pr = await parseText(text, lang, getParser);
  if (!pr.ok) return { ok: false, reason: pr.reason, errorRows: new Set() };

  const { tree, errorRows } = pr;
  const allClassified = classifyComments(tree.rootNode, text, lang);
  const groupOf = new Map<number, number | null>(allClassified.map(c => [c.startIndex, c.group]));
  const classified = new Map(allClassified.map(c => [c.startIndex, c]));

  if (!tree.rootNode.hasError) {
    const comments = collectComments(tree.rootNode, text, lang, classified);
    tree.delete();
    return { ok: true, comments, errorRows: new Set(), groupOf };
  }

  const allComments = collectComments(tree.rootNode, text, lang, classified);
  tree.delete();
  const safeComments = allComments.filter(c => {
    for (let r = c.startRow; r <= c.endRow; r++) {
      if (errorRows.has(r)) return false;
    }
    return true;
  });
  return { ok: true, comments: safeComments, errorRows, groupOf };
}

export async function findComments(
  text: string,
  lang: Language,
  getParser: GetParserFn = defaultGetParser,
): Promise<FindResult> {
  const r = await findClassifiedComments(text, lang, getParser);
  if (!r.ok) return r;
  return { ok: true, comments: r.comments, errorRows: r.errorRows };
}

interface EditInput {
  file_path?: string;
  old_string?: string;
  new_string?: string;
  replace_all?: boolean;
  content?: string;
  edits?: Array<{ old_string: string; new_string: string; replace_all?: boolean }>;
}

function applyOneEdit(
  text: string,
  oldStr: string,
  newStr: string,
  replaceAll: boolean,
): { post: string; rowRanges: Array<[number, number]> } | null {
  if (!text.includes(oldStr)) return null;

  const rowRanges: Array<[number, number]> = [];

  if (replaceAll) {
    let result = "";
    let searchFrom = 0;
    let lineOffset = 0;
    const oldLines = oldStr.split("\n").length;
    const newLines = newStr.split("\n").length;

    while (true) {
      const idx = text.indexOf(oldStr, searchFrom);
      if (idx === -1) { result += text.slice(searchFrom); break; }
      result += text.slice(searchFrom, idx);
      const rowsBefore = text.slice(0, idx).split("\n").length - 1;
      const startRow = rowsBefore + lineOffset;
      rowRanges.push([startRow, startRow + newLines - 1]);
      lineOffset += newLines - oldLines;
      result += newStr;
      searchFrom = idx + oldStr.length;
    }
    return { post: result, rowRanges };
  } else {
    const idx = text.indexOf(oldStr);
    const rowsBefore = text.slice(0, idx).split("\n").length - 1;
    const newLines = newStr.split("\n").length;
    rowRanges.push([rowsBefore, rowsBefore + newLines - 1]);
    const post = text.slice(0, idx) + newStr + text.slice(idx + oldStr.length);
    return { post, rowRanges };
  }
}

export function reconstructPostEdit(
  tool: string,
  toolInput: EditInput,
  currentFileText: string | null,
): { post: string; changedRows: Set<number> } | null {
  const norm = tool.toLowerCase().replace(/^fast_/, "");

  if (norm === "write") {
    const content = toolInput.content ?? "";
    const changedRows = new Set<number>();
    const postLines = content.split("\n");
    if (currentFileText === null) {
      postLines.forEach((_, i) => changedRows.add(i));
    } else {
      const preLines = currentFileText.split("\n");
      for (let i = 0; i < postLines.length; i++) {
        if (postLines[i] !== preLines[i]) changedRows.add(i);
      }
    }
    return { post: content, changedRows };
  }

  if (norm === "edit") {
    const oldStr = toolInput.old_string ?? "";
    const newStr = toolInput.new_string ?? "";
    const text = currentFileText ?? "";
    const r = applyOneEdit(text, oldStr, newStr, !!toolInput.replace_all);
    if (!r) return null;
    const changedRows = new Set<number>();
    for (const [lo, hi] of r.rowRanges) {
      for (let i = lo; i <= hi; i++) changedRows.add(i);
    }
    return { post: r.post, changedRows };
  }

  if (norm === "multiedit") {
    const edits = toolInput.edits ?? [];
    let text = currentFileText ?? "";
    const changedRows = new Set<number>();
    for (const e of edits) {
      const r = applyOneEdit(text, e.old_string, e.new_string, !!e.replace_all);
      if (!r) return null;
      for (const [lo, hi] of r.rowRanges) {
        for (let i = lo; i <= hi; i++) changedRows.add(i);
      }
      text = r.post;
    }
    return { post: text, changedRows };
  }

  return null;
}

function normalizeCommentText(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function newComments(
  pre: Comment[] | null,
  post: Comment[],
  changedRows: Set<number>,
): Comment[] {
  const preMap = new Map<string, number>();
  if (pre) {
    for (const c of pre) {
      if (c.exempt) continue;
      const key = normalizeCommentText(c.text);
      preMap.set(key, (preMap.get(key) ?? 0) + 1);
    }
  }

  const remaining = new Map(preMap);
  const result: Comment[] = [];

  for (const c of post) {
    if (c.exempt) continue;
    const intersects = c.startRow <= Math.max(...changedRows) &&
      c.endRow >= Math.min(...changedRows) &&
      [...changedRows].some(r => r >= c.startRow && r <= c.endRow);
    if (!intersects) continue;

    const key = normalizeCommentText(c.text);
    const count = remaining.get(key) ?? 0;
    if (count > 0) {
      remaining.set(key, count - 1);
    } else {
      result.push(c);
    }
  }

  return result;
}

export function stripComments(text: string, comments: Comment[]): { text: string; rowChanges: RowChange[] } {
  const origLines = text.split("\n");
  const sorted = [...comments].sort((a, b) => b.startIndex - a.startIndex);
  let result = text;
  const rowChanges: RowChange[] = [];
  const touchedInlineRows = new Set<number>();
  const deletedOrigRows = new Set<number>();

  for (const c of sorted) {
    const before = result.slice(0, c.startIndex);
    const after = result.slice(c.endIndex);
    const lineStart = before.lastIndexOf("\n") + 1;
    const beforeOnLine = before.slice(lineStart);
    const lineEndOffset = after.indexOf("\n");
    const afterOnLine = lineEndOffset !== -1 ? after.slice(0, lineEndOffset) : after;
    const isWholeLine = !beforeOnLine.trim() && !afterOnLine.trim();

    if (isWholeLine) {
      const lineEnd = after.indexOf("\n");
      const trailingNewline = lineEnd !== -1 ? after.slice(lineEnd) : "";
      const prefix = lineStart > 0 ? result.slice(0, lineStart - 1) : "";
      if (lineStart > 0) {
        result = prefix + trailingNewline;
      } else {
        result = lineEnd !== -1 ? after.slice(lineEnd + 1) : "";
      }
      for (let r = c.startRow; r <= c.endRow; r++) {
        if (!deletedOrigRows.has(r)) {
          deletedOrigRows.add(r);
          rowChanges.push({ origRow: r, kind: "deleted", origText: origLines[r] ?? "" });
        }
      }
    } else if (!beforeOnLine.trim()) {
      result = result.slice(0, c.startIndex) + after.replace(/^[ \t]+/, "");
      touchedInlineRows.add(c.startRow);
      for (let r = c.startRow + 1; r <= c.endRow; r++) {
        if (!deletedOrigRows.has(r)) {
          deletedOrigRows.add(r);
          rowChanges.push({ origRow: r, kind: "deleted", origText: origLines[r] ?? "" });
        }
      }
    } else {
      const wsStart = before.search(/\s+$/);
      const codeEnd = wsStart !== -1 ? wsStart : c.startIndex;
      if (c.startRow !== c.endRow) {
        const lineEndOffset = after.indexOf("\n");
        const restOfEndRow = lineEndOffset !== -1 ? after.slice(0, lineEndOffset) : after;
        if (!restOfEndRow.trim()) {
          const crLen = restOfEndRow.endsWith("\r") ? 1 : 0;
          const afterTrimmed = lineEndOffset !== -1 ? after.slice(restOfEndRow.length - crLen) : "";
          result = result.slice(0, codeEnd) + afterTrimmed;
          touchedInlineRows.add(c.startRow);
          for (let r = c.startRow + 1; r <= c.endRow; r++) {
            if (!deletedOrigRows.has(r)) {
              deletedOrigRows.add(r);
              rowChanges.push({ origRow: r, kind: "deleted", origText: origLines[r] ?? "" });
            }
          }
        } else {
          const eol = c.text.includes("\r\n") ? "\r\n" : "\n";
          result = result.slice(0, codeEnd) + eol + after;
          touchedInlineRows.add(c.startRow);
          touchedInlineRows.add(c.endRow);
          for (let r = c.startRow + 1; r <= c.endRow - 1; r++) {
            if (!deletedOrigRows.has(r)) {
              deletedOrigRows.add(r);
              rowChanges.push({ origRow: r, kind: "deleted", origText: origLines[r] ?? "" });
            }
          }
        }
      } else {
        const cr = c.text.endsWith("\r") ? "\r" : "";
        const sep = (cr === "" && after.length > 0 && !/^\s/.test(after[0])) ? " " : cr;
        result = result.slice(0, codeEnd) + sep + after;
        touchedInlineRows.add(c.startRow);
      }
    }
  }

  // Emit exactly one rowChange per touched inline row, using final stripped text.
  const finalLines = result.split("\n");
  for (const row of touchedInlineRows) {
    if (deletedOrigRows.has(row)) continue;
    const deletedsBefore = rowChanges.filter(rc => rc.kind === "deleted" && rc.origRow < row).length;
    const remappedIndex = row - deletedsBefore;
    const fixedText = finalLines[remappedIndex] ?? "";
    rowChanges.push({ origRow: row, kind: "modified", origText: origLines[row] ?? "", fixedText });
  }

  return { text: result, rowChanges };
}



function hasAstErrors(node: Node): boolean {
  if (node.isError || node.isMissing) return true;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && hasAstErrors(child)) return true;
  }
  return false;
}

type RowChangeKind = "deleted" | "modified";
export interface RowChange { origRow: number; kind: RowChangeKind; origText: string; fixedText?: string }

export type AutoFixResult =
  | { ok: true; fixed: string; removed: number; removedTexts: string[]; kept: number; total: number; rowChanges: RowChange[] }
  | { ok: false; reason: string };


export function collectCodeText(root: Node, text: string, lang: Language): string {
  const parts: string[] = [];
  function walk(node: Node): void {
    if (isCommentNode(node, lang)) return;
    if (node.type === "jsx_expression" && node.namedChildCount === 1) {
      const nc = node.namedChild(0);
      if (nc && isCommentNode(nc, lang)) return;
    }
    if (node.childCount === 0) {
      parts.push(node.text ?? text.slice(node.startIndex, node.endIndex));
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walk(child);
    }
  }
  walk(root);
  return parts.join(" ");
}

export interface NetNewResult {
  /** 1-based new-file line numbers of unpaired added comment rows */
  rows: number[];
  /** total added comment rows across all hunks */
  added: number;
  /** total removed comment rows across all hunks */
  removed: number;
}

/** Strip comment markers and normalize line text for similarity comparison. */
function normForPairing(raw: string): string {
  return raw
    .replace(/^\s*(\/\/+|#|\/\*+|\*+\/|\*)\s?/, "")
    .replace(/\s*\*\/\s*$/, "")
    .toLowerCase()
    .trim();
}

/** Jaccard similarity of two token sets; two empty sets are identical. */
export function jaccard(ta: Set<string>, tb: Set<string>): number {
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/** Token-set Jaccard similarity on whitespace-split tokens. */
function tokenSetJaccard(a: string, b: string): number {
  return jaccard(new Set(a.split(/\s+/).filter(Boolean)), new Set(b.split(/\s+/).filter(Boolean)));
}

/**
 * Greedy pairing: pair each removed item with the most similar added item
 * (descending `sim`; tie-break by smallest `pos` distance). Returns the
 * added items left unpaired, in order.
 */
export function greedyPair<T>(
  removed: T[],
  added: T[],
  sim: (r: T, a: T) => number,
  pos: (t: T) => number,
): T[] {
  const candidates: Array<{ ri: number; ai: number; sim: number; dist: number }> = [];
  for (let ri = 0; ri < removed.length; ri++) {
    for (let ai = 0; ai < added.length; ai++) {
      candidates.push({ ri, ai, sim: sim(removed[ri], added[ai]), dist: Math.abs(pos(removed[ri]) - pos(added[ai])) });
    }
  }
  candidates.sort((a, b) => (b.sim !== a.sim ? b.sim - a.sim : a.dist - b.dist));
  const pairedRemoved = new Set<number>();
  const pairedAdded = new Set<number>();
  for (const { ri, ai } of candidates) {
    if (pairedRemoved.has(ri) || pairedAdded.has(ai)) continue;
    pairedRemoved.add(ri);
    pairedAdded.add(ai);
  }
  return added.filter((_, ai) => !pairedAdded.has(ai));
}

/**
 * Greedy similarity pairing: pair each removed comment row with the most
 * similar added comment row (descending similarity; tie-break by position
 * distance). Returns 1-based line numbers of added rows left unpaired
 * (i.e. net-new).
 *
 * Known limits: a new comment replacing a base comment in the same hunk
 * pairs as a reword (not counted); a zero-token-overlap reword can lose its
 * pairing to a higher-similarity new comment, flagging the reword row instead.
 * Both keep net-new count correct and never affect rows unchanged since base.
 */
function greedyPairCommentRows(
  removed: Array<{ lineNo: number; normText: string }>,
  added: Array<{ lineNo: number; normText: string }>,
): number[] {
  return greedyPair(removed, added, (r, a) => tokenSetJaccard(r.normText, a.normText), t => t.lineNo).map(a => a.lineNo);
}

export async function netNewCommentRows(
  baseText: string,
  postText: string,
  lang: Language,
  hunks: DiffHunk[],
  getParser: GetParserFn = defaultGetParser,
): Promise<{ ok: true } & NetNewResult | { ok: false; reason: string }> {
  const baseParsed = await findComments(baseText, lang, getParser);
  if (!baseParsed.ok) return { ok: false, reason: baseParsed.reason };
  const postParsed = await findComments(postText, lang, getParser);
  if (!postParsed.ok) return { ok: false, reason: postParsed.reason };

  // If errors overlap any hunk rows, refuse: caller uses density()
  for (const hunk of hunks) {
    if (hunk.added.some(ln => postParsed.errorRows.has(ln - 1))) {
      return { ok: false, reason: "parse-error-in-hunk" };
    }
    if (hunk.removedBaseLineNos.some(ln => baseParsed.errorRows.has(ln - 1))) {
      return { ok: false, reason: "parse-error-in-hunk" };
    }
  }

  const baseCommentLines = new Set<number>();
  for (const c of baseParsed.comments) {
    if (c.exempt) continue;
    for (let r = c.startRow; r <= c.endRow; r++) baseCommentLines.add(r + 1);
  }
  const postCommentLines = new Set<number>();
  for (const c of postParsed.comments) {
    if (c.exempt) continue;
    for (let r = c.startRow; r <= c.endRow; r++) postCommentLines.add(r + 1);
  }

  const postLines = postText.split("\n");

  const allUnpaired: number[] = [];
  let totalAdded = 0;
  let totalRemoved = 0;
  for (const hunk of hunks) {
    const addedCommentLineNos = hunk.added.filter(ln => postCommentLines.has(ln));

    // Collect removed comment items (text comes from hunk.removed, parallel to removedBaseLineNos)
    const removedItems: Array<{ lineNo: number; normText: string }> = [];
    for (let i = 0; i < hunk.removedBaseLineNos.length; i++) {
      const ln = hunk.removedBaseLineNos[i];
      if (!baseCommentLines.has(ln)) continue;
      removedItems.push({ lineNo: ln, normText: normForPairing(hunk.removed[i] ?? "") });
    }

    // Collect added comment items
    const addedItems = addedCommentLineNos.map(ln => ({
      lineNo: ln,
      normText: normForPairing(postLines[ln - 1] ?? ""),
    }));

    const unpairedRows = greedyPairCommentRows(removedItems, addedItems);
    allUnpaired.push(...unpairedRows);
    totalAdded += addedCommentLineNos.length;
    totalRemoved += removedItems.length;
  }
  return { ok: true, rows: allUnpaired, added: totalAdded, removed: totalRemoved };
}

export function isExemptProse(c: Comment): boolean {
  return c.exempt && URL_RE.test(stripMarkers(c.text));
}

const defaultRemovalGrouping: RemovalGrouping = {
  groups(comments, groupOf, _text): Comment[][] {
    const withGroup = comments
      .filter(c => (groupOf.get(c.startIndex) ?? null) !== null)
      .sort((a, b) => a.startRow - b.startRow);
    const groups: Comment[][] = [];
    let cur: Comment[] = [];
    let curGroupId: number | null = null;
    for (const c of withGroup) {
      const gid = groupOf.get(c.startIndex) ?? null;
      const prev = cur.length > 0 ? cur[cur.length - 1] : null;
      if (cur.length === 0 || gid !== curGroupId || (prev !== null && c.startRow !== prev.endRow + 1)) {
        if (cur.length > 0) groups.push(cur);
        cur = [c];
        curGroupId = gid;
      } else {
        cur.push(c);
      }
    }
    if (cur.length > 0) groups.push(cur);
    return groups;
  },

  protectedCandidates(candidates, groups, _comments, _text): Set<number> {
    const candIndices = new Set(candidates.map(c => c.startIndex));
    const result = new Set<number>();
    for (const group of groups) {
      if (!group.some(c => isExemptProse(c))) continue;
      for (const c of group) {
        if (candIndices.has(c.startIndex)) result.add(c.startIndex);
      }
    }
    return result;
  },

  units(removable, groups, _text): Comment[][] {
    const removableSet = new Set(removable.map(c => c.startIndex));
    const inGroup = new Set<number>();
    const orderedUnits: Array<{ startRow: number; comments: Comment[] }> = [];
    for (const group of groups) {
      const groupCands = group.filter(c => removableSet.has(c.startIndex));
      if (groupCands.length > 0) {
        orderedUnits.push({ startRow: groupCands[0].startRow, comments: groupCands });
        for (const c of groupCands) inGroup.add(c.startIndex);
      }
    }
    for (const c of removable) {
      if (!inGroup.has(c.startIndex)) {
        orderedUnits.push({ startRow: c.startRow, comments: [c] });
      }
    }
    orderedUnits.sort((a, b) => a.startRow - b.startRow);
    return orderedUnits.map(u => u.comments);
  },
};

function isDividerOrSpacer(c: Comment): boolean {
  return c.exempt && (c.exemptReason === "divider" || c.exemptReason === "spacer");
}

function isOnAddedRows(c: Comment, addedRows: Set<number>): boolean {
  for (let r = c.startRow; r <= c.endRow; r++) {
    if (!addedRows.has(r)) return false;
  }
  return true;
}

function extendRemovalWithDividers(
  toRemove: Comment[],
  allComments: Comment[],
  groups: Comment[][],
  addedRows: Set<number>,
  text: string,
): Comment[] {
  if (toRemove.length === 0) return toRemove;
  const allGroups = groups;
  const removeSet = new Set(toRemove.map(c => c.startIndex));

  for (const group of allGroups) {
    if (!group.some(c => removeSet.has(c.startIndex))) continue;
    const remaining = group.filter(c => !removeSet.has(c.startIndex));
    if (remaining.length === 0) continue;
    if (remaining.every(c => isDividerOrSpacer(c) && isOnAddedRows(c, addedRows))) {
      for (const c of remaining) removeSet.add(c.startIndex);
    }
  }

  const textLines = text.split("\n");
  let changed = true;
  while (changed) {
    changed = false;
    const removedRows = new Set<number>();
    for (const c of allComments) {
      if (removeSet.has(c.startIndex)) {
        for (let r = c.startRow; r <= c.endRow; r++) removedRows.add(r);
      }
    }
    for (const group of allGroups) {
      if (group.some(c => removeSet.has(c.startIndex))) continue;
      if (!group.every(c => isDividerOrSpacer(c) && isOnAddedRows(c, addedRows))) continue;
      const firstRow = group[0].startRow;
      const lastRow = group[group.length - 1].endRow;
      let adjacent = false;
      let r = lastRow + 1;
      while (r < textLines.length && textLines[r].trim() === "") r++;
      if (r < textLines.length && removedRows.has(r)) adjacent = true;
      if (!adjacent) {
        r = firstRow - 1;
        while (r >= 0 && textLines[r].trim() === "") r--;
        if (r >= 0 && removedRows.has(r)) adjacent = true;
      }
      if (adjacent) {
        for (const c of group) removeSet.add(c.startIndex);
        changed = true;
      }
    }
  }

  return allComments.filter(c => removeSet.has(c.startIndex));
}

export async function autoFix(
  text: string,
  lang: Language,
  addedRows: Set<number>,
  getParser?: GetParserFn,
  netNewRows?: Set<number>,
  opts?: { maxAllowedRows?: number },
): Promise<AutoFixResult> {
  getParser ??= defaultGetParser;
  const origParsed = await findClassifiedComments(text, lang, getParser);
  if (!origParsed.ok) return { ok: false, reason: `parse: ${origParsed.reason}` };
  const { groupOf } = origParsed;

  const candidates: Comment[] = [];
  for (const c of origParsed.comments) {
    if (c.exempt) continue;
    let overlapsError = false;
    for (let r = c.startRow; r <= c.endRow; r++) {
      if (origParsed.errorRows.has(r)) { overlapsError = true; break; }
    }
    if (overlapsError) continue;
    const rowSet = netNewRows ?? addedRows;
    let allAdded = true;
    for (let r = c.startRow; r <= c.endRow; r++) {
      if (!rowSet.has(r)) { allAdded = false; break; }
    }
    if (allAdded) candidates.push(c);
  }

  function commentRowCount(c: Comment): number {
    return c.endRow - c.startRow + 1;
  }

  const totalCandidateRows = candidates.reduce((sum, c) => sum + commentRowCount(c), 0);
  const maxAllowedRows = opts?.maxAllowedRows ?? Math.floor(0.05 * addedRows.size);

  if (totalCandidateRows <= maxAllowedRows) {
    return { ok: true, fixed: text, removed: 0, removedTexts: [], kept: candidates.length, total: candidates.length, rowChanges: [] };
  }

  const candidateSet = new Set(candidates.map(c => c.startIndex));
  let extraEffective = 0;
  for (const c of origParsed.comments) {
    if (c.exempt) continue;
    if (candidateSet.has(c.startIndex)) continue;
    for (let r = c.startRow; r <= c.endRow; r++) {
      if (addedRows.has(r)) extraEffective++;
    }
  }

  const hook = languageHookFor(lang);
  const grouping = hook.removalGrouping ?? defaultRemovalGrouping;
  const groups = grouping.groups(origParsed.comments, groupOf, text);
  const protectedIndices = grouping.protectedCandidates(candidates, groups, origParsed.comments, text);
  const protectedCands = candidates.filter(c => protectedIndices.has(c.startIndex));
  const removableCands = candidates.filter(c => !protectedIndices.has(c.startIndex));
  const protectedRowCount = protectedCands.reduce((s, c) => s + commentRowCount(c), 0);

  const units: Comment[][] = [...grouping.units(removableCands, groups, text)];

  units.sort((a, b) => {
    const ra = a.reduce((s, c) => s + commentRowCount(c), 0);
    const rb = b.reduce((s, c) => s + commentRowCount(c), 0);
    return ra !== rb ? ra - rb : a[0].startRow - b[0].startRow;
  });

  let keptRows = protectedRowCount;
  const keptUnitIndices: number[] = [];
  for (let i = 0; i < units.length; i++) {
    const rows = units[i].reduce((s, c) => s + commentRowCount(c), 0);
    if (keptRows + rows <= maxAllowedRows) {
      keptRows += rows;
      keptUnitIndices.push(i);
    }
  }

  const keptSet = new Set(keptUnitIndices);
  while (true) {
    const removedCands = units.filter((_, i) => !keptSet.has(i)).flat();
    const wlRemovedRows = stripComments(text, removedCands).rowChanges.filter(
      rc => rc.kind === "deleted" && addedRows.has(rc.origRow),
    ).length;
    const remappedSize = addedRows.size - wlRemovedRows;
    const densityOk = opts?.maxAllowedRows !== undefined
      ? keptRows + extraEffective <= maxAllowedRows
      : (remappedSize <= 0 || (keptRows + extraEffective) / remappedSize * 100 <= 5);
    if (densityOk) break;
    if (keptUnitIndices.length === 0) {
      return { ok: false, reason: "still over cap after fix" };
    }
    // Drop the longest kept group first (last in shortest-first order).
    const lastKept = keptUnitIndices.pop()!;
    keptSet.delete(lastKept);
    keptRows -= units[lastKept].reduce((s, c) => s + commentRowCount(c), 0);
  }

  const toRemove = units.filter((_, i) => !keptSet.has(i)).flat();
  const toRemoveFinal = extendRemovalWithDividers(
    toRemove,
    origParsed.comments,
    groups,
    addedRows,
    text,
  );
  const stripped = stripComments(text, toRemoveFinal);
  const { rowChanges } = stripped;

  const fixed = hook.repairAfterStrip
    ? hook.repairAfterStrip(text, stripped.text, rowChanges)
    : stripped.text;

  const fp = await findComments(fixed, lang, getParser);
  if (!fp.ok) return { ok: false, reason: `post-strip parse: ${fp.reason}` };

  const pr = await getParser(lang);
  if (!pr.ok) return { ok: false, reason: `parser: ${pr.reason}` };
  const loaded = async () => pr;
  const o = await parseText(text, lang, loaded);
  if (!o.ok) return { ok: false, reason: `parser: ${o.reason}` };
  const f = await parseText(fixed, lang, loaded);
  if (!f.ok) { o.tree.delete(); return { ok: false, reason: `parser: ${f.reason}` }; }
  const origHasErr = hasAstErrors(o.tree.rootNode);
  const fixedHasErr = hasAstErrors(f.tree.rootNode);
  const origCode = collectCodeText(o.tree.rootNode, text, lang);
  const fixedCode = collectCodeText(f.tree.rootNode, fixed, lang);
  o.tree.delete();
  f.tree.delete();
  if (!origHasErr && fixedHasErr) {
    return { ok: false, reason: "fix introduced parse errors" };
  }
  if (origCode !== fixedCode) return { ok: false, reason: "code content changed" };

  const preMap = new Map<string, number>();
  for (const c of origParsed.comments) {
    let onAdded = false;
    for (let r = c.startRow; r <= c.endRow && !onAdded; r++) onAdded = addedRows.has(r);
    if (!onAdded) preMap.set(c.text, (preMap.get(c.text) ?? 0) + 1);
  }
  const fixedMap = new Map<string, number>();
  for (const c of fp.comments) fixedMap.set(c.text, (fixedMap.get(c.text) ?? 0) + 1);
  for (const [t, cnt] of preMap) {
    if ((fixedMap.get(t) ?? 0) < cnt) return { ok: false, reason: "pre-existing comment removed" };
  }

  const keptUnits = units.filter((_, i) => keptSet.has(i)).flat().length;
  return { ok: true, fixed, removed: toRemove.length, removedTexts: toRemove.map(c => c.text), kept: keptUnits + protectedCands.length, total: candidates.length, rowChanges };
}

export async function density(
  text: string,
  lang: Language,
  rows?: Set<number>,
  getParser: GetParserFn = defaultGetParser,
): Promise<DensityResult> {
  const lines = text.split("\n");
  const total = rows ? rows.size : lines.length;

  const parsed = await findComments(text, lang, getParser);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };

  const commentRowSet = new Set<number>();
  for (const c of parsed.comments) {
    if (c.exempt) continue;
    for (let r = c.startRow; r <= c.endRow; r++) {
      if (!rows || rows.has(r)) commentRowSet.add(r);
    }
  }
  const commentRows = [...commentRowSet].sort((a, b) => a - b);
  return { ok: true, total, effective: commentRows.length, commentRows, errorRows: parsed.errorRows };
}
