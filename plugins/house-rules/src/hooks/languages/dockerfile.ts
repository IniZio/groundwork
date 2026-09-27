import type { Node } from "../lib/tree-sitter.js";
import type { RawComment } from "./parse.js";
import {
  type ClassifiedComment,
  type CommentClassifier,
  commentInnerText,
  defaultClassifyComments,
} from "./comments.js";

// Row-0 only: real Docker accepts consecutive leading directives, but widening is a separate change.
const DOCKERFILE_DIRECTIVE_RE = /^(?:syntax|escape)=/i;

function isParserDirective(c: ClassifiedComment): boolean {
  if (c.startRow !== 0) return false;
  const lines = c.text.split("\n");
  for (const line of lines) {
    const inner = commentInnerText(line);
    if (inner !== "") {
      return DOCKERFILE_DIRECTIVE_RE.test(inner);
    }
  }
  return false;
}

export const classifyDockerfileComments: CommentClassifier = (
  raw: readonly RawComment[],
  root: Node,
  text: string,
): ClassifiedComment[] =>
  defaultClassifyComments(raw, root, text).map((c) =>
    isParserDirective(c)
      ? { ...c, directive: true, label: "dockerfile-directive" }
      : c,
  );
