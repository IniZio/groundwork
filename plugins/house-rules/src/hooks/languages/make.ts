import type { Node } from "../lib/tree-sitter.js";
import type { RawComment } from "./parse.js";
import {
  type ClassifiedComment,
  type CommentClassifier,
  defaultClassifyComments,
} from "./comments.js";

const DEFINE_RE = /^[ \t]*(?:(?:override|export|private)[ \t]+)*define\b/;
const ENDEF_RE = /^[ \t]*endef\b/;

/** Row ranges (inclusive) of `define ... endef` bodies; the body is data Make hands to a shell or eval. */
function defineRanges(lines: readonly string[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (DEFINE_RE.test(lines[i])) {
      if (depth === 0) start = i;
      depth++;
    } else if (depth > 0 && ENDEF_RE.test(lines[i])) {
      depth--;
      if (depth === 0) out.push([start, i]);
    }
  }
  if (depth > 0) out.push([start, lines.length - 1]);
  return out;
}

function endsWithOddBackslashes(line: string): boolean {
  const m = /\\+$/.exec(line);
  return m !== null && m[0].length % 2 === 1;
}

function unsafeReason(c: RawComment, lines: readonly string[], text: string, defines: Array<[number, number]>): string | null {
  const line = lines[c.startRow] ?? "";
  if (defines.some(([s, e]) => c.startRow >= s && c.startRow <= e)) return "make-define-body";
  if (line.startsWith("\t")) return "make-recipe-line";
  if (c.startRow > 0 && endsWithOddBackslashes(lines[c.startRow - 1] ?? "")) return "make-continuation";
  if (endsWithOddBackslashes(lines[c.endRow] ?? "")) return "make-continuation";
  if (c.startIndex > 0 && text[c.startIndex - 1] === "\\") return "make-escaped-hash";
  return null;
}

/** Marks comments Make (or the shell it spawns) reads as content, so no rule removes them. */
export const classifyMakeComments: CommentClassifier = (
  raw: readonly RawComment[],
  root: Node,
  text: string,
): ClassifiedComment[] => {
  const lines = text.split("\n");
  const defines = defineRanges(lines);
  return defaultClassifyComments(raw, root, text).map((c) => {
    if (c.directive) return c;
    const reason = unsafeReason(c, lines, text, defines);
    return reason === null ? c : { ...c, directive: true, label: reason };
  });
};
