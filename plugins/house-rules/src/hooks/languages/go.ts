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

const GO_OUTPUT_RE = /^(?:unordered )?output:/i;

function importDeclHasCImport(decl: Node): boolean {
  let cur: Node | null = decl.firstNamedChild;
  while (cur) {
    if (cur.type === "import_spec") {
      const pathNode = cur.childForFieldName ? cur.childForFieldName("path") : null;
      if (pathNode && (pathNode.text === '"C"' || pathNode.text === "`C`")) return true;
    } else if (cur.type === "interpreted_string_literal" && cur.text === '"C"') {
      return true;
    }
    if (cur.type === "import_spec_list") {
      if (importDeclHasCImport(cur)) return true;
    }
    cur = cur.nextNamedSibling;
  }
  return false;
}

function isGoCgoComment(node: Node): boolean {
  let cur: Node = node;
  let next: Node | null = node.nextNamedSibling;
  while (next && next.type === "comment") {
    if (next.startPosition.row !== cur.endPosition.row + 1) return false;
    cur = next;
    next = next.nextNamedSibling;
  }
  if (!next) return false;
  if (next.startPosition.row !== cur.endPosition.row + 1) return false;
  if (next.type === "import_declaration") {
    return importDeclHasCImport(next);
  }
  if (next.type === "import_spec") {
    const pathNode = next.childForFieldName ? next.childForFieldName("path") : null;
    return pathNode !== null && (pathNode.text === '"C"' || pathNode.text === "`C`");
  }
  return false;
}

function findGoCgoPreambleSlashRows(root: Node): Set<number> {
  const result = new Set<number>();
  const slashByRow = new Map<number, boolean>();

  function collectSlash(node: Node): void {
    if (node.type === "comment" && node.text.startsWith("//")) {
      slashByRow.set(node.startPosition.row, true);
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) collectSlash(child);
    }
  }
  collectSlash(root);

  function findCSpecRowInList(list: Node): number | null {
    let cur: Node | null = list.firstNamedChild;
    while (cur) {
      if (cur.type === "import_spec") {
        const p = cur.childForFieldName ? cur.childForFieldName("path") : null;
        if (p && (p.text === '"C"' || p.text === "`C`")) return cur.startPosition.row;
      }
      cur = cur.nextNamedSibling;
    }
    return null;
  }

  function isCImport(node: Node): { found: boolean; specListNode?: Node } {
    let cur: Node | null = node.firstNamedChild;
    while (cur) {
      if (cur.type === "import_spec") {
        const p = cur.childForFieldName ? cur.childForFieldName("path") : null;
        if (p && (p.text === '"C"' || p.text === "`C`")) return { found: true };
      } else if (cur.type === "interpreted_string_literal" && cur.text === '"C"') {
        return { found: true };
      } else if (cur.type === "import_spec_list") {
        const specRow = findCSpecRowInList(cur);
        if (specRow !== null) return { found: true, specListNode: cur };
      }
      cur = cur.nextNamedSibling;
    }
    return { found: false };
  }

  function findCImports(node: Node): void {
    if (node.type === "import_declaration") {
      const check = isCImport(node);
      if (check.found) {
        let row = node.startPosition.row - 1;
        while (row >= 0 && slashByRow.has(row)) {
          result.add(row);
          row--;
        }
        if (check.specListNode) {
          const cSpecRow = findCSpecRowInList(check.specListNode);
          if (cSpecRow !== null) {
            let r = cSpecRow - 1;
            while (r > node.startPosition.row && slashByRow.has(r)) {
              result.add(r);
              r--;
            }
          }
        }
      }
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) findCImports(child);
    }
  }
  findCImports(root);
  return result;
}

function findGoExampleOutputRows(root: Node): Set<number> {
  const result = new Set<number>();
  const allCommentsByRow = new Map<number, { text: string; endRow: number }>();

  function collectAll(node: Node): void {
    if (node.type === "comment") {
      allCommentsByRow.set(node.startPosition.row, { text: node.text, endRow: node.endPosition.row });
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) collectAll(child);
    }
  }
  collectAll(root);

  function findExampleFuncs(node: Node): void {
    if (node.type === "function_declaration") {
      const nameNode = node.childForFieldName ? node.childForFieldName("name") : null;
      if (nameNode && /^Example/.test(nameNode.text)) {
        const bodyNode = node.childForFieldName ? node.childForFieldName("body") : null;
        if (bodyNode) {
          const startRow = bodyNode.startPosition.row;
          const endRow = bodyNode.endPosition.row;
          let outputRow: number | null = null;
          let outputEndRow = 0;
          for (let row = startRow; row <= endRow; row++) {
            const entry = allCommentsByRow.get(row);
            if (entry !== undefined && GO_OUTPUT_RE.test(commentInnerText(entry.text))) {
              outputRow = row;
              outputEndRow = entry.endRow;
              break;
            }
          }
          if (outputRow !== null) {
            for (let r = outputRow; r <= outputEndRow; r++) result.add(r);
            let row = outputEndRow + 1;
            while (row <= endRow && allCommentsByRow.has(row) && allCommentsByRow.get(row)!.text.startsWith("//")) {
              result.add(row);
              row++;
            }
          }
        }
      }
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) findExampleFuncs(child);
    }
  }
  findExampleFuncs(root);
  return result;
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
  const cgoRows = findGoCgoPreambleSlashRows(root);
  const exampleRows = findGoExampleOutputRows(root);

  return raw.map((c, i) => {
    const node = nodeMap.get(c.startIndex);
    const isDoc = node ? isGoDocComment(node, text) : false;
    const kind = isDoc ? "doc" : baseKind(c.text);
    const header = packageRow !== null && c.endRow < packageRow;
    const ownDirective = isGoDirective(c);

    let directive: boolean;
    let label: string | undefined;
    let fallbackLabel: string | undefined;

    if (node && (c.text.startsWith("/*") || c.text.startsWith("//")) && isGoCgoComment(node)) {
      directive = true;
      label = "cgo-preamble";
    } else if (!ownDirective && c.text.startsWith("//") && cgoRows.has(c.startRow)) {
      directive = true;
      fallbackLabel = "cgo-preamble";
    } else if (!ownDirective && exampleRows.has(c.startRow)) {
      directive = true;
      fallbackLabel = "go-example-output";
    } else {
      directive = ownDirective;
    }

    return {
      ...c,
      kind,
      directive,
      header,
      group: groups[i],
      ...(label !== undefined ? { label } : {}),
      ...(fallbackLabel !== undefined ? { fallbackLabel } : {}),
    };
  });
};
