import path from "node:path";
import { realpathSync } from "node:fs";
import { getParser as defaultGetParser, type Lang } from "./tree-sitter-loader.js";
import type { Node } from "./tree-sitter.js";

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
  | { ok: true; comments: Comment[] }
  | { ok: false; reason: string };

export type DensityResult = {
  mode: "tree-sitter" | "fallback";
  total: number;
  effective: number;
  commentRows: number[];
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

function isExemptInner(inner: string): boolean {
  return (
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
  );
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
  if (raw.trimStart().startsWith("/**")) {
    return { exempt: true, reason: "jsdoc" };
  }

  for (const line of raw.split("\n")) {
    const inner = stripMarkers(line);
    if (!inner) continue;
    if (lang === "dockerfile" && inLeadingBlock && DOCKERFILE_DIRECTIVE_RE.test(inner)) {
      return { exempt: true, reason: "dockerfile-directive" };
    }
    if (isExemptInner(inner)) {
      return { exempt: true, reason: inner.slice(0, 30) };
    }
  }

  return { exempt: false };
}

function collectComments(root: Node, text: string, lang: Lang): Comment[] {
  const results: Comment[] = [];
  let leadingBlockDone = false;

  function walk(node: Node): void {
    if (node.type.includes("comment")) {
      const raw = node.text ?? text.slice(node.startIndex, node.endIndex);
      const startRow = node.startPosition.row;
      const endRow = node.endPosition.row;

      if (!leadingBlockDone && startRow > 0) leadingBlockDone = true;
      const inLeadingBlock = !leadingBlockDone || startRow === 0;

      const { exempt, reason } = checkExempt(node.type, raw, startRow, lang, inLeadingBlock);
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

export async function findComments(
  text: string,
  lang: Lang,
  getParser: GetParserFn = defaultGetParser,
): Promise<FindResult> {
  const result = await getParser(lang);
  if (!result.ok) return { ok: false, reason: result.reason };

  const { parser } = result;
  const tree = parser.parse(text);
  if (tree.rootNode.hasError) {
    return { ok: false, reason: "parse-error" };
  }
  const comments = collectComments(tree.rootNode, text, lang);
  return { ok: true, comments };
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

export function stripComments(text: string, comments: Comment[]): string {
  const sorted = [...comments].sort((a, b) => b.startIndex - a.startIndex);
  let result = text;

  for (const c of sorted) {
    const before = result.slice(0, c.startIndex);
    const after = result.slice(c.endIndex);

    const lineStart = before.lastIndexOf("\n") + 1;
    const beforeOnLine = before.slice(lineStart);
    const isWholeLine = !beforeOnLine.trim();

    if (isWholeLine) {
      const lineEnd = after.indexOf("\n");
      const trailingNewline = lineEnd !== -1 ? after.slice(lineEnd) : "";
      const prefix = lineStart > 0 ? result.slice(0, lineStart - 1) : "";
      if (lineStart > 0) {
        result = prefix + trailingNewline;
      } else {
        result = lineEnd !== -1 ? after.slice(lineEnd + 1) : "";
      }
    } else {
      const wsStart = before.search(/\s+$/);
      const codeEnd = wsStart !== -1 ? wsStart : c.startIndex;
      result = result.slice(0, codeEnd) + after;
    }
  }

  return result;
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

const HASH_COMMENT_LANGS = new Set<Lang>(["bash", "yaml", "python", "dockerfile"]);

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

let _fixtureBase: string | null | undefined;

function fixtureBase(): string | null {
  if (_fixtureBase !== undefined) return _fixtureBase;
  try {
    const root = realpathSync(path.resolve(import.meta.dir, "../../.."));
    _fixtureBase = root + path.sep + "test" + path.sep + "fixtures" + path.sep;
  } catch {
    _fixtureBase = null;
  }
  return _fixtureBase;
}

function realpathLoose(p: string): string {
  try { return realpathSync(p); } catch { }
  try { return path.join(realpathSync(path.dirname(p)), path.basename(p)); } catch { }
  return path.resolve(p);
}

export function isPluginFixture(filePath: string): boolean {
  const base = fixtureBase();
  if (!base) return false;
  return realpathLoose(filePath).startsWith(base);
}

export type AutoFixResult =
  | { ok: true; fixed: string; removed: number; kept: number; total: number }
  | { ok: false; reason: string };

function commentIsWholeLine(c: Comment, text: string): boolean {
  const lineStart = text.lastIndexOf("\n", c.startIndex - 1) + 1;
  return !text.slice(lineStart, c.startIndex).trim();
}

function collectCodeText(root: Node, text: string): string {
  const parts: string[] = [];
  function walk(node: Node): void {
    if (node.type.includes("comment")) return;
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

export async function autoFix(
  text: string,
  lang: Lang,
  addedRows: Set<number>,
  getParser: GetParserFn = defaultGetParser,
): Promise<AutoFixResult> {
  const origParsed = await findComments(text, lang, getParser);
  if (!origParsed.ok) return { ok: false, reason: `parse: ${origParsed.reason}` };

  const candidates: Comment[] = [];
  for (const c of origParsed.comments) {
    if (c.exempt) continue;
    let hit = false;
    for (let r = c.startRow; r <= c.endRow && !hit; r++) hit = addedRows.has(r);
    if (hit) candidates.push(c);
  }

  let budget = Math.floor(0.05 * addedRows.size);
  if (candidates.length <= budget) {
    return { ok: true, fixed: text, removed: 0, kept: candidates.length, total: candidates.length };
  }

  while (budget > 0) {
    const toCheck = candidates.slice(budget);
    const wlRemoved = toCheck.filter(c => commentIsWholeLine(c, text)).length;
    if (budget <= Math.floor(0.05 * (addedRows.size - wlRemoved))) break;
    budget--;
  }

  const toRemove = candidates.slice(budget);
  const fixed = stripComments(text, toRemove);

  const fp = await findComments(fixed, lang, getParser);
  if (!fp.ok) return { ok: false, reason: `post-strip parse: ${fp.reason}` };

  const pr = await getParser(lang);
  if (!pr.ok) return { ok: false, reason: `parser: ${pr.reason}` };
  const origCode = collectCodeText(pr.parser.parse(text).rootNode, text);
  const fixedCode = collectCodeText(pr.parser.parse(fixed).rootNode, fixed);
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

  return { ok: true, fixed, removed: toRemove.length, kept: budget, total: candidates.length };
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
      return { mode: "tree-sitter", total, effective: commentRows.length, commentRows };
    }
  }

  const fb = countEffectiveFallback(text, lang);
  const commentRows = rows
    ? fb.commentRows.filter(r => rows.has(r))
    : fb.commentRows;
  return { mode: "fallback", total, effective: commentRows.length, commentRows };
}
