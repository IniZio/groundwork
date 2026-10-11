import type { Node } from '../../../src/hooks/lib/tree-sitter.js';
import { buildNodeIndex, type CheckHit, type NodeIndex } from '../../../src/engine/grouped-rule.js';

export const id = 'no-runtime-typeof';
export const upstream = "https://github.com/dmmulroy/anti-slop/blob/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b/src/rules/no-runtime-typeof.ts";

const MESSAGE = 'A `typeof` check narrows a representation without establishing its contract. Parse input at its I/O boundary, then branch on the domain value.';
const COMPARISONS = new Set(['===', '!==', '==', '!=']);

function isUndefinedLiteral(node: Node | null): boolean {
  return node?.type === 'string' && node.namedChildren.length <= 1 && node.text.slice(1, -1) === 'undefined';
}

/** Whether typeof safely probes for the existence of a possibly absent binding. */
function isExistenceProbe(node: Node): boolean {
  const parent = node.parent;
  if (parent?.type !== 'binary_expression') return false;
  if (!COMPARISONS.has(parent.childForFieldName('operator')?.text ?? '')) return false;
  const left = parent.childForFieldName('left');
  const other = left?.id === node.id ? parent.childForFieldName('right') : left;
  return isUndefinedLiteral(other ?? null);
}

export function check(root: Node, _source: string, index?: NodeIndex): CheckHit[] {
  return (index ?? buildNodeIndex(root))
    .byType('unary_expression')
    .filter((node) => node.childForFieldName('operator')?.text === 'typeof' && !isExistenceProbe(node))
    .map((node) => ({ node, message: MESSAGE }));
}
