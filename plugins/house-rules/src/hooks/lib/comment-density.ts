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
const TODO_OWNER_RE = /^TODO\([^)]+\)/;
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
const TOML_SCHEMA_RE = /^:schema\b/;
const TSREF_RE = /^\/\s*<reference\b/;
const GO_OUTPUT_RE = /^(?:Unordered )?Output:/;
const GO_EXPORT_RE = /^export\b/;
const GO_LINE_RE = /^line\b/;
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

function isExemptInner(inner: string, lang?: Lang): boolean {
  if (
    ANNOT_TAG_RE.test(inner) ||
    ESLINT_RE.test(inner) ||
    PRETTIER_RE.test(inner) ||
    BIOME_RE.test(inner) ||
    REGION_RE.test(inner) ||
    URL_RE.test(inner) ||
    DIVIDER_RE.test(inner) ||
    TODO_OWNER_RE.test(inner) ||
    SHELLCHECK_RE.test(inner) ||
    NOQA_RE.test(inner) ||
    TYPE_IGNORE_RE.test(inner) ||
    PYLINT_RE.test(inner) ||
    PRAGMA_RE.test(inner) ||
    YAML_LS_RE.test(inner)
  ) return true;
  if (lang === "go" && (GO_DIRECTIVE_RE.test(inner) || GO_BUILD_CONSTRAINT_RE.test(inner) || GO_NOLINT_RE.test(inner))) return true;
  if (lang === "toml" && TOML_SCHEMA_RE.test(inner)) return true;
  if (TSREF_RE.test(inner)) return true;
  if (GW_RULE_RE.test(inner)) return true;
  if (lang === "go") {
    if (GO_OUTPUT_RE.test(inner)) return true;
    if (GO_EXPORT_RE.test(inner)) return true;
    if (GO_LINE_RE.test(inner)) return true;
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
    if (isExemptInner(inner, lang)) {
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

function isGoCgoComment(node: Node): boolean {
  const next = node.nextNamedSibling;
  if (!next || next.type !== "import_declaration") return false;
  let cur: Node | null = next.firstNamedChild;
  while (cur) {
    if (cur.type === "import_spec") {
      const pathNode = cur.childForFieldName ? cur.childForFieldName("path") : null;
      if (pathNode && (pathNode.text === '"C"' || pathNode.text === "`C`")) return true;
    } else if (cur.type === "interpreted_string_literal" && cur.text === '"C"') {
      return true;
    }
    cur = cur.nextNamedSibling;
  }
  return false;
}

function collectComments(root: Node, text: string, lang: Lang): Comment[] {
  const results: Comment[] = [];
  let leadingBlockDone = false;

  function walk(node: Node): void {
    if (isCommentNode(node, lang)) {
      const raw = node.text ?? text.slice(node.startIndex, node.endIndex);
      const startRow = node.startPosition.row;
      const endRow = node.endPosition.row;

      if (!leadingBlockDone && startRow > 0) leadingBlockDone = true;
      const inLeadingBlock = !leadingBlockDone || startRow === 0;

      let exempt: boolean;
      let reason: string | undefined;
      if (lang === "go" && raw.startsWith("/*") && isGoCgoComment(node)) {
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
    return { ok: true, comments, errorRows: new Set() };
  }

  const errorRows = collectErrorRows(tree.rootNode);
  const allComments = collectComments(tree.rootNode, text, lang);
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
      result = result.slice(0, codeEnd) + after;
      touchedInlineRows.add(c.startRow);
      for (let r = c.startRow + 1; r <= c.endRow; r++) {
        if (!deletedOrigRows.has(r)) {
          deletedOrigRows.add(r);
          rowChanges.push({ origRow: r, kind: "deleted", origText: origLines[r] ?? "" });
        }
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


type RowChangeKind = "deleted" | "modified";
export interface RowChange { origRow: number; kind: RowChangeKind; origText: string; fixedText?: string }

export type AutoFixResult =
  | { ok: true; fixed: string; removed: number; kept: number; total: number; rowChanges: RowChange[] }
  | { ok: false; reason: string };


function collectCodeText(root: Node, text: string, lang: Lang): string {
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
  return parts.join("");
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

export async function autoFix(
  text: string,
  lang: Lang,
  addedRows: Set<number>,
  getParser?: GetParserFn,
  netNewRows?: Set<number>,
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
  const maxAllowedRows = Math.floor(0.05 * addedRows.size);

  if (totalCandidateRows <= maxAllowedRows) {
    return { ok: true, fixed: text, removed: 0, kept: candidates.length, total: candidates.length, rowChanges: [] };
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

  let keptRows = 0;
  let keepCount = 0;
  for (const c of candidates) {
    const rows = commentRowCount(c);
    if (keptRows + rows <= maxAllowedRows) {
      keptRows += rows;
      keepCount++;
    } else {
      break;
    }
  }

  // Whole-line removals shrink the added-row denominator; loop until post-fix density ≤5/100.
  while (keepCount >= 0) {
    const removedCands = candidates.slice(keepCount);
    const wlRemovedRows = stripComments(text, removedCands).rowChanges.filter(
      rc => rc.kind === "deleted" && addedRows.has(rc.origRow),
    ).length;
    const remappedSize = addedRows.size - wlRemovedRows;
    if (remappedSize <= 0 || (keptRows + extraEffective) / remappedSize * 100 <= 5) break;
    if (keepCount === 0) return { ok: false, reason: "still over cap after fix" };
    keptRows -= commentRowCount(candidates[keepCount - 1]);
    keepCount--;
  }
  if (keepCount < 0) return { ok: false, reason: "still over cap after fix" };

  const toRemove = candidates.slice(keepCount);
  const { text: fixed, rowChanges } = stripComments(text, toRemove);

  const fp = await findComments(fixed, lang, getParser);
  if (!fp.ok) return { ok: false, reason: `post-strip parse: ${fp.reason}` };

  const pr = await getParser(lang);
  if (!pr.ok) return { ok: false, reason: `parser: ${pr.reason}` };
  const origCode = collectCodeText(pr.parser.parse(text).rootNode, text, lang);
  const fixedCode = collectCodeText(pr.parser.parse(fixed).rootNode, fixed, lang);
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

  return { ok: true, fixed, removed: toRemove.length, kept: keepCount, total: candidates.length, rowChanges };
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
