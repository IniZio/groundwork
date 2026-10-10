import type { Node } from '../../../src/hooks/lib/tree-sitter.js';
import { buildNodeIndex, type NodeIndex } from '../../../src/engine/grouped-rule.js';

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

function isHit(node: Node): boolean {
  if (node.parent?.type !== 'object') return false;
  const arg = node.namedChildren[0];
  const cond = arg ? unwrap(arg) : null;
  return (
    cond?.type === 'ternary_expression' &&
    (isEmptyObject(cond.childForFieldName('consequence')) || isEmptyObject(cond.childForFieldName('alternative')))
  );
}

export function check(root: Node, _source: string, index?: NodeIndex): { node: Node; message: string }[] {
  const hits = (index ?? buildNodeIndex(root)).byType('spread_element').filter(isHit);
  return hits.map((node) => ({
    node,
    message:
      'This conditional spread hides property omission behind an empty object. Build the object in separate statements and add the property only when present.',
  }));
}
