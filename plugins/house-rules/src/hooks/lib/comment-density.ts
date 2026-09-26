import path from "node:path";
import { getParser as defaultGetParser, type Lang } from "./tree-sitter-loader.js";
import type { Node } from "./tree-sitter.js";
import type { DiffHunk } from "./work-scope.js";

export type { Lang };

export interface Comment {
  startIndex: number;
  endIndex: number;
  startRow: number;
  endRow: number;
  text: string;
  nodeType: string;
  exempt: boolean;
  exemptReason?: string;
}

export type FindResult =
  | { ok: true; comments: Comment[]; errorRows: Set<number> }
  | { ok: false; reason: string; errorRows: Set<number> };

export type DensityResult = {
  mode: "tree-sitter" | "fallback";
  total: number;
  effective: number;
  commentRows: number[];
  errorRows: Set<number>;
};

export type GetParserFn = typeof defaultGetParser;

const SHEBANG_RE = /^#!/;
const ANNOT_TAG_RE = /^@\w/;
const ESLINT_RE = /^eslint-(?:disable|enable)/;
const PRETTIER_RE = /^prettier-ignore/;
const BIOME_RE = /^biome-ignore/;
const REGION_RE = /^#?(?:region|endregion)/i;
const URL_RE = /^https?:\/\/\S+$/;
const DIVIDER_RE = /^(?:[─-╿]{2,}|[-=#*]{4,})/u;
// go/doc treats any [A-Z]{2,}(uid): as a note marker (TODO, BUG, FIXME, NOTE, XXX, HACK…)
const NOTE_MARKER_RE = /^[A-Z]{2,}\([^)]+\)/;
const SHELLCHECK_RE = /^shellcheck\b/;
const NOQA_RE = /^noqa\b/;
const TYPE_IGNORE_RE = /^type:\s*ignore/;
const PYLINT_RE = /^pylint:/;
const PRAGMA_RE = /^pragma:/i;
const YAML_LS_RE = /^yaml-language-server:/;
const DOCKERFILE_DIRECTIVE_RE = /^(?:syntax|escape)=/i;
// Go directive exemptions (matched against stripped inner text after removing "//")
const GO_DIRECTIVE_RE = /^go:/;
const GO_BUILD_CONSTRAINT_RE = /^\+build\b/;
const GO_NOLINT_RE = /^nolint\b/;
const GO_LINT_IGNORE_RE = /^lint:(ignore|file-ignore)\b/;
const GO_KUBEBUILDER_MARKER_RE = /^\+[a-z][\w.-]*:/;
const TOML_SCHEMA_RE = /^:schema\b/;
const TSREF_RE = /^\/\s*<reference\b/;
const GO_OUTPUT_RE = /^(?:unordered )?output:/i;
const GO_EXPORT_RE = /^export\b/;
const GO_LINE_RE = /^line\b/;
// gccgo external function declaration (no space after //)
const GO_EXTERN_RE = /^extern\b/;
// generic Go tool directive: //toolname:directive (no space after //); matches go/doc isDirective
const GO_TOOL_DIRECTIVE_RE = /^[a-z][a-z0-9]*:[a-z0-9]/;
const GW_RULE_RE = /^groundwork-rule:/;

function stripMarkers(raw: string): string {
  let t = raw.trim();
  if (t.startsWith("/**")) t = t.slice(3);
  else if (t.startsWith("/*")) t = t.slice(2);
  else if (t.startsWith("//")) t = t.slice(2);
  else if (t.startsWith("#")) t = t.slice(1);
  if (t.endsWith("*/")) t = t.slice(0, -2);
  t = t.replace(/^\s*\*\s?/, "");
  return t.trim();
}

// rawLine: the raw comment line before stripping (used to check space-after-// for Go directives)
function isExemptInner(inner: string, lang?: Lang, rawLine?: string): boolean {
  if (
    ANNOT_TAG_RE.test(inner) ||
    ESLINT_RE.test(inner) ||
    PRETTIER_RE.test(inner) ||
    BIOME_RE.test(inner) ||
    REGION_RE.test(inner) ||
    URL_RE.test(inner) ||
    DIVIDER_RE.test(inner) ||
    NOTE_MARKER_RE.test(inner) ||
    SHELLCHECK_RE.test(inner) ||
    NOQA_RE.test(inner) ||
    TYPE_IGNORE_RE.test(inner) ||
    PYLINT_RE.test(inner) ||
    PRAGMA_RE.test(inner) ||
    YAML_LS_RE.test(inner)
  ) return true;
  if (lang === "go" && (GO_DIRECTIVE_RE.test(inner) || GO_BUILD_CONSTRAINT_RE.test(inner) || GO_NOLINT_RE.test(inner) || GO_LINT_IGNORE_RE.test(inner) || GO_KUBEBUILDER_MARKER_RE.test(inner))) return true;
  if (lang === "toml" && TOML_SCHEMA_RE.test(inner)) return true;
  if (TSREF_RE.test(inner)) return true;
  if (GW_RULE_RE.test(inner)) return true;
  if (lang === "go") {
    const noSpaceAfterSlash = !rawLine || /^\/\/[^ ]/.test(rawLine.trimStart());
    const isBlockLine = rawLine ? /^\/\*line\b/.test(rawLine.trimStart()) : false;
    if (noSpaceAfterSlash && GO_EXPORT_RE.test(inner)) return true;
    if ((noSpaceAfterSlash || isBlockLine) && GO_LINE_RE.test(inner)) return true;
    if (noSpaceAfterSlash && GO_EXTERN_RE.test(inner)) return true;
    if (noSpaceAfterSlash && GO_TOOL_DIRECTIVE_RE.test(inner)) return true;
  }
  return false;
}

function checkExempt(
  nodeType: string,
  raw: string,
  startRow: number,
  lang: Lang,
  inLeadingBlock: boolean,
): { exempt: boolean; reason?: string } {
  if (startRow === 0 && SHEBANG_RE.test(raw.trim())) {
    return { exempt: true, reason: "shebang" };
  }

  if (nodeType.includes("doc")) {
    return { exempt: true, reason: "doc-comment" };
  }
  const trimmed0 = raw.trimStart();
  if (trimmed0.startsWith("/**") && !trimmed0.startsWith("/***")) {
    return { exempt: true, reason: "jsdoc" };
  }

  if (lang === "rust") {
    const trimmed = raw.trimStart();
    const isRustDoc =
      (trimmed.startsWith("///") && (trimmed.length === 3 || trimmed[3] !== "/")) ||
      trimmed.startsWith("//!") ||
      (trimmed.startsWith("/*!") && !trimmed.startsWith("/***"));
    if (isRustDoc) return { exempt: true, reason: "rust-doc" };
  }

  for (const line of raw.split("\n")) {
    const inner = stripMarkers(line);
    if (!inner) continue;
    if (lang === "dockerfile" && inLeadingBlock && DOCKERFILE_DIRECTIVE_RE.test(inner)) {
      return { exempt: true, reason: "dockerfile-directive" };
    }
    if (isExemptInner(inner, lang, line)) {
      return { exempt: true, reason: inner.slice(0, 30) };
    }
  }

  return { exempt: false };
}

function isCommentNode(node: Node, lang: Lang): boolean {
  return node.type.includes("comment") || (lang === "sql" && node.type === "marginalia");
}

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

function nodeIsWholeLine(node: Node, text: string): boolean {
  const lineStart = text.lastIndexOf("\n", node.startIndex - 1) + 1;
  return !text.slice(lineStart, node.startIndex).trim();
}

function isGoDocComment(node: Node, text: string): boolean {
  if (!nodeIsWholeLine(node, text)) return false;
  let cur: Node | null = node;
  while (cur !== null) {
    const next: Node | null = cur.nextNamedSibling;
    if (!next) return false;
    if (GO_DOC_DECL_TYPES.has(next.type)) {
      return next.startPosition.row === cur.endPosition.row + 1;
    }
    if (next.type === "comment" && next.startPosition.row === cur.endPosition.row + 1) {
      if (!nodeIsWholeLine(next, text)) return false;
      cur = next;
    } else {
      return false;
    }
  }
  return false;
}

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

function findGoPackageClauseRow(root: Node): number | null {
  for (let i = 0; i < root.childCount; i++) {
    const child = root.child(i);
    if (child && child.type === "package_clause") return child.startPosition.row;
  }
  return null;
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
            if (entry !== undefined && GO_OUTPUT_RE.test(stripMarkers(entry.text))) {
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

function collectComments(root: Node, text: string, lang: Lang): Comment[] {
  const results: Comment[] = [];
  let leadingBlockDone = false;

  const goPackageClauseRow = lang === "go" ? findGoPackageClauseRow(root) : null;
  const goCgoPreambleRows = lang === "go" ? findGoCgoPreambleSlashRows(root) : new Set<number>();
  const goExampleOutputRows = lang === "go" ? findGoExampleOutputRows(root) : new Set<number>();

  function walk(node: Node): void {
    if (isCommentNode(node, lang)) {
      const raw = node.text ?? text.slice(node.startIndex, node.endIndex);
      const startRow = node.startPosition.row;
      const endRow = node.endPosition.row;

      if (!leadingBlockDone && startRow > 0) leadingBlockDone = true;
      const inLeadingBlock = !leadingBlockDone || startRow === 0;

      let exempt: boolean;
      let reason: string | undefined;
      if (lang === "go" && (raw.startsWith("/*") || raw.startsWith("//")) && isGoCgoComment(node)) {
        exempt = true;
        reason = "cgo-preamble";
      } else {
        const { exempt: rawExempt, reason: rawReason } = checkExempt(node.type, raw, startRow, lang, inLeadingBlock);
        exempt = rawExempt;
        reason = rawReason;
        if (!exempt && lang === "go" && isGoDocComment(node, text)) {
          exempt = true;
          reason = "go-doc";
        }
        if (!exempt && lang === "go") {
          if (goPackageClauseRow !== null && endRow < goPackageClauseRow) {
            exempt = true;
            reason = "go-file-header";
          } else if (raw.startsWith("//") && goCgoPreambleRows.has(startRow)) {
            exempt = true;
            reason = "cgo-preamble";
          } else if (goExampleOutputRows.has(startRow)) {
            exempt = true;
            reason = "go-example-output";
          }
        }
      }
      results.push({
        startIndex: node.startIndex,
        endIndex: node.endIndex,
        startRow,
        endRow,
        text: raw,
        nodeType: node.type,
        exempt,
        exemptReason: reason,
      });
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walk(child);
    }
  }

  walk(root);
  return results;
}

function collectErrorRows(root: Node): Set<number> {
  const result = new Set<number>();
  function walk(node: Node): void {
    if (node.type === "ERROR" || node.isMissing) {
      for (let r = node.startPosition.row; r <= node.endPosition.row; r++) {
        result.add(r);
      }
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walk(child);
    }
  }
  walk(root);
  return result;
}

export async function findComments(
  text: string,
  lang: Lang,
  getParser: GetParserFn = defaultGetParser,
): Promise<FindResult> {
  const result = await getParser(lang);
  if (!result.ok) return { ok: false, reason: result.reason, errorRows: new Set() };

  const { parser } = result;
  const tree = parser.parse(text);
  if (!tree.rootNode.hasError) {
    const comments = collectComments(tree.rootNode, text, lang);
    tree.delete();
    return { ok: true, comments, errorRows: new Set() };
  }

  const errorRows = collectErrorRows(tree.rootNode);
  const allComments = collectComments(tree.rootNode, text, lang);
  tree.delete();
  const safeComments = allComments.filter(c => {
    for (let r = c.startRow; r <= c.endRow; r++) {
      if (errorRows.has(r)) return false;
    }
    return true;
  });
  if (safeComments.length === 0 && errorRows.size > 0) {
    return { ok: false, reason: "parse-error", errorRows };
  }
  return { ok: true, comments: safeComments, errorRows };
}

export function detectLanguage(filePath: string, firstLine?: string): Lang | null {
  const base = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();

  if (base === "Dockerfile" || base === "Containerfile") return "dockerfile";
  if (/^Dockerfile\.|^Containerfile\./i.test(base)) return "dockerfile";
  if (ext === ".dockerfile") return "dockerfile";

  if (ext === ".ts" || ext === ".mts" || ext === ".cts") return "typescript";
  if (ext === ".tsx" || ext === ".jsx" || ext === ".js" || ext === ".mjs" || ext === ".cjs") return "tsx";
  if (ext === ".py") return "python";
  if (ext === ".sh" || ext === ".bash") return "bash";
  if (ext === ".yml" || ext === ".yaml") return "yaml";

  if (ext === ".go") return "go";
  if (ext === ".rs") return "rust";
  if (ext === ".sql") return "sql";
  if (ext === ".mk") return "make";
  if (base === "Makefile" || base === "GNUmakefile" || base === "makefile") return "make";
  if (ext === ".toml") return "toml";

  if (!ext && firstLine) {
    const m = firstLine.match(/^#!.*?\b(ba?sh|sh|zsh)\b/);
    if (m) return "bash";
  }

  return null;
}

interface EditInput {
  file_path?: string;
  old_string?: string;
  new_string?: string;
  replace_all?: boolean;
  content?: string;
  edits?: Array<{ old_string: string; new_string: string; replace_all?: boolean }>;
}

function applyOneEdit(
  text: string,
  oldStr: string,
  newStr: string,
  replaceAll: boolean,
): { post: string; rowRanges: Array<[number, number]> } | null {
  if (!text.includes(oldStr)) return null;

  const rowRanges: Array<[number, number]> = [];

  if (replaceAll) {
    let result = "";
    let searchFrom = 0;
    let lineOffset = 0;
    const oldLines = oldStr.split("\n").length;
    const newLines = newStr.split("\n").length;

    while (true) {
      const idx = text.indexOf(oldStr, searchFrom);
      if (idx === -1) { result += text.slice(searchFrom); break; }
      result += text.slice(searchFrom, idx);
      const rowsBefore = text.slice(0, idx).split("\n").length - 1;
      const startRow = rowsBefore + lineOffset;
      rowRanges.push([startRow, startRow + newLines - 1]);
      lineOffset += newLines - oldLines;
      result += newStr;
      searchFrom = idx + oldStr.length;
    }
    return { post: result, rowRanges };
  } else {
    const idx = text.indexOf(oldStr);
    const rowsBefore = text.slice(0, idx).split("\n").length - 1;
    const newLines = newStr.split("\n").length;
    rowRanges.push([rowsBefore, rowsBefore + newLines - 1]);
    const post = text.slice(0, idx) + newStr + text.slice(idx + oldStr.length);
    return { post, rowRanges };
  }
}

export function reconstructPostEdit(
  tool: string,
  toolInput: EditInput,
  currentFileText: string | null,
): { post: string; changedRows: Set<number> } | null {
  const norm = tool.toLowerCase().replace(/^fast_/, "");

  if (norm === "write") {
    const content = toolInput.content ?? "";
    const changedRows = new Set<number>();
    const postLines = content.split("\n");
    if (currentFileText === null) {
      postLines.forEach((_, i) => changedRows.add(i));
    } else {
      const preLines = currentFileText.split("\n");
      for (let i = 0; i < postLines.length; i++) {
        if (postLines[i] !== preLines[i]) changedRows.add(i);
      }
    }
    return { post: content, changedRows };
  }

  if (norm === "edit") {
    const oldStr = toolInput.old_string ?? "";
    const newStr = toolInput.new_string ?? "";
    const text = currentFileText ?? "";
    const r = applyOneEdit(text, oldStr, newStr, !!toolInput.replace_all);
    if (!r) return null;
    const changedRows = new Set<number>();
    for (const [lo, hi] of r.rowRanges) {
      for (let i = lo; i <= hi; i++) changedRows.add(i);
    }
    return { post: r.post, changedRows };
  }

  if (norm === "multiedit") {
    const edits = toolInput.edits ?? [];
    let text = currentFileText ?? "";
    const changedRows = new Set<number>();
    for (const e of edits) {
      const r = applyOneEdit(text, e.old_string, e.new_string, !!e.replace_all);
      if (!r) return null;
      for (const [lo, hi] of r.rowRanges) {
        for (let i = lo; i <= hi; i++) changedRows.add(i);
      }
      text = r.post;
    }
    return { post: text, changedRows };
  }

  return null;
}

function normalizeCommentText(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function newComments(
  pre: Comment[] | null,
  post: Comment[],
  changedRows: Set<number>,
): Comment[] {
  const preMap = new Map<string, number>();
  if (pre) {
    for (const c of pre) {
      if (c.exempt) continue;
      const key = normalizeCommentText(c.text);
      preMap.set(key, (preMap.get(key) ?? 0) + 1);
    }
  }

  const remaining = new Map(preMap);
  const result: Comment[] = [];

  for (const c of post) {
    if (c.exempt) continue;
    const intersects = c.startRow <= Math.max(...changedRows) &&
      c.endRow >= Math.min(...changedRows) &&
      [...changedRows].some(r => r >= c.startRow && r <= c.endRow);
    if (!intersects) continue;

    const key = normalizeCommentText(c.text);
    const count = remaining.get(key) ?? 0;
    if (count > 0) {
      remaining.set(key, count - 1);
    } else {
      result.push(c);
    }
  }

  return result;
}

export function stripComments(text: string, comments: Comment[]): { text: string; rowChanges: RowChange[] } {
  const origLines = text.split("\n");
  const sorted = [...comments].sort((a, b) => b.startIndex - a.startIndex);
  let result = text;
  const rowChanges: RowChange[] = [];
  const touchedInlineRows = new Set<number>();
  const deletedOrigRows = new Set<number>();

  for (const c of sorted) {
    const before = result.slice(0, c.startIndex);
    const after = result.slice(c.endIndex);
    const lineStart = before.lastIndexOf("\n") + 1;
    const beforeOnLine = before.slice(lineStart);
    const lineEndOffset = after.indexOf("\n");
    const afterOnLine = lineEndOffset !== -1 ? after.slice(0, lineEndOffset) : after;
    const isWholeLine = !beforeOnLine.trim() && !afterOnLine.trim();

    if (isWholeLine) {
      const lineEnd = after.indexOf("\n");
      const trailingNewline = lineEnd !== -1 ? after.slice(lineEnd) : "";
      const prefix = lineStart > 0 ? result.slice(0, lineStart - 1) : "";
      if (lineStart > 0) {
        result = prefix + trailingNewline;
      } else {
        result = lineEnd !== -1 ? after.slice(lineEnd + 1) : "";
      }
      for (let r = c.startRow; r <= c.endRow; r++) {
        if (!deletedOrigRows.has(r)) {
          deletedOrigRows.add(r);
          rowChanges.push({ origRow: r, kind: "deleted", origText: origLines[r] ?? "" });
        }
      }
    } else if (!beforeOnLine.trim()) {
      result = result.slice(0, c.startIndex) + after.replace(/^[ \t]+/, "");
      touchedInlineRows.add(c.startRow);
      for (let r = c.startRow + 1; r <= c.endRow; r++) {
        if (!deletedOrigRows.has(r)) {
          deletedOrigRows.add(r);
          rowChanges.push({ origRow: r, kind: "deleted", origText: origLines[r] ?? "" });
        }
      }
    } else {
      const wsStart = before.search(/\s+$/);
      const codeEnd = wsStart !== -1 ? wsStart : c.startIndex;
      if (c.startRow !== c.endRow) {
        const lineEndOffset = after.indexOf("\n");
        const restOfEndRow = lineEndOffset !== -1 ? after.slice(0, lineEndOffset) : after;
        if (!restOfEndRow.trim()) {
          const crLen = restOfEndRow.endsWith("\r") ? 1 : 0;
          const afterTrimmed = lineEndOffset !== -1 ? after.slice(restOfEndRow.length - crLen) : "";
          result = result.slice(0, codeEnd) + afterTrimmed;
          touchedInlineRows.add(c.startRow);
          for (let r = c.startRow + 1; r <= c.endRow; r++) {
            if (!deletedOrigRows.has(r)) {
              deletedOrigRows.add(r);
              rowChanges.push({ origRow: r, kind: "deleted", origText: origLines[r] ?? "" });
            }
          }
        } else {
          const eol = c.text.includes("\r\n") ? "\r\n" : "\n";
          result = result.slice(0, codeEnd) + eol + after;
          touchedInlineRows.add(c.startRow);
          touchedInlineRows.add(c.endRow);
          for (let r = c.startRow + 1; r <= c.endRow - 1; r++) {
            if (!deletedOrigRows.has(r)) {
              deletedOrigRows.add(r);
              rowChanges.push({ origRow: r, kind: "deleted", origText: origLines[r] ?? "" });
            }
          }
        }
      } else {
        const cr = c.text.endsWith("\r") ? "\r" : "";
        const sep = (cr === "" && after.length > 0 && !/^\s/.test(after[0])) ? " " : cr;
        result = result.slice(0, codeEnd) + sep + after;
        touchedInlineRows.add(c.startRow);
      }
    }
  }

  // Emit exactly one rowChange per touched inline row, using final stripped text.
  const finalLines = result.split("\n");
  for (const row of touchedInlineRows) {
    if (deletedOrigRows.has(row)) continue;
    const deletedsBefore = rowChanges.filter(rc => rc.kind === "deleted" && rc.origRow < row).length;
    const remappedIndex = row - deletedsBefore;
    const fixedText = finalLines[remappedIndex] ?? "";
    rowChanges.push({ origRow: row, kind: "modified", origText: origLines[row] ?? "", fixedText });
  }

  return { text: result, rowChanges };
}

function normalizeGoRemovalWhitespace(
  origText: string,
  fixed: string,
  rowChanges: RowChange[],
): string {
  const deletedOrigRows = rowChanges
    .filter(rc => rc.kind === "deleted")
    .map(rc => rc.origRow)
    .sort((a, b) => a - b);
  if (deletedOrigRows.length === 0) return fixed;

  const origLines = origText.split("\n");
  const isBlank = (s: string | undefined) => (s ?? "").trim() === "";

  function deletedBefore(origRow: number): number {
    let lo = 0, hi = deletedOrigRows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (deletedOrigRows[mid] < origRow) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  const collapseSites = new Set<number>();

  let i = 0;
  while (i < deletedOrigRows.length) {
    const lo = deletedOrigRows[i];
    let hi = lo;
    while (i + 1 < deletedOrigRows.length && deletedOrigRows[i + 1] === hi + 1) {
      i++;
      hi = deletedOrigRows[i];
    }
    const beforeBlank = lo > 0 && isBlank(origLines[lo - 1]);
    const afterBlank = isBlank(origLines[hi + 1]);
    if (beforeBlank && afterBlank) {
      const db = deletedBefore(lo);
      const clusterSize = hi - lo + 1;
      const finalAfter = hi + 1 - (db + clusterSize);
      collapseSites.add(finalAfter);
    }
    i++;
  }

  if (collapseSites.size === 0) return fixed;

  const fixedLines = fixed.split("\n");
  const result: string[] = [];
  for (let j = 0; j < fixedLines.length; j++) {
    const blank = fixedLines[j].trim() === "";
    const prevBlank = result.length > 0 && result[result.length - 1].trim() === "";
    if (blank && prevBlank && collapseSites.has(j)) continue;
    result.push(fixedLines[j]);
  }
  return result.join("\n");
}


const FALLBACK_ANNOT_TAG_RE = /^\s*\/\/\s*@\w/;
const FALLBACK_URL_LINE_RE = /^\s*\/\/\s*https?:\/\//;
const FALLBACK_SECTION_DIV_RE = /^\s*\/\/[ \t]*(?:[─-╿]{2,}|[-=]{4,})/u;
const FALLBACK_ESLINT_RE = /^\s*\/\/\s*eslint-(?:disable|enable)/;
const FALLBACK_REGION_RE = /^\s*\/\/\s*#(?:region|endregion)/;
const FALLBACK_TODO_OWNER_RE = /^\s*\/\/\s*TODO\([^)]+\)/;

function isFallbackExempt(raw: string): boolean {
  return (
    FALLBACK_ANNOT_TAG_RE.test(raw) ||
    FALLBACK_URL_LINE_RE.test(raw) ||
    FALLBACK_SECTION_DIV_RE.test(raw) ||
    FALLBACK_ESLINT_RE.test(raw) ||
    FALLBACK_REGION_RE.test(raw) ||
    FALLBACK_TODO_OWNER_RE.test(raw)
  );
}

const HASH_COMMENT_LANGS = new Set<Lang>(["bash", "yaml", "python", "dockerfile", "make", "toml"]);

function countEffectiveFallback(text: string, lang?: Lang | null): { total: number; effective: number; commentRows: number[] } {
  const rows = text.split("\n");
  let effective = 0;
  const commentRows: number[] = [];
  let inJsDoc = false;
  let inBlock = false;

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const trimmed = raw.trim();

    if (inJsDoc) {
      if (trimmed.includes("*/")) inJsDoc = false;
      continue;
    }

    if (inBlock) {
      effective++;
      commentRows.push(i);
      if (trimmed.includes("*/")) inBlock = false;
      continue;
    }

    if (trimmed.startsWith("/**")) {
      if (!trimmed.slice(3).includes("*/")) inJsDoc = true;
      continue;
    }

    if (trimmed.startsWith("/*")) {
      effective++;
      commentRows.push(i);
      if (!trimmed.slice(2).includes("*/")) inBlock = true;
      continue;
    }

    if (trimmed.startsWith("//")) {
      if (!isFallbackExempt(raw)) {
        effective++;
        commentRows.push(i);
      }
      continue;
    }

    if (trimmed.startsWith("#")) {
      if (!lang || !HASH_COMMENT_LANGS.has(lang)) continue;
      if (i === 0 && trimmed.startsWith("#!")) continue;
      const inner = trimmed.slice(1).trim();
      if (!isExemptInner(inner)) {
        effective++;
        commentRows.push(i);
      }
      continue;
    }
  }

  return { total: rows.length, effective, commentRows };
}


function hasAstErrors(node: Node): boolean {
  if (node.isError || node.isMissing) return true;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && hasAstErrors(child)) return true;
  }
  return false;
}

type RowChangeKind = "deleted" | "modified";
export interface RowChange { origRow: number; kind: RowChangeKind; origText: string; fixedText?: string }

export type AutoFixResult =
  | { ok: true; fixed: string; removed: number; removedTexts: string[]; kept: number; total: number; rowChanges: RowChange[] }
  | { ok: false; reason: string };


export function collectCodeText(root: Node, text: string, lang: Lang): string {
  const parts: string[] = [];
  function walk(node: Node): void {
    if (isCommentNode(node, lang)) return;
    if (node.childCount === 0) {
      parts.push(node.text ?? text.slice(node.startIndex, node.endIndex));
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walk(child);
    }
  }
  walk(root);
  return parts.join(" ");
}

export interface NetNewResult {
  /** 1-based new-file line numbers of unpaired added comment rows */
  rows: number[];
  /** total added comment rows across all hunks */
  added: number;
  /** total removed comment rows across all hunks */
  removed: number;
}

/** Strip comment markers and normalize line text for similarity comparison. */
function normForPairing(raw: string): string {
  return raw
    .replace(/^\s*(\/\/+|#|\/\*+|\*+\/|\*)\s?/, "")
    .replace(/\s*\*\/\s*$/, "")
    .toLowerCase()
    .trim();
}

/** Token-set Jaccard similarity on whitespace-split tokens. */
function tokenSetJaccard(a: string, b: string): number {
  const ta = new Set(a.split(/\s+/).filter(Boolean));
  const tb = new Set(b.split(/\s+/).filter(Boolean));
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/**
 * Greedy similarity pairing: pair each removed comment row with the most
 * similar added comment row (descending similarity; tie-break by position
 * distance). Returns 1-based line numbers of added rows left unpaired
 * (i.e. net-new).
 *
 * Known limits: a new comment replacing a base comment in the same hunk
 * pairs as a reword (not counted); a zero-token-overlap reword can lose its
 * pairing to a higher-similarity new comment, flagging the reword row instead.
 * Both keep net-new count correct and never affect rows unchanged since base.
 */
function greedyPairCommentRows(
  removed: Array<{ lineNo: number; normText: string }>,
  added: Array<{ lineNo: number; normText: string }>,
): number[] {
  if (removed.length === 0) return added.map(a => a.lineNo);

  // Build all candidate pairs with similarity scores
  const candidates: Array<{ ri: number; ai: number; sim: number; dist: number }> = [];
  for (let ri = 0; ri < removed.length; ri++) {
    for (let ai = 0; ai < added.length; ai++) {
      const sim = tokenSetJaccard(removed[ri].normText, added[ai].normText);
      const dist = Math.abs(removed[ri].lineNo - added[ai].lineNo);
      candidates.push({ ri, ai, sim, dist });
    }
  }

  // Sort: highest similarity first; tie-break by smallest position distance
  candidates.sort((a, b) =>
    b.sim !== a.sim ? b.sim - a.sim : a.dist - b.dist,
  );

  const pairedRemoved = new Set<number>();
  const pairedAdded = new Set<number>();
  for (const { ri, ai } of candidates) {
    if (pairedRemoved.has(ri) || pairedAdded.has(ai)) continue;
    pairedRemoved.add(ri);
    pairedAdded.add(ai);
  }

  return added.filter((_, ai) => !pairedAdded.has(ai)).map(a => a.lineNo);
}

export async function netNewCommentRows(
  baseText: string,
  postText: string,
  lang: Lang,
  hunks: DiffHunk[],
  getParser: GetParserFn = defaultGetParser,
): Promise<{ ok: true } & NetNewResult | { ok: false; reason: string }> {
  const baseParsed = await findComments(baseText, lang, getParser);
  if (!baseParsed.ok) return { ok: false, reason: baseParsed.reason };
  const postParsed = await findComments(postText, lang, getParser);
  if (!postParsed.ok) return { ok: false, reason: postParsed.reason };

  // If errors overlap any hunk rows, refuse: caller falls back to density()
  for (const hunk of hunks) {
    if (hunk.added.some(ln => postParsed.errorRows.has(ln - 1))) {
      return { ok: false, reason: "parse-error-in-hunk" };
    }
    if (hunk.removedBaseLineNos.some(ln => baseParsed.errorRows.has(ln - 1))) {
      return { ok: false, reason: "parse-error-in-hunk" };
    }
  }

  const baseCommentLines = new Set<number>();
  for (const c of baseParsed.comments) {
    if (c.exempt) continue;
    for (let r = c.startRow; r <= c.endRow; r++) baseCommentLines.add(r + 1);
  }
  const postCommentLines = new Set<number>();
  for (const c of postParsed.comments) {
    if (c.exempt) continue;
    for (let r = c.startRow; r <= c.endRow; r++) postCommentLines.add(r + 1);
  }

  const postLines = postText.split("\n");

  const allUnpaired: number[] = [];
  let totalAdded = 0;
  let totalRemoved = 0;
  for (const hunk of hunks) {
    const addedCommentLineNos = hunk.added.filter(ln => postCommentLines.has(ln));

    // Collect removed comment items (text comes from hunk.removed, parallel to removedBaseLineNos)
    const removedItems: Array<{ lineNo: number; normText: string }> = [];
    for (let i = 0; i < hunk.removedBaseLineNos.length; i++) {
      const ln = hunk.removedBaseLineNos[i];
      if (!baseCommentLines.has(ln)) continue;
      removedItems.push({ lineNo: ln, normText: normForPairing(hunk.removed[i] ?? "") });
    }

    // Collect added comment items
    const addedItems = addedCommentLineNos.map(ln => ({
      lineNo: ln,
      normText: normForPairing(postLines[ln - 1] ?? ""),
    }));

    const unpairedRows = greedyPairCommentRows(removedItems, addedItems);
    allUnpaired.push(...unpairedRows);
    totalAdded += addedCommentLineNos.length;
    totalRemoved += removedItems.length;
  }
  return { ok: true, rows: allUnpaired, added: totalAdded, removed: totalRemoved };
}

function isExemptProse(c: Comment): boolean {
  return c.exempt && URL_RE.test(stripMarkers(c.text));
}

function buildGoCommentGroups(comments: Comment[], text: string): Comment[][] {
  const wholeLine: Comment[] = [];
  for (const c of comments) {
    const ls = text.lastIndexOf("\n", c.startIndex - 1) + 1;
    if (!text.slice(ls, c.startIndex).trim()) wholeLine.push(c);
  }
  wholeLine.sort((a, b) => a.startRow - b.startRow);
  const groups: Comment[][] = [];
  let cur: Comment[] = [];
  for (const c of wholeLine) {
    if (cur.length === 0 || c.startRow !== cur[cur.length - 1].endRow + 1) {
      if (cur.length > 0) groups.push(cur);
      cur = [c];
    } else {
      cur.push(c);
    }
  }
  if (cur.length > 0) groups.push(cur);
  return groups;
}

function goNoteContSet(
  candidates: Comment[],
  allComments: Comment[],
  text: string,
): Set<number> {
  const groups = buildGoCommentGroups(allComments, text);
  const candSet = new Set(candidates.map(c => c.startIndex));
  const result = new Set<number>();
  for (const group of groups) {
    let inNote = false;
    for (const c of group) {
      if (c.exempt && NOTE_MARKER_RE.test(stripMarkers(c.text))) {
        inNote = true;
        continue;
      }
      if (c.exempt) {
        inNote = false;
        continue;
      }
      if (inNote && candSet.has(c.startIndex)) {
        result.add(c.startIndex);
      }
    }
  }
  return result;
}

function paragraphProtectedSet(
  candidates: Comment[],
  allComments: Comment[],
  text: string,
  lang?: Lang,
): Set<number> {
  const candIndices = new Set(candidates.map(c => c.startIndex));
  const result = new Set<number>();

  if (lang === "go") {
    const groups = buildGoCommentGroups(allComments, text);
    for (const group of groups) {
      if (!group.some(c => isExemptProse(c))) continue;
      for (const c of group) {
        if (candIndices.has(c.startIndex)) result.add(c.startIndex);
      }
    }
    return result;
  }

  const allSlash: Comment[] = [];
  for (const c of allComments) {
    if (!c.text.startsWith("//") || c.startRow !== c.endRow) continue;
    const ls = text.lastIndexOf("\n", c.startIndex - 1) + 1;
    if (text.slice(ls, c.startIndex).trim()) continue;
    allSlash.push(c);
  }
  allSlash.sort((a, b) => a.startRow - b.startRow);

  const paragraphs: Comment[][] = [];
  let cur: Comment[] = [];
  let prevRow = -2;
  for (const c of allSlash) {
    if (c.exempt && !isExemptProse(c)) {
      if (cur.length > 0) { paragraphs.push(cur); cur = []; }
      prevRow = -2;
      continue;
    }
    if (c.startRow === prevRow + 1) {
      cur.push(c);
    } else {
      if (cur.length > 0) paragraphs.push(cur);
      cur = [c];
    }
    prevRow = c.startRow;
  }
  if (cur.length > 0) paragraphs.push(cur);

  for (const para of paragraphs) {
    if (!para.some(c => isExemptProse(c))) continue;
    for (const c of para) {
      if (candIndices.has(c.startIndex)) result.add(c.startIndex);
    }
  }
  return result;
}

export async function autoFix(
  text: string,
  lang: Lang,
  addedRows: Set<number>,
  getParser?: GetParserFn,
  netNewRows?: Set<number>,
  opts?: { maxAllowedRows?: number },
): Promise<AutoFixResult> {
  getParser ??= defaultGetParser;
  const origParsed = await findComments(text, lang, getParser);
  if (!origParsed.ok) return { ok: false, reason: `parse: ${origParsed.reason}` };

  const candidates: Comment[] = [];
  for (const c of origParsed.comments) {
    if (c.exempt) continue;
    let overlapsError = false;
    for (let r = c.startRow; r <= c.endRow; r++) {
      if (origParsed.errorRows.has(r)) { overlapsError = true; break; }
    }
    if (overlapsError) continue;
    const rowSet = netNewRows ?? addedRows;
    let allAdded = true;
    for (let r = c.startRow; r <= c.endRow; r++) {
      if (!rowSet.has(r)) { allAdded = false; break; }
    }
    if (allAdded) candidates.push(c);
  }

  function commentRowCount(c: Comment): number {
    return c.endRow - c.startRow + 1;
  }

  const totalCandidateRows = candidates.reduce((sum, c) => sum + commentRowCount(c), 0);
  const maxAllowedRows = opts?.maxAllowedRows ?? Math.floor(0.05 * addedRows.size);

  if (totalCandidateRows <= maxAllowedRows) {
    return { ok: true, fixed: text, removed: 0, removedTexts: [], kept: candidates.length, total: candidates.length, rowChanges: [] };
  }

  const candidateSet = new Set(candidates.map(c => c.startIndex));
  let extraEffective = 0;
  for (const c of origParsed.comments) {
    if (c.exempt) continue;
    if (candidateSet.has(c.startIndex)) continue;
    for (let r = c.startRow; r <= c.endRow; r++) {
      if (addedRows.has(r)) extraEffective++;
    }
  }

  let protectedIndices = paragraphProtectedSet(candidates, origParsed.comments, text, lang);
  if (lang === "go") {
    const noteCont = goNoteContSet(candidates, origParsed.comments, text);
    if (noteCont.size > 0) protectedIndices = new Set([...protectedIndices, ...noteCont]);
  }
  const protectedCands = candidates.filter(c => protectedIndices.has(c.startIndex));
  const removableCands = candidates.filter(c => !protectedIndices.has(c.startIndex));
  const protectedRowCount = protectedCands.reduce((s, c) => s + commentRowCount(c), 0);

  const units: Comment[][] = [];
  if (lang === "go") {
    const groups = buildGoCommentGroups(origParsed.comments, text);
    const removableSet = new Set(removableCands.map(c => c.startIndex));
    const inGoGroup = new Set<number>();
    const orderedUnits: Array<{ startRow: number; comments: Comment[] }> = [];
    for (const group of groups) {
      const groupCands = group.filter(c => removableSet.has(c.startIndex));
      if (groupCands.length > 0) {
        orderedUnits.push({ startRow: groupCands[0].startRow, comments: groupCands });
        for (const c of groupCands) inGoGroup.add(c.startIndex);
      }
    }
    for (const c of removableCands) {
      if (!inGoGroup.has(c.startIndex)) {
        orderedUnits.push({ startRow: c.startRow, comments: [c] });
      }
    }
    orderedUnits.sort((a, b) => a.startRow - b.startRow);
    for (const u of orderedUnits) units.push(u.comments);
  } else {
    const wholeLineHeads = new Set<Comment>();
    for (const c of removableCands) {
      const lineStart = text.lastIndexOf("\n", c.startIndex - 1) + 1;
      const isWholeLine = !text.slice(lineStart, c.startIndex).trim();
      if (isWholeLine && c.text.startsWith("//") && c.startRow === c.endRow) {
        const last = units[units.length - 1];
        if (last && wholeLineHeads.has(last[0]) && c.startRow === last[last.length - 1].endRow + 1) {
          last.push(c);
          continue;
        }
        wholeLineHeads.add(c);
      }
      units.push([c]);
    }
  }

  let keptRows = protectedRowCount;
  let keepCount = 0;
  let keptUnitIndices: number[] | null = null;
  if (lang === "go") {
    keptUnitIndices = [];
    for (let i = 0; i < units.length; i++) {
      const rows = units[i].reduce((s, c) => s + commentRowCount(c), 0);
      if (keptRows + rows <= maxAllowedRows) {
        keptRows += rows;
        keptUnitIndices.push(i);
      }
    }
  } else {
    for (const unit of units) {
      const rows = unit.reduce((s, c) => s + commentRowCount(c), 0);
      if (keptRows + rows <= maxAllowedRows) {
        keptRows += rows;
        keepCount++;
      } else {
        break;
      }
    }
  }

  if (keptUnitIndices !== null) {
    const keptSet = new Set(keptUnitIndices);
    while (true) {
      const removedCands = units.filter((_, i) => !keptSet.has(i)).flat();
      const wlRemovedRows = stripComments(text, removedCands).rowChanges.filter(
        rc => rc.kind === "deleted" && addedRows.has(rc.origRow),
      ).length;
      const remappedSize = addedRows.size - wlRemovedRows;
      const densityOkGo = opts?.maxAllowedRows !== undefined
        ? keptRows + extraEffective <= maxAllowedRows
        : (remappedSize <= 0 || (keptRows + extraEffective) / remappedSize * 100 <= 5);
      if (densityOkGo) break;
      if (keptUnitIndices.length === 0) {
        return { ok: false, reason: "still over cap after fix" };
      }
      const lastKept = keptUnitIndices.pop()!;
      keptSet.delete(lastKept);
      keptRows -= units[lastKept].reduce((s, c) => s + commentRowCount(c), 0);
    }
    const toRemoveGo = units.filter((_, i) => !keptSet.has(i)).flat();
    const strippedGo = stripComments(text, toRemoveGo);
    const { rowChanges } = strippedGo;
    const fixedGo = normalizeGoRemovalWhitespace(text, strippedGo.text, rowChanges);
    const fpGo = await findComments(fixedGo, lang, getParser);
    if (!fpGo.ok) return { ok: false, reason: `post-strip parse: ${fpGo.reason}` };
    const prGo = await getParser(lang);
    if (!prGo.ok) return { ok: false, reason: `parser: ${prGo.reason}` };
    const origTreeGo = prGo.parser.parse(text);
    const fixedTreeGo = prGo.parser.parse(fixedGo);
    const origHasErrGo = hasAstErrors(origTreeGo.rootNode);
    const fixedHasErrGo = hasAstErrors(fixedTreeGo.rootNode);
    const origCodeGo = collectCodeText(origTreeGo.rootNode, text, lang);
    const fixedCodeGo = collectCodeText(fixedTreeGo.rootNode, fixedGo, lang);
    origTreeGo.delete();
    fixedTreeGo.delete();
    if (!origHasErrGo && fixedHasErrGo) {
      return { ok: false, reason: "fix introduced parse errors" };
    }
    if (origCodeGo !== fixedCodeGo) return { ok: false, reason: "code content changed" };
    const preMapGo = new Map<string, number>();
    for (const c of origParsed.comments) {
      let onAdded = false;
      for (let r = c.startRow; r <= c.endRow && !onAdded; r++) onAdded = addedRows.has(r);
      if (!onAdded) preMapGo.set(c.text, (preMapGo.get(c.text) ?? 0) + 1);
    }
    const fixedMapGo = new Map<string, number>();
    for (const c of fpGo.comments) fixedMapGo.set(c.text, (fixedMapGo.get(c.text) ?? 0) + 1);
    for (const [t, cnt] of preMapGo) {
      if ((fixedMapGo.get(t) ?? 0) < cnt) return { ok: false, reason: "pre-existing comment removed" };
    }
    const keptUnits = units.filter((_, i) => keptSet.has(i)).flat().length;
    return { ok: true, fixed: fixedGo, removed: toRemoveGo.length, removedTexts: toRemoveGo.map(c => c.text), kept: keptUnits + protectedCands.length, total: candidates.length, rowChanges };
  }

  while (keepCount >= 0) {
    const removedCands = units.slice(keepCount).flat();
    const wlRemovedRows = stripComments(text, removedCands).rowChanges.filter(
      rc => rc.kind === "deleted" && addedRows.has(rc.origRow),
    ).length;
    const remappedSize = addedRows.size - wlRemovedRows;
    const densityOk = opts?.maxAllowedRows !== undefined
      ? keptRows + extraEffective <= maxAllowedRows
      : (remappedSize <= 0 || (keptRows + extraEffective) / remappedSize * 100 <= 5);
    if (densityOk) break;
    if (keepCount === 0) {
      return { ok: false, reason: "still over cap after fix" };
    }
    keptRows -= units[keepCount - 1].reduce((s, c) => s + commentRowCount(c), 0);
    keepCount--;
  }
  if (keepCount < 0) {
    return { ok: false, reason: "still over cap after fix" };
  }

  const toRemove = units.slice(keepCount).flat();
  const stripped = stripComments(text, toRemove);
  const { rowChanges } = stripped;

  let fixed: string;
  if (lang === "go") {
    fixed = normalizeGoRemovalWhitespace(text, stripped.text, rowChanges);
  } else {
    fixed = stripped.text;
  }

  const fp = await findComments(fixed, lang, getParser);
  if (!fp.ok) return { ok: false, reason: `post-strip parse: ${fp.reason}` };

  const pr = await getParser(lang);
  if (!pr.ok) return { ok: false, reason: `parser: ${pr.reason}` };
  const origTree = pr.parser.parse(text);
  const fixedTree = pr.parser.parse(fixed);
  const origHasErr = hasAstErrors(origTree.rootNode);
  const fixedHasErr = hasAstErrors(fixedTree.rootNode);
  const origCode = collectCodeText(origTree.rootNode, text, lang);
  const fixedCode = collectCodeText(fixedTree.rootNode, fixed, lang);
  origTree.delete();
  fixedTree.delete();
  if (!origHasErr && fixedHasErr) {
    return { ok: false, reason: "fix introduced parse errors" };
  }
  if (origCode !== fixedCode) return { ok: false, reason: "code content changed" };

  const preMap = new Map<string, number>();
  for (const c of origParsed.comments) {
    let onAdded = false;
    for (let r = c.startRow; r <= c.endRow && !onAdded; r++) onAdded = addedRows.has(r);
    if (!onAdded) preMap.set(c.text, (preMap.get(c.text) ?? 0) + 1);
  }
  const fixedMap = new Map<string, number>();
  for (const c of fp.comments) fixedMap.set(c.text, (fixedMap.get(c.text) ?? 0) + 1);
  for (const [t, cnt] of preMap) {
    if ((fixedMap.get(t) ?? 0) < cnt) return { ok: false, reason: "pre-existing comment removed" };
  }

  return { ok: true, fixed, removed: toRemove.length, removedTexts: toRemove.map(c => c.text), kept: units.slice(0, keepCount).flat().length + protectedCands.length, total: candidates.length, rowChanges };
}

export async function density(
  text: string,
  lang: Lang | null,
  rows?: Set<number>,
  getParser: GetParserFn = defaultGetParser,
): Promise<DensityResult> {
  const lines = text.split("\n");
  const total = rows ? rows.size : lines.length;

  if (lang !== null) {
    const parsed = await findComments(text, lang, getParser);
    if (parsed.ok) {
      const commentRowSet = new Set<number>();
      for (const c of parsed.comments) {
        if (c.exempt) continue;
        for (let r = c.startRow; r <= c.endRow; r++) {
          if (!rows || rows.has(r)) commentRowSet.add(r);
        }
      }
      const commentRows = [...commentRowSet].sort((a, b) => a - b);
      return { mode: "tree-sitter", total, effective: commentRows.length, commentRows, errorRows: parsed.errorRows };
    }
    const fb = countEffectiveFallback(text, lang);
    const commentRows = rows ? fb.commentRows.filter(r => rows.has(r)) : fb.commentRows;
    return { mode: "fallback", total, effective: commentRows.length, commentRows, errorRows: parsed.errorRows };
  }

  const fb = countEffectiveFallback(text, lang);
  const commentRows = rows
    ? fb.commentRows.filter(r => rows.has(r))
    : fb.commentRows;
  return { mode: "fallback", total, effective: commentRows.length, commentRows, errorRows: new Set() };
}
