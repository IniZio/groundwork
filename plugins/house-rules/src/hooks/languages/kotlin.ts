import type { Node } from "../lib/tree-sitter.js";
import type { RawComment } from "./parse.js";
import {
  type ClassifiedComment,
  type CommentClassifier,
  defaultClassifyComments,
} from "./comments.js";

/** Classifies Kotlin comments, marking pre-package/pre-file-annotation comments as headers. */
export const classifyKotlinComments: CommentClassifier = (
  raw: readonly RawComment[],
  root: Node,
  text: string,
): ClassifiedComment[] => {
  // Find the first package_header or file_annotation among direct children
  let cutoffRow: number | null = null;
  for (let i = 0; i < root.childCount; i++) {
    const child = root.child(i);
    if (child && (child.type === "package_header" || child.type === "file_annotation")) {
      cutoffRow = child.startPosition.row;
      break;
    }
  }

  return defaultClassifyComments(raw, root, text).map((c) => ({
    ...c,
    header: cutoffRow !== null && c.endRow < cutoffRow,
  }));
};
