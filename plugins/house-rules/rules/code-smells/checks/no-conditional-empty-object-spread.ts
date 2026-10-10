import type { Node } from '../../../src/hooks/lib/tree-sitter.js';

export const id = 'no-conditional-empty-object-spread';
export const upstream = "https://github.com/dmmulroy/anti-slop/blob/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b/src/rules/no-conditional-empty-object-spread.ts";

function unwrap(node: Node): Node {
  let current = node;
  while (current.type === 'parenthesized_expression' && current.namedChildren[0]) current = current.namedChildren[0];
  return current;
}

function isEmptyObject(node: Node | null): boolean {
  return !!node && node.type === 'object' && node.namedChildren.length === 0;
}

function walk(node: Node, hits: Node[]): void {
  if (node.type === 'spread_element' && node.parent?.type === 'object') {
    const arg = node.namedChildren[0];
    const cond = arg ? unwrap(arg) : null;
    if (
      cond?.type === 'ternary_expression' &&
      (isEmptyObject(cond.childForFieldName('consequence')) || isEmptyObject(cond.childForFieldName('alternative')))
    ) {
      hits.push(node);
    }
  }
  for (const child of node.children) if (child) walk(child, hits);
}

export function check(root: Node, _source: string): { node: Node; message: string }[] {
  const hits: Node[] = [];
  walk(root, hits);
  return hits.map((node) => ({
    node,
    message:
      'This conditional spread hides property omission behind an empty object. Build the object in separate statements and add the property only when present.',
  }));
}
