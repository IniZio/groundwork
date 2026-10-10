import type { Node } from '../../../src/hooks/lib/tree-sitter.js';
import { buildNodeIndex, type CheckHit, type NodeIndex } from '../../../src/engine/grouped-rule.js';

export const id = 'no-unknown-parameters';
export const upstream = "https://github.com/dmmulroy/anti-slop/blob/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b/src/rules/no-unknown-parameters.ts";
export const tsOnly = true;

const PARAMETER_TYPES = new Set(['required_parameter', 'optional_parameter']);
const EXEMPT_NAMES = new Set(['cause']);

function hasUnknown(type: Node | null): boolean {
  if (!type) return false;
  switch (type.type) {
    case 'predefined_type':
      return type.text === 'unknown';
    case 'parenthesized_type':
    case 'union_type':
      return type.namedChildren.some((child: Node | null) => hasUnknown(child));
    default:
      return false;
  }
}

function predicateName(owner: Node): string | null {
  const returned = owner.childForFieldName('return_type') ?? owner.childForFieldName('type');
  const stack: Node[] = returned ? [returned] : [];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === 'type_predicate') return node.childForFieldName('name')?.text ?? null;
    if (node.type === 'formal_parameters') continue;
    for (const child of node.namedChildren) stack.push(child);
  }
  return null;
}

function bindingName(pattern: Node): string {
  const inner = pattern.type === 'rest_pattern' ? (pattern.namedChildren[0] ?? pattern) : pattern;
  return inner.text.trim();
}

function visit(node: Node, hits: CheckHit[]): void {
  if (node.parent) {
    const guarded = predicateName(node.parent);
    for (const param of node.namedChildren) {
      if (!PARAMETER_TYPES.has(param.type)) continue;
      const pattern = param.childForFieldName('pattern');
      const annotation = param.childForFieldName('type');
      if (!pattern || !annotation || !hasUnknown(annotation.namedChildren[0] ?? null)) continue;
      const name = bindingName(pattern);
      if (EXEMPT_NAMES.has(name) || name === guarded) continue;
      hits.push({
        node: annotation,
        message: `Parameter \`${name}\` leaves input unparsed. Accept a named domain type; run the expected schema or parser at the I/O boundary before calling this function.`,
      });
    }
  }
}

export function check(root: Node, _source: string, index?: NodeIndex): CheckHit[] {
  const hits: CheckHit[] = [];
  for (const node of (index ?? buildNodeIndex(root)).byType('formal_parameters')) visit(node, hits);
  return hits;
}
