import type { Node } from "../lib/tree-sitter.js";
import type { RawComment } from "./parse.js";
import {
  type ClassifiedComment,
  type CommentClassifier,
  commentInnerText,
  isWholeLine,
  baseKind,
  groupWholeLineComments,
} from "./comments.js";

const GO_DOC_DECL_TYPES = new Set([
  "package_clause",
  "function_declaration",
  "method_declaration",
  "type_declaration",
  "type_spec",
  "const_declaration",
  "const_spec",
  "var_declaration",
  "var_spec",
  "field_declaration",
  "method_elem",
  "type_elem",
]);

function isGoDocComment(node: Node, text: string): boolean {
  if (!isWholeLine(text, node.startIndex)) return false;
  let cur: Node | null = node;
  while (cur !== null) {
    const next: Node | null = cur.nextNamedSibling;
    if (!next) return false;
    if (GO_DOC_DECL_TYPES.has(next.type)) {
      return next.startPosition.row === cur.endPosition.row + 1;
    }
    if (next.type === "comment" && next.startPosition.row === cur.endPosition.row + 1) {
      if (!isWholeLine(text, next.startIndex)) return false;
      cur = next;
    } else {
      return false;
    }
  }
  return false;
}

// Go directive patterns (matched against stripped inner text)
const GO_DIRECTIVE_RE = /^go:/;
const GO_BUILD_CONSTRAINT_RE = /^\+build\b/;
const GO_NOLINT_RE = /^nolint\b/;
const GO_LINT_IGNORE_RE = /^lint:(ignore|file-ignore)\b/;
const GO_KUBEBUILDER_MARKER_RE = /^\+[a-z][\w.-]*:/;
const GO_EXPORT_RE = /^export\b/;
const GO_LINE_RE = /^line\b/;
// gccgo external function declaration (no space after //)
const GO_EXTERN_RE = /^extern\b/;
// generic Go tool directive: //toolname:directive (no space, matches go/doc isDirective)
const GO_TOOL_DIRECTIVE_RE = /^[a-z][a-z0-9]*:[a-z0-9]/;

function isGoDirectiveLine(inner: string, rawLine: string): boolean {
  if (
    GO_DIRECTIVE_RE.test(inner) ||
    GO_BUILD_CONSTRAINT_RE.test(inner) ||
    GO_NOLINT_RE.test(inner) ||
    GO_LINT_IGNORE_RE.test(inner) ||
    GO_KUBEBUILDER_MARKER_RE.test(inner)
  ) return true;
  const noSpaceAfterSlash = /^\/\/[^ ]/.test(rawLine.trimStart());
  const isBlockLine = /^\/\*line\b/.test(rawLine.trimStart());
  if (noSpaceAfterSlash && GO_EXPORT_RE.test(inner)) return true;
  if ((noSpaceAfterSlash || isBlockLine) && GO_LINE_RE.test(inner)) return true;
  if (noSpaceAfterSlash && GO_EXTERN_RE.test(inner)) return true;
  if (noSpaceAfterSlash && GO_TOOL_DIRECTIVE_RE.test(inner)) return true;
  return false;
}

function isGoDirective(c: RawComment): boolean {
  const lines = c.text.split("\n");
  const nonBlank = lines.filter(l => commentInnerText(l) !== "");
  return nonBlank.length > 0 && nonBlank.every(l => isGoDirectiveLine(commentInnerText(l), l));
}

export const classifyGoComments: CommentClassifier = (
  raw: readonly RawComment[],
  root: Node,
  text: string,
): ClassifiedComment[] => {
  // Build a map from startIndex to Node for comment nodes
  const nodeMap = new Map<number, Node>();
  function walk(node: Node): void {
    if (node.type === "comment") {
      nodeMap.set(node.startIndex, node);
      return; // do not descend into comments
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walk(child);
    }
  }
  walk(root);

  // Find package clause row from direct children of root
  let packageRow: number | null = null;
  for (let i = 0; i < root.childCount; i++) {
    const child = root.child(i);
    if (child && child.type === "package_clause") {
      packageRow = child.startPosition.row;
      break;
    }
  }

  const groups = groupWholeLineComments(raw, text, () => true);

  return raw.map((c, i) => {
    const node = nodeMap.get(c.startIndex);
    const isDoc = node ? isGoDocComment(node, text) : false;
    const kind = isDoc ? "doc" : baseKind(c.text);
    const header = packageRow !== null && c.endRow < packageRow;
    const directive = isGoDirective(c);

    return {
      ...c,
      kind,
      directive,
      header,
      group: groups[i],
    };
  });
};
