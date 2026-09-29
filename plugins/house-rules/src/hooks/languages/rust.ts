import type { Node } from "../lib/tree-sitter.js";
import type { RawComment } from "./parse.js";
import {
  type ClassifiedComment,
  type CommentClassifier,
  defaultClassifyComments,
} from "./comments.js";
import { RUST_TOOL_MARKERS, withToolMarkers } from "./tool-markers.js";

/**
 * Classifies Rust doc comments per the Reference:
 *   outer doc comments  ///  (rustref section doc-comments, outer)
 *   inner doc comments  //!  (rustref section doc-comments, inner)
 *   block inner docs    /*! ... * /  (rustref section doc-comments, inner block)
 *   block outer docs    /** ... * /  (but not /*** or the empty comment)
 * Four slashes (////) and three-plus stars (/***) are ordinary comments.
 */
function isRustDocComment(text: string): boolean {
  const t = text.trimStart();
  return (
    (t.startsWith("///") && (t.length === 3 || t[3] !== "/")) ||
    t.startsWith("//!") ||
    t.startsWith("/*!") ||
    (t.startsWith("/**") && t[3] !== "*" && t[3] !== "/")
  );
}

/** Classifies Rust comments, promoting doc-comment variants to kind "doc". */
const classifyRustDocs: CommentClassifier = (
  raw: readonly RawComment[],
  root: Node,
  text: string,
): ClassifiedComment[] =>
  defaultClassifyComments(raw, root, text).map((c) =>
    isRustDocComment(c.text) ? { ...c, kind: "doc", label: "rust-doc" } : c,
  );

export const classifyRustComments: CommentClassifier = withToolMarkers(
  RUST_TOOL_MARKERS,
  classifyRustDocs,
);
