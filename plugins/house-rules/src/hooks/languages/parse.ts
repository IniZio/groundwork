import type { Node, Tree } from "../lib/tree-sitter.js";
import { type LoadResult } from "../lib/tree-sitter-loader.js";
import { type Language, type GrammarVariantId, LANGUAGE_ADAPTERS, grammarVariantForPath } from "./registry.js";
import { defaultClassifyComments, defaultIsCommentNodeType, applyCommonConventions, type ClassifiedComment } from "./comments.js";

export type ParserFactory = (lang: Language, variant?: GrammarVariantId) => Promise<LoadResult>;

export function parserForPath(factory: ParserFactory, filePath: string): ParserFactory {
  return (lang, v) => factory(lang, v ?? grammarVariantForPath(lang, filePath));
}

export function isCommentNode(node: Node, lang: Language): boolean {
  return (LANGUAGE_ADAPTERS[lang].isCommentNodeType ?? defaultIsCommentNodeType)(node.type);
}

export function collectErrorRows(root: Node, lang?: Language): Set<number> {
  const result = new Set<number>();

  function effectiveEndRow(node: Node): number {
    if (node.endPosition.column === 0 && node.endPosition.row > node.startPosition.row) {
      return node.endPosition.row - 1;
    }
    return node.endPosition.row;
  }

  function isComment(node: Node): boolean {
    return lang !== undefined ? isCommentNode(node, lang) : node.type.includes("comment");
  }

  function walk(node: Node): void {
    if (node.isMissing) {
      result.add(node.startPosition.row);
      return;
    }

    if (node.type !== "ERROR") {
      // Non-ERROR node: just recurse into children to find nested ERROR/MISSING.
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) walk(child);
      }
      return;
    }

    const nodeEffEnd = effectiveEndRow(node);

    // ERROR node with no children: mark every row in its span.
    if (node.childCount === 0) {
      for (let r = node.startPosition.row; r <= nodeEffEnd; r++) result.add(r);
      return;
    }

    const sizeBefore = result.size;

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!;
      if (isComment(child)) continue;
      if (!child.isNamed || child.childCount === 0) {
        const end = effectiveEndRow(child);
        for (let r = child.startPosition.row; r <= end; r++) result.add(r);
      }
    }

    const childCoverage = new Set<number>();
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!;
      const end = effectiveEndRow(child);
      for (let r = child.startPosition.row; r <= end; r++) childCoverage.add(r);
    }
    for (let r = node.startPosition.row; r <= nodeEffEnd; r++) {
      if (!childCoverage.has(r)) result.add(r);
    }

    if (result.size === sizeBefore) {
      for (let r = node.startPosition.row; r <= nodeEffEnd; r++) result.add(r);
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!;
      if (child.hasError) walk(child);
    }
  }

  walk(root);
  return result;
}

export interface RawComment {
  startIndex: number;
  endIndex: number;
  startRow: number;
  endRow: number;
  text: string;
  nodeType: string;
}

export function collectRawComments(root: Node, text: string, lang: Language): RawComment[] {
  const results: RawComment[] = [];

  function walk(node: Node): void {
    if (isCommentNode(node, lang)) {
      results.push({
        startIndex: node.startIndex,
        endIndex: node.endIndex,
        startRow: node.startPosition.row,
        endRow: node.endPosition.row,
        text: node.text ?? text.slice(node.startIndex, node.endIndex),
        nodeType: node.type,
      });
      return; // do NOT descend
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walk(child);
    }
  }

  walk(root);
  return results;
}

export function classifyComments(root: Node, text: string, lang: Language): ClassifiedComment[] {
  const raw = collectRawComments(root, text, lang);
  const classify = LANGUAGE_ADAPTERS[lang].classifyComments ?? defaultClassifyComments;
  return applyCommonConventions(classify(raw, root, text));
}

export type ParseResult =
  | { ok: true; tree: Tree; errorRows: Set<number> }
  | { ok: false; reason: string };

export async function parseText(
  text: string,
  lang: Language,
  factory: ParserFactory,
): Promise<ParseResult> {
  const r = await factory(lang);
  if (!r.ok) return { ok: false, reason: r.reason };

  const tree: Tree | null = r.parser.parse(text);
  if (!tree) return { ok: false, reason: "parse returned null" };

  const errorRows = tree.rootNode.hasError ? collectErrorRows(tree.rootNode, lang) : new Set<number>();
  return { ok: true, tree, errorRows };
}
