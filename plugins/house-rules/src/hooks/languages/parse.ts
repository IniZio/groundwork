import type { Node, Tree } from "../lib/tree-sitter.js";
import { type LoadResult } from "../lib/tree-sitter-loader.js";
import { type Language, LANGUAGE_ADAPTERS } from "./registry.js";
import { defaultClassifyComments, defaultIsCommentNodeType, applyCommonConventions, type ClassifiedComment } from "./comments.js";

export type ParserFactory = (lang: Language) => Promise<LoadResult>;

export function isCommentNode(node: Node, lang: Language): boolean {
  return (LANGUAGE_ADAPTERS[lang].isCommentNodeType ?? defaultIsCommentNodeType)(node.type);
}

export function collectErrorRows(root: Node): Set<number> {
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

  const errorRows = tree.rootNode.hasError ? collectErrorRows(tree.rootNode) : new Set<number>();
  return { ok: true, tree, errorRows };
}
