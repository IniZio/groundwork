import type { Node } from '../../../src/hooks/lib/tree-sitter.js';
import { environment, resolvedTypeMatches, type TypeAliasEnvironment } from '../../../src/analysis/type-alias-resolution.js';
import { parseWith } from '../validators.js';
import type { ProjectFacts } from '../../../src/engine/project-deps.js';
import { buildNodeIndex, type CheckHit, type NodeIndex } from '../../../src/engine/grouped-rule.js';

export const id = 'no-object-parameters';
export const upstream = "https://github.com/dmmulroy/anti-slop/blob/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b/src/rules/no-object-parameters.ts";
export const tsOnly = true;

const PARAMETER_TYPES = new Set(['required_parameter', 'optional_parameter']);

function isObject(type: Node, matches: (child: Node) => boolean): boolean {
  if (type.type === 'predefined_type') return type.text === 'object';
  if (type.type === 'parenthesized_type' || type.type === 'union_type') {
    return type.namedChildren.some((c: Node) => matches(c));
  }
  return false;
}

function bindingName(pattern: Node): string {
  const inner = pattern.type === 'rest_pattern' ? (pattern.namedChildren[0] ?? pattern) : pattern;
  return inner.text.trim();
}

function visit(node: Node, env: TypeAliasEnvironment, using: string, hits: CheckHit[]): void {
  for (const param of node.namedChildren) {
    if (!PARAMETER_TYPES.has(param.type)) continue;
    const pattern = param.childForFieldName('pattern');
    const annotation = param.childForFieldName('type');
    const type = annotation?.namedChildren[0];
    if (!pattern || !annotation || !type || !resolvedTypeMatches(type, env, isObject)) continue;
    hits.push({
      node: annotation,
      message: `Parameter \`${bindingName(pattern)}\` uses the broad \`object\` type, which gives callers no shape. Accept a named domain type and parse external input into it at the boundary with ${using}; \`Record<string, unknown>\` or \`{}\` is the same defect.`,
    });
  }
}

export function check(
  root: Node, _source: string, index?: NodeIndex, _filePath?: string, _options?: Readonly<Record<string, unknown>>,
  project?: ProjectFacts,
): CheckHit[] {
  const idx = index ?? buildNodeIndex(root);
  const env = environment(root, idx);
  const hits: CheckHit[] = [];
  for (const params of idx.byType('formal_parameters')) visit(params, env, parseWith(project), hits);
  return hits;
}
