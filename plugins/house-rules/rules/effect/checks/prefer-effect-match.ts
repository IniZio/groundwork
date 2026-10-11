import type { Node } from '../../../src/hooks/lib/tree-sitter.js';
import { buildNodeIndex, type CheckHit, type NodeIndex } from '../../../src/engine/grouped-rule.js';

export const id = 'prefer-effect-match';
export const upstream = "https://github.com/dmmulroy/anti-slop/blob/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b/src/effect/rules/prefer-effect-match.ts";

const MESSAGE = 'Use Match from Effect instead of a chained literal ternary.';
const EQUALITY = new Set(['==', '===', '!=', '!==']);
const LITERALS = new Set(['string', 'number', 'true', 'false', 'null', 'regex']);

function unparen(node: Node): Node {
  let cur = node;
  while (cur.type === 'parenthesized_expression' && cur.namedChildren[0]) cur = cur.namedChildren[0];
  return cur;
}

function isLiteral(node: Node): boolean {
  return LITERALS.has(node.type) || (node.type === 'template_string' && !node.namedChildren.some((c: Node) => c.type === 'template_substitution'));
}

/** Text of the non-literal side of a literal equality comparison, if the test is one. */
function comparedValue(test: Node | null): string | undefined {
  if (!test) return undefined;
  const node = unparen(test);
  if (node.type !== 'binary_expression') return undefined;
  if (!EQUALITY.has(node.childForFieldName('operator')?.text ?? '')) return undefined;
  const left = node.childForFieldName('left');
  const right = node.childForFieldName('right');
  if (!left || !right) return undefined;
  const l = unparen(left);
  const r = unparen(right);
  if (isLiteral(l)) return r.text;
  if (isLiteral(r)) return l.text;
  return undefined;
}

function hasTernaryParent(node: Node): boolean {
  let parent = node.parent;
  while (parent?.type === 'parenthesized_expression') parent = parent.parent;
  return parent?.type === 'ternary_expression';
}

export function check(root: Node, _source: string, index?: NodeIndex, _filePath?: string): CheckHit[] {
  const hits: CheckHit[] = [];
  for (const node of (index ?? buildNodeIndex(root)).byType('ternary_expression')) {
    if (hasTernaryParent(node)) continue;
    const value = comparedValue(node.childForFieldName('condition'));
    if (value === undefined) continue;
    let alternate = unparen(node.childForFieldName('alternative') ?? node);
    let checks = 1;
    let same = true;
    while (alternate.type === 'ternary_expression') {
      if (comparedValue(alternate.childForFieldName('condition')) !== value) { same = false; break; }
      checks += 1;
      alternate = unparen(alternate.childForFieldName('alternative') ?? alternate);
    }
    if (same && checks > 1) hits.push({ node, message: MESSAGE });
  }
  return hits;
}
