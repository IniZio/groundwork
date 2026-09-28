import type { Node } from "../lib/tree-sitter.js";
import type { RawComment } from "./parse.js";
import {
  type ClassifiedComment,
  type CommentClassifier,
  defaultClassifyComments,
} from "./comments.js";
import { SWIFT_TOOL_MARKERS, withToolMarkers } from "./tool-markers.js";

function isSwiftDocComment(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith("///") && (t.length === 3 || t[3] !== "/");
}

const baseSwiftClassifier: CommentClassifier = (
  raw: readonly RawComment[],
  root: Node,
  text: string,
): ClassifiedComment[] => {
  const classified = defaultClassifyComments(raw, root, text);

  const headerStartRow = text.startsWith("#!") ? 1 : 0;

  let headerGroupId: number | null = null;
  for (const c of classified) {
    if (c.group !== null && c.startRow === headerStartRow) {
      headerGroupId = c.group;
      break;
    }
  }

  return classified.map((c) => {
    let result = c;

    if (isSwiftDocComment(c.text)) {
      result = { ...result, kind: "doc", label: "swift-doc" };
    }

    if (headerGroupId !== null && c.group === headerGroupId) {
      result = { ...result, header: true };
    }

    return result;
  });
};

export const classifySwiftComments: CommentClassifier = withToolMarkers(
  SWIFT_TOOL_MARKERS,
  baseSwiftClassifier,
);
