import type { Node } from '../../../src/hooks/lib/tree-sitter.js';
import { buildNodeIndex, type CheckHit, type NodeIndex } from '../../../src/engine/grouped-rule.js';

export const id = 'no-chained-type-assertions';
export const upstream = "https://github.com/dmmulroy/anti-slop/blob/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b/src/rules/no-chained-type-assertions.ts";
export const tsOnly = true;

const MESSAGE = 'This assertion chain discards type evidence. Keep the original precise type, or parse untrusted input at its boundary before narrowing it.';

const isAssertion = (node: Node): boolean => node.type === 'as_expression' || node.type === 'type_assertion';

function isConst(node: Node): boolean {
  if (node.type === 'type_assertion') return node.namedChildren[0]?.child(1)?.type === 'const';
  return node.child(node.childCount - 1)?.type === 'const';
}

function operand(node: Node): Node | null {
  const named = node.namedChildren;
  return (node.type === 'as_expression' ? named[0] : named[named.length - 1]) ?? null;
}

function unwrap(node: Node | null): Node | null {
  let current = node;
  while (current?.type === 'parenthesized_expression') current = current.namedChildren[0] ?? null;
  return current;
}

function isOutermost(node: Node): boolean {
  let current = node;
  let parent = node.parent;
  while (parent?.type === 'parenthesized_expression') {
    current = parent;
    parent = parent.parent;
  }
  return !parent || !isAssertion(parent) || operand(parent)?.id !== current.id;
}

function isForbiddenChain(node: Node): boolean {
  let count = 0;
  let nonConst = false;
  let current: Node | null = node;
  while (current && isAssertion(current)) {
    count += 1;
    nonConst ||= !isConst(current);
    current = unwrap(operand(current));
  }
  return count > 1 && nonConst;
}

export function check(root: Node, _source: string, index?: NodeIndex): CheckHit[] {
  const idx = index ?? buildNodeIndex(root);
  const hits: CheckHit[] = [];
  for (const node of [...idx.byType('as_expression'), ...idx.byType('type_assertion')].sort((a, b) => a.startIndex - b.startIndex || b.endIndex - a.endIndex)) {
    if (isOutermost(node) && isForbiddenChain(node)) hits.push({ node, message: MESSAGE });
  }
  return hits;
}
