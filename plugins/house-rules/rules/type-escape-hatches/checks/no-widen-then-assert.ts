import type { Node } from '../../../src/hooks/lib/tree-sitter.js';
import { buildNodeIndex, type CheckHit, type NodeIndex } from '../../../src/engine/grouped-rule.js';
import { resolve, type Binding } from '../../../src/analysis/lexical-bindings.js';

export const id = 'no-widen-then-assert';
export const upstream = "https://github.com/dmmulroy/anti-slop/blob/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b/src/rules/no-widen-then-assert.ts";
export const tsOnly = true;

type BroadTypeKind = 'top' | 'object' | 'record';
type Evidence = { readonly type: Node | null };

const FUNCTION_BOUNDARIES = new Set([
  'arrow_function',
  'function_declaration',
  'function_expression',
  'generator_function',
  'generator_function_declaration',
  'method_definition',
  'function_signature',
  'abstract_method_signature',
]);
const LITERALS = new Set(['number', 'string', 'template_string', 'regex', 'true', 'false', 'null']);
const VALUE_EXPRESSIONS = new Set([
  'array',
  'arrow_function',
  'class',
  'function_expression',
  'generator_function',
  'new_expression',
  'object',
]);

const named = (node: Node): Node[] => node.namedChildren.filter((c: Node | null): c is Node => c !== null && c.type !== 'comment');

const isAssertion = (node: Node): boolean => node.type === 'as_expression' || node.type === 'type_assertion';

function unwrapExpression(node: Node): Node {
  let current = node;
  while (current.type === 'parenthesized_expression') {
    const inner = named(current)[0];
    if (!inner) break;
    current = inner;
  }
  return current;
}

function unwrapType(node: Node): Node {
  let current = node;
  while (current.type === 'parenthesized_type') {
    const inner = named(current)[0];
    if (!inner) break;
    current = inner;
  }
  return current;
}

/** The asserted expression of `x as T` / `<T>x`. */
function assertedExpression(node: Node): Node | null {
  const parts = named(node);
  const expr = node.type === 'as_expression' ? parts[0] : parts[parts.length - 1];
  return expr ? unwrapExpression(expr) : null;
}

/** The asserted type of `x as T` / `<T>x`; `as const` yields the `const` token. */
function assertedType(node: Node): Node | null {
  if (node.type === 'type_assertion') {
    const args = named(node).find((c) => c.type === 'type_arguments');
    return args ? (named(args)[0] ?? args.child(1)) : null;
  }
  return named(node)[1] ?? node.child(node.childCount - 1);
}

function typeReferenceName(node: Node): string | null {
  if (node.type === 'type_identifier') return node.text;
  if (node.type !== 'generic_type') return null;
  const name = named(node)[0];
  return name?.type === 'type_identifier' ? name.text : null;
}

function typeArguments(node: Node): Node[] {
  if (node.type !== 'generic_type') return [];
  const args = named(node).find((c) => c.type === 'type_arguments');
  return args ? named(args) : [];
}

const predefined = (node: Node): string | null => (node.type === 'predefined_type' ? node.text : null);

function isUnknownOrAny(type: Node): boolean {
  const p = predefined(unwrapType(type));
  return p === 'unknown' || p === 'any';
}

function isMapped(node: Node): boolean {
  if (node.type !== 'object_type') return false;
  const members = named(node);
  return members.length === 1 && members[0]?.type === 'index_signature' && named(members[0]).some((c) => c.type === 'mapped_type_clause');
}

function isBroadRecordKey(type: Node): boolean {
  const t = unwrapType(type);
  const p = predefined(t);
  if (p === 'string' || p === 'number' || p === 'symbol') return true;
  if (t.type === 'union_type') return named(t).every(isBroadRecordKey);
  return (t.type === 'type_identifier' || t.type === 'generic_type') && typeReferenceName(t) === 'PropertyKey';
}

function isBroadRecord(type: Node): boolean {
  const t = unwrapType(type);
  if (t.type === 'type_identifier' || t.type === 'generic_type') {
    const name = typeReferenceName(t);
    const params = typeArguments(t);
    if (name === 'Readonly') return params[0] !== undefined && isBroadRecord(params[0]);
    if (name !== 'Record') return false;
    return params.length === 2 && params[0] !== undefined && params[1] !== undefined && isBroadRecordKey(params[0]) && isUnknownOrAny(params[1]);
  }
  if (t.type !== 'object_type' || isMapped(t)) return false;
  const members = named(t);
  const member = members[0];
  if (members.length !== 1 || member?.type !== 'index_signature') return false;
  const parts = named(member);
  const param = parts[1];
  const annotation = parts.find((c) => c.type === 'type_annotation');
  const value = annotation ? named(annotation)[0] : undefined;
  return param !== undefined && param.type !== 'type_annotation' && value !== undefined && isBroadRecordKey(param) && isUnknownOrAny(value);
}

function broadTypeKind(type: Node): BroadTypeKind | null {
  const t = unwrapType(type);
  const p = predefined(t);
  if (p === 'unknown' || p === 'any') return 'top';
  if (p === 'object') return 'object';
  return isBroadRecord(t) ? 'record' : null;
}

const normalizedText = (node: Node): string => unwrapType(node).text.replaceAll(/\s+/gu, '');

function isDefinitelyObjectType(type: Node): boolean {
  const t = unwrapType(type);
  switch (t.type) {
    case 'array_type':
    case 'constructor_type':
    case 'function_type':
    case 'tuple_type':
      return true;
    case 'predefined_type':
      return t.text === 'object';
    case 'object_type':
      return isMapped(t) || named(t).length > 0;
    case 'intersection_type':
      return named(t).every(isDefinitelyObjectType);
    case 'readonly_type': {
      const inner = named(t)[0];
      return inner !== undefined && isDefinitelyObjectType(inner);
    }
    default:
      return false;
  }
}

function isDefinitelyNarrowerRecord(type: Node): boolean {
  const t = unwrapType(type);
  if (t.type === 'object_type') return !isMapped(t) && named(t).some((m) => m.type !== 'index_signature');
  if (t.type !== 'type_identifier' && t.type !== 'generic_type') return false;
  const name = typeReferenceName(t);
  const params = typeArguments(t);
  if (name === 'Readonly') return params[0] !== undefined && isDefinitelyNarrowerRecord(params[0]);
  if (name !== 'Record') return false;
  return params.length === 2 && params[1] !== undefined && !isUnknownOrAny(params[1]);
}

/** Id of the nearest enclosing function boundary, or null at program level. */
function boundaryId(node: Node): number | null {
  const seen = new Set<number>();
  for (let current = node.parent; current && current.type !== 'program' && !seen.has(current.id); current = current.parent) {
    seen.add(current.id);
    if (FUNCTION_BOUNDARIES.has(current.type)) return current.id;
  }
  return null;
}

/** The declarator when the binding is a plain `const x = init` / `const x: T = init` identifier declaration. */
function constDeclarator(binding: Binding): Node | null {
  if (binding.kind !== 'const') return null;
  const declarator = binding.id.parent;
  if (declarator?.type !== 'variable_declarator' || declarator.childForFieldName('name')?.id !== binding.id.id) return null;
  return declarator;
}

const hasNonInitWrite = (binding: Binding): boolean => binding.references.some((r) => r.isWrite && !r.init);

/** The explicit annotation (declarator or parameter) attached to a binding identifier, if any. */
function annotationOf(identifier: Node): Node | null {
  const owner = identifier.parent;
  if (!owner) return null;
  const isDeclarator = owner.type === 'variable_declarator' && owner.childForFieldName('name')?.id === identifier.id;
  const isParameter = (owner.type === 'required_parameter' || owner.type === 'optional_parameter') && owner.childForFieldName('pattern')?.id === identifier.id;
  if (!isDeclarator && !isParameter) return null;
  const annotation = owner.childForFieldName('type');
  return annotation ? (named(annotation)[0] ?? null) : null;
}

function knownValueEvidence(expression: Node, boundary: number | null, visited: ReadonlySet<number>): Evidence | null {
  const e = unwrapExpression(expression);

  if (isAssertion(e)) {
    const type = assertedType(e);
    if (!type || broadTypeKind(type) !== null) return null;
    return { type };
  }
  if (LITERALS.has(e.type) || VALUE_EXPRESSIONS.has(e.type)) return { type: null };
  if (e.type !== 'identifier') return null;

  const binding = resolve(e);
  if (!binding || visited.has(binding.id.id)) return null;

  const annotation = annotationOf(binding.id);
  if (annotation) {
    if (boundaryId(binding.id) !== boundary || broadTypeKind(annotation) !== null) return null;
    return { type: annotation };
  }

  const declarator = constDeclarator(binding);
  const init = declarator?.childForFieldName('value');
  if (!declarator || !init || hasNonInitWrite(binding) || boundaryId(declarator) !== boundary) return null;
  return knownValueEvidence(init, boundary, new Set([...visited, binding.id.id]));
}

interface Widened {
  readonly broadKind: BroadTypeKind;
  readonly evidence: Evidence;
  readonly declaredAt: number;
  readonly boundary: number | null;
}

function widenedBinding(binding: Binding): Widened | null {
  const declarator = constDeclarator(binding);
  const init = declarator?.childForFieldName('value');
  if (!declarator || !init || hasNonInitWrite(binding)) return null;

  const boundary = boundaryId(declarator);
  const declared = annotationOf(binding.id);
  const initAssertion = unwrapExpression(init);
  const assertion = isAssertion(initAssertion) ? initAssertion : null;
  const initType = assertion ? assertedType(assertion) : null;
  const initKind = initType ? broadTypeKind(initType) : null;
  const declaredKind = declared ? broadTypeKind(declared) : null;
  const broadKind = declaredKind ?? initKind;
  if (broadKind === null) return null;

  const original = assertion && initKind !== null ? assertedExpression(assertion) : init;
  if (!original) return null;
  const evidence = knownValueEvidence(original, boundary, new Set([binding.id.id]));
  return evidence ? { broadKind, evidence, declaredAt: declarator.endIndex, boundary } : null;
}

function assertionIsNarrower(broadKind: BroadTypeKind, evidence: Evidence, asserted: Node): boolean {
  if (broadTypeKind(asserted) !== null) return false;
  if (broadKind === 'top') return true;
  if (evidence.type !== null && normalizedText(evidence.type) === normalizedText(asserted)) return true;
  if (broadKind === 'object') return isDefinitelyObjectType(asserted);
  return isDefinitelyNarrowerRecord(asserted);
}

export function check(root: Node, _source: string, index?: NodeIndex): CheckHit[] {
  const idx = index ?? buildNodeIndex(root);
  const hits: CheckHit[] = [];
  const nodes = [...idx.byType('as_expression'), ...idx.byType('type_assertion')].sort((a, b) => a.startIndex - b.startIndex || b.endIndex - a.endIndex);
  for (const node of nodes) {
    const expression = assertedExpression(node);
    const type = assertedType(node);
    if (expression?.type !== 'identifier' || !type) continue;
    const binding = resolve(expression);
    if (!binding) continue;
    const widened = widenedBinding(binding);
    if (!widened || node.startIndex <= widened.declaredAt || boundaryId(node) !== widened.boundary) continue;
    if (!assertionIsNarrower(widened.broadKind, widened.evidence, type)) continue;
    hits.push({
      node,
      message: `Binding "${expression.text}" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.`,
    });
  }
  return hits;
}
