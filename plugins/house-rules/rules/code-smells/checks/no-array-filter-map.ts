import type { Node } from '../../../src/hooks/lib/tree-sitter.js';
import { arrayMethodTarget, isKnownArrayExpression, unwrap } from '../../../src/analysis/array-method.js';
import { buildNodeIndex, type NodeIndex } from '../../../src/engine/grouped-rule.js';

export const id = 'no-array-filter-map';
export const upstream = "https://github.com/dmmulroy/anti-slop/blob/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b/src/rules/no-array-filter-map.ts";

function isFilterMap(call: Node): boolean {
  const outer = arrayMethodTarget(call.childForFieldName('function') ?? call);
  if (!outer || (outer.name !== 'map' && outer.name !== 'filter')) return false;
  const innerCall = unwrap(outer.object);
  if (innerCall.type !== 'call_expression') return false;
  const inner = arrayMethodTarget(innerCall.childForFieldName('function') ?? innerCall);
  if (!inner || inner.name !== (outer.name === 'map' ? 'filter' : 'map')) return false;
  return isKnownArrayExpression(inner.object);
}

export function check(root: Node, _source: string, index?: NodeIndex): { node: Node; message: string }[] {
  const hits = (index ?? buildNodeIndex(root)).byType('call_expression').filter(isFilterMap);
  return hits.map((node) => {
    const outer = arrayMethodTarget(node.childForFieldName('function') ?? node)!;
    const first = outer.name === 'map' ? 'filter' : 'map';
    return {
      node,
      message: `Avoid consecutive array \`${first}\` and \`${outer.name}\` passes. Prefer \`.values().${first}(...).${outer.name}(...).toArray()\` where iterator helpers are supported, or a single \`flatMap\`/mutating reducer. Preserve callback ordering, indexes, and filtering semantics.`,
    };
  });
}
