// @ts-nocheck
// conformance: comments=18 directive=0 doc=8 groups=13
// source: plugins/house-rules/src/hooks/languages/comments.ts (HEAD 9a8ab9b) lines 1-139
// source: plugins/house-rules/src/hooks/gate.ts (HEAD 9a8ab9b) lines 44-50
import type { Node } from "../lib/tree-sitter.js";
import type { RawComment } from "./parse.js";

export type CommentKind = "line" | "block" | "doc";

export interface ClassifiedComment extends RawComment {
  /** doc = the language attaches it to a declaration as documentation */
  kind: CommentKind;
  /** a compiler/runtime/tool reads it; no rule removes one */
  directive: boolean;
  /** file-header comment (e.g. Go: ends before the package clause) */
  header: boolean;
  /** comment-group id; null = trailing comment (shares its line with code), in no group */
  group: number | null;
  /** names why kind is "doc" or directive is true (e.g. "rust-doc", "shebang"); comment-density reports it as the exemption reason */
  label?: string;
  /**
   * directive reason used only when nothing else exempts the comment (label, lint/URL markers, doc,
   * header); set together with directive: true. comment-density checks it last and ignores `directive`
   * for such comments.
   */
  fallbackLabel?: string;
}

/** Returns one entry per raw comment, same order and same length as `raw`. */
export type CommentClassifier = (
  raw: readonly RawComment[],
  root: Node,
  text: string,
) => ClassifiedComment[];

export function commentInnerText(line: string): string {
  let t = line.trim();
  if (t.startsWith("/**")) t = t.slice(3);
  else if (t.startsWith("/*")) t = t.slice(2);
  else if (t.startsWith("//")) t = t.slice(2);
  else if (t.startsWith("#")) t = t.slice(1);
  if (t.endsWith("*/")) t = t.slice(0, -2);
  t = t.replace(/^\s*\*\s?/, "");
  return t.trim();
}

export function isWholeLine(text: string, startIndex: number): boolean {
  return !text.slice(text.lastIndexOf("\n", startIndex - 1) + 1, startIndex).trim();
}

export function baseKind(text: string): "line" | "block" {
  return text.trimStart().startsWith("/*") ? "block" : "line";
}

export function groupWholeLineComments(
  raw: readonly RawComment[],
  text: string,
  joins: (prev: RawComment, next: RawComment) => boolean,
): (number | null)[] {
  // Collect whole-line comments with their original indices
  const wholeLineEntries: Array<{ idx: number; comment: RawComment }> = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (isWholeLine(text, c.startIndex)) {
      wholeLineEntries.push({ idx: i, comment: c });
    }
  }

  // Sort by startRow (stable by insertion order for same row)
  wholeLineEntries.sort((a, b) => a.comment.startRow - b.comment.startRow);

  // Assign group ids
  const groupById = new Map<number, number | null>(); // original index -> group id
  let nextGroup = 0;
  let currentGroup = -1;
  let prev: RawComment | null = null;

  for (const { idx, comment } of wholeLineEntries) {
    if (prev === null || !(comment.startRow === prev.endRow + 1 && joins(prev, comment))) {
      currentGroup = nextGroup++;
    }
    groupById.set(idx, currentGroup);
    prev = comment;
  }

  // Build result aligned to input order
  const result: (number | null)[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (groupById.has(i)) {
      result.push(groupById.get(i)!);
    } else {
      result.push(null);
    }
  }
  return result;
}

export function isShebangComment(c: RawComment): boolean {
  return c.startRow === 0 && c.text.trim().startsWith("#!");
}

export function isJsDocBlock(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith("/**") && !t.startsWith("/***");
}

export function defaultIsCommentNodeType(type: string): boolean {
  return type.includes("comment");
}

/**
 * Cross-language conventions applied after every adapter's classifier
 * (today they apply to every language; scoping them is later work).
 */
export function applyCommonConventions(cs: readonly ClassifiedComment[]): ClassifiedComment[] {
  return cs.map((c) => {
    if (c.directive && c.label !== undefined) return c;
    if (isShebangComment(c)) return { ...c, directive: true, label: "shebang" };
    if (c.nodeType.includes("doc")) return { ...c, kind: "doc", label: "doc-comment" };
    if (isJsDocBlock(c.text)) return { ...c, kind: "doc", label: "jsdoc" };
    return c;
  });
}

export const defaultClassifyComments: CommentClassifier = (
  raw: readonly RawComment[],
  _root: Node,
  text: string,
): ClassifiedComment[] => {
  const groups = groupWholeLineComments(
    raw,
    text,
    (a, b) => baseKind(a.text) === baseKind(b.text),
  );
  return raw.map((c, i) => ({
    ...c,
    kind: baseKind(c.text),
    directive: false,
    header: false,
    group: groups[i],
  }));
};
function readCounter(p: string): CounterState {
  try { return JSON.parse(readFileSync(p, "utf8")) as CounterState; } catch { return { sig: "", count: 0 }; }
}

function writeCounter(p: string, state: CounterState): void {
  try { writeFileSync(p, JSON.stringify(state)); } catch { /* fail-open */ }
}
