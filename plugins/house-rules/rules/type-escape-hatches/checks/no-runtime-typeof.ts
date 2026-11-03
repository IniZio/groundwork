import type { Node } from '../../../src/hooks/lib/tree-sitter.js';
import { orList, projectValidators } from '../validators.js';
import type { ProjectFacts } from '../../../src/engine/project-deps.js';
import { buildNodeIndex, type CheckHit, type NodeIndex } from '../../../src/engine/grouped-rule.js';

export const id = 'no-runtime-typeof';
export const upstream = "https://github.com/dmmulroy/anti-slop/blob/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b/src/rules/no-runtime-typeof.ts";

function message(project: ProjectFacts | undefined): string {
  const found = projectValidators(project);
  const remedy = found.length === 0
    ? 'Add a validator (ajv is a common choice) or a single named parse function,'
    : `Parse the input once with ${orList(found)}, which this project already depends on,`;
  return `A \`typeof\` check is hand-written shape testing, not parsing, even at the I/O boundary. ${remedy} then branch on the typed result.`;
}
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

const FUNCTION_TYPES = new Set([
  'arrow_function', 'function_declaration', 'function_expression', 'function', 'generator_function',
  'generator_function_declaration', 'method_definition',
]);
const PREDICATE_TYPES = new Set(['type_predicate_annotation', 'asserts_annotation']);

/** Whether the nearest enclosing function declares a type predicate return type. */
function isInsideTypeGuard(node: Node): boolean {
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (FUNCTION_TYPES.has(cur.type)) return PREDICATE_TYPES.has(cur.childForFieldName('return_type')?.type ?? '');
  }
  return false;
}

export function check(
  root: Node, _source: string, index?: NodeIndex, _filePath?: string, options?: Readonly<Record<string, unknown>>,
  project?: ProjectFacts,
): CheckHit[] {
  const text = message(project);
  const allowInTypeGuards = options?.allowInTypeGuards === true;
  return (index ?? buildNodeIndex(root))
    .byType('unary_expression')
    .filter((node) => node.childForFieldName('operator')?.text === 'typeof' && !isExistenceProbe(node))
    .filter((node) => !allowInTypeGuards || !isInsideTypeGuard(node))
    .map((node) => ({ node, message: text }));
}
