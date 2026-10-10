import type { Node } from '../../../src/hooks/lib/tree-sitter.js';
import { environment, resolvedTypeMatches } from '../../../src/analysis/type-alias-resolution.js';
import { buildNodeIndex, type CheckHit, type NodeIndex } from '../../../src/engine/grouped-rule.js';

export const id = 'no-unknown-type-aliases';
export const upstream = "https://github.com/dmmulroy/anti-slop/blob/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b/src/rules/no-unknown-type-aliases.ts";
export const tsOnly = true;

function isUnknown(type: Node, matches: (child: Node) => boolean): boolean {
  if (type.type === 'predefined_type') return type.text === 'unknown';
  if (type.type === 'parenthesized_type' || type.type === 'union_type') {
    return type.namedChildren.some((child: Node | null) => child !== null && matches(child));
  }
  return false;
}

export function check(root: Node, _source: string, index?: NodeIndex): CheckHit[] {
  const env = environment(root, index ?? buildNodeIndex(root));
  const hits: CheckHit[] = [];
  for (const decl of env.aliases) {
    const name = decl.childForFieldName('name');
    const value = decl.childForFieldName('value');
    if (!name || !value || !resolvedTypeMatches(value, env, isUnknown)) continue;
    hits.push({
      node: name,
      message: `Type alias \`${name.text}\` hides \`unknown\`. Keep \`unknown\` explicit at the parsing boundary or on an allowed \`cause\` field; otherwise use the parsed owner type.`,
    });
  }
  return hits;
}
