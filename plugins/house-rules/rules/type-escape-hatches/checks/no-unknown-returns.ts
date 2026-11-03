import type { Node } from '../../../src/hooks/lib/tree-sitter.js';
import { environment, hasVisibleTypeBinding, resolvedTypeMatches, type ResolvedTypeMatcher, type TypeAliasEnvironment } from '../../../src/analysis/type-alias-resolution.js';
import { parseWith } from '../validators.js';
import type { ProjectFacts } from '../../../src/engine/project-deps.js';
import { buildNodeIndex, type CheckHit, type NodeIndex } from '../../../src/engine/grouped-rule.js';

export const id = 'no-unknown-returns';
export const upstream = "https://github.com/dmmulroy/anti-slop/blob/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b/src/rules/no-unknown-returns.ts";
export const tsOnly = true;

const message = (using: string): string =>
  `This function returns \`unknown\`, so every caller must check the value again. Parse it here with ${using} and return the named domain type; moving the \`typeof\` checks to callers is the same defect.`;
const OWNERS = new Set([
  'function_declaration', 'generator_function_declaration', 'function_expression', 'generator_function',
  'arrow_function', 'method_definition', 'function_signature', 'abstract_method_signature',
  'method_signature', 'call_signature', 'construct_signature', 'function_type', 'constructor_type',
]);
const PROMISES = new Set(['Promise', 'PromiseLike']);
function isUnknown(env: TypeAliasEnvironment): ResolvedTypeMatcher {
  return (type, matches) => {
    switch (type.type) {
      case 'predefined_type':
        return type.text === 'unknown';
      case 'parenthesized_type':
      case 'union_type':
        return type.namedChildren.some((child: Node | null) => child !== null && matches(child));
      case 'generic_type': {
        const name = type.childForFieldName('name');
        if (!name || name.type !== 'type_identifier' || !PROMISES.has(name.text)) return false;
        if (hasVisibleTypeBinding(name.text, name, env)) return false;
        const first = type.childForFieldName('type_arguments')?.namedChildren[0];
        return first != null && matches(first);
      }
      default:
        return false;
    }
  };
}

function returnedType(owner: Node): Node | null {
  const field = owner.childForFieldName('return_type') ?? owner.childForFieldName('type');
  if (!field) return null;
  return field.type === 'type_annotation' ? (field.namedChildren[0] ?? null) : field;
}

export function check(
  root: Node, _source: string, index?: NodeIndex, _filePath?: string, _options?: Readonly<Record<string, unknown>>,
  project?: ProjectFacts,
): CheckHit[] {
  const nodes = index ?? buildNodeIndex(root);
  const env = environment(root, nodes);
  const matcher = isUnknown(env);
  const hits: CheckHit[] = [];
  for (const node of nodes.all) {
    if (!OWNERS.has(node.type)) continue;
    const returned = returnedType(node);
    if (returned && resolvedTypeMatches(returned, env, matcher)) hits.push({ node: returned, message: message(parseWith(project)) });
  }
  return hits;
}
