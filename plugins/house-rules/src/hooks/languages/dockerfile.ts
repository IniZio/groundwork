import type { Node } from "../lib/tree-sitter.js";
import type { RawComment } from "./parse.js";
import type { RowChange } from "../lib/comment-density.js";
import {
  type ClassifiedComment,
  type CommentClassifier,
  commentInnerText,
  defaultClassifyComments,
} from "./comments.js";
import { withToolMarkers } from "./tool-markers.js";

// Docker reads parser directives only in the leading run of consecutive `# key=value` lines.
const DOCKERFILE_DIRECTIVE_RE = /^(?:syntax|escape|check)=/i;

export const DOCKERFILE_TOOL_MARKERS: readonly RegExp[] = [
  /^hadolint\s+(?:ignore|shell)\s*=/,
  /^hadolint\s+global\s+\w+\s*=/,
  /^checkov:skip=/,
];

function isDirectiveLine(c: ClassifiedComment): boolean {
  if (c.startRow !== c.endRow) return false;
  return DOCKERFILE_DIRECTIVE_RE.test(commentInnerText(c.text));
}

const classifyLeadingDirectives: CommentClassifier = (
  raw: readonly RawComment[],
  root: Node,
  text: string,
): ClassifiedComment[] => {
  let nextRow = 0;
  let chain = true;
  return defaultClassifyComments(raw, root, text).map((c) => {
    if (chain && c.startRow === nextRow && isDirectiveLine(c)) {
      nextRow++;
      return { ...c, directive: true, label: "dockerfile-directive" };
    }
    chain = false;
    return c;
  });
};

export const classifyDockerfileComments: CommentClassifier = withToolMarkers(
  DOCKERFILE_TOOL_MARKERS,
  classifyLeadingDirectives,
);

// The grammar drops the blank line that follows a comment from its code tokens, so stripping a
// comment run must also drop the blank row right after it or the code-content check rejects the fix.
export function dropBlankAfterRemovedRun(
  original: string,
  stripped: string,
  rowChanges: readonly RowChange[],
): string {
  const origLines = original.split("\n");
  const strippedLines = stripped.split("\n");
  const deleted = new Set(rowChanges.filter((r) => r.kind === "deleted").map((r) => r.origRow));
  const out: string[] = [];
  let j = 0;
  for (let i = 0; i < origLines.length; i++) {
    if (deleted.has(i)) continue;
    const line = strippedLines[j++];
    const followsRun = i > 0 && deleted.has(i - 1);
    if (followsRun && origLines[i].trim() === "" && i < origLines.length - 1) continue;
    out.push(line);
  }
  return out.join("\n");
}
