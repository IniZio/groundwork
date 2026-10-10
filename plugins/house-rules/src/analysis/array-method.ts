/**
 * Shared array-method analysis, mirroring anti-slop `shared/array-method.ts` on top of lexical-bindings.
 * Known arrays: array literals, array-preserving method chains, const aliases of known arrays, and bindings
 * annotated `T[]`, `readonly T[]`, `Array<T>`, `ReadonlyArray<T>` or tuples (parenthesised forms included).
 * Any non-init write (assignment, destructuring, for-of/in target, update) disqualifies a binding.
 */
import type { Node } from '../hooks/lib/tree-sitter.js';
import { resolve, type Binding } from './lexical-bindings.js';

const ARRAY_PRESERVING = new Set(['map', 'filter', 'flatMap', 'slice', 'concat', 'toSorted', 'toReversed', 'toSpliced']);
const WRAPPERS = new Set([
  'parenthesized_expression',
  'non_null_expression',
  'as_expression',
  'satisfies_expression',
  'type_assertion',
]);

/** Unwrap syntax-only wrappers: parens, non-null, `as`, `satisfies`, `<T>x`. */
export function unwrap(node: Node): Node {
  let cur = node;
  while (WRAPPERS.has(cur.type)) {
    const inner = cur.type === 'type_assertion' ? cur.namedChildren[cur.namedChildren.length - 1] : cur.namedChildren[0];
    if (!inner) break;
    cur = inner;
  }
  return cur;
}

/** Read static method names, including computed string literals, without evaluating expressions. */
export function arrayMethodTarget(node: Node): { readonly name: string; readonly object: Node } | null {
  const target = unwrap(node);
  const object = target.childForFieldName('object');
  if (!object) return null;
  if (target.type === 'member_expression') {
    const property = target.childForFieldName('property');
    return property?.type === 'property_identifier' ? { name: property.text, object } : null;
  }
  if (target.type === 'subscript_expression') {
    const index = target.childForFieldName('index');
    return index?.type === 'string' ? { name: index.text.slice(1, -1), object } : null;
  }
  return null;
}

function isArrayAnnotation(type: Node | null): boolean {
  if (!type) return false;
  switch (type.type) {
    case 'type_annotation':
    case 'parenthesized_type':
    case 'readonly_type':
      return isArrayAnnotation(type.namedChildren[0] ?? null);
    case 'array_type':
    case 'tuple_type':
      return true;
    case 'generic_type': {
      const name = type.childForFieldName('name');
      return name?.type === 'type_identifier' && (name.text === 'Array' || name.text === 'ReadonlyArray');
    }
    default:
      return false;
  }
}

function declaredType(id: Node): Node | null {
  const parent = id.parent;
  if (!parent) return null;
  const owns = (field: string): boolean => parent.childForFieldName(field)?.id === id.id;
  if (parent.type === 'variable_declarator' && owns('name')) return parent.childForFieldName('type');
  if ((parent.type === 'required_parameter' || parent.type === 'optional_parameter') && owns('pattern')) {
    return parent.childForFieldName('type');
  }
  return null;
}

function isConstAlias(id: Node): Node | null {
  const declarator = id.parent;
  if (declarator?.type !== 'variable_declarator' || declarator.childForFieldName('name')?.id !== id.id) return null;
  if (declarator.parent?.type !== 'lexical_declaration') return null;
  if (!declarator.parent.children.some((c: Node | null) => c?.type === 'const')) return null;
  return declarator.childForFieldName('value');
}

/** Recognize local array evidence; unknown receivers and iterator pipelines are deliberately excluded. */
export function isKnownArrayExpression(node: Node, visited: Set<Binding> = new Set()): boolean {
  const expr = unwrap(node);
  if (expr.type === 'array') return true;
  if (expr.type === 'call_expression') {
    const callee = expr.childForFieldName('function');
    const method = callee ? arrayMethodTarget(callee) : null;
    return method !== null && ARRAY_PRESERVING.has(method.name) && isKnownArrayExpression(method.object, visited);
  }
  if (expr.type !== 'identifier') return false;
  const binding = resolve(expr, 'value');
  if (!binding || visited.has(binding)) return false;
  visited.add(binding);
  if (binding.references.some((r) => r.isWrite && !r.init)) return false;
  const annotation = declaredType(binding.id);
  if (annotation) return isArrayAnnotation(annotation);
  if (binding.kind !== 'const') return false;
  const init = isConstAlias(binding.id);
  return init ? isKnownArrayExpression(init, visited) : false;
}
