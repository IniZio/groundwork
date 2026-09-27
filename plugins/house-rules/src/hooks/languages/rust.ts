import type { Node } from "../lib/tree-sitter.js";
import type { RawComment } from "./parse.js";
import {
  type ClassifiedComment,
  type CommentClassifier,
  defaultClassifyComments,
} from "./comments.js";

/**
 * Classifies Rust doc comments per the Reference:
 *   outer doc comments  ///  (rustref section doc-comments, outer)
 *   inner doc comments  //!  (rustref section doc-comments, inner)
 *   block inner docs    /*! ... * /  (rustref section doc-comments, inner block)
 */
function isRustDocComment(text: string): boolean {
  const t = text.trimStart();
  return (
    (t.startsWith("///") && (t.length === 3 || t[3] !== "/")) ||
    t.startsWith("//!") ||
    (t.startsWith("/*!") && !t.startsWith("/***"))
  );
}

/** Classifies Rust comments, promoting doc-comment variants to kind "doc". */
export const classifyRustComments: CommentClassifier = (
  raw: readonly RawComment[],
  root: Node,
  text: string,
): ClassifiedComment[] =>
  defaultClassifyComments(raw, root, text).map((c) =>
    isRustDocComment(c.text) ? { ...c, kind: "doc", label: "rust-doc" } : c,
  );
