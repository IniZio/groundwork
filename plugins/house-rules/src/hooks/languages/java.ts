import type { Node } from "../lib/tree-sitter.js";
import type { RawComment } from "./parse.js";
import {
  type ClassifiedComment,
  type CommentClassifier,
  defaultClassifyComments,
} from "./comments.js";

/** Classifies Java comments, marking pre-package/pre-declaration comments as headers. */
export const classifyJavaComments: CommentClassifier = (
  raw: readonly RawComment[],
  root: Node,
  text: string,
): ClassifiedComment[] => {
  let cutoffRow: number | null = null;
  for (let i = 0; i < root.childCount; i++) {
    const child = root.child(i);
    if (!child) continue;
    if (child.type === "package_declaration") {
      cutoffRow = child.startPosition.row;
      break;
    }
    if (child.type !== "line_comment" && child.type !== "block_comment") {
      cutoffRow = child.startPosition.row;
      break;
    }
  }

  return defaultClassifyComments(raw, root, text).map((c) => ({
    ...c,
    header: cutoffRow !== null && c.endRow < cutoffRow,
  }));
};
