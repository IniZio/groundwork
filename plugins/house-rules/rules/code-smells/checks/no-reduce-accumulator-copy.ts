import type { Node } from '../../../src/hooks/lib/tree-sitter.js';
import { buildNodeIndex, type NodeIndex } from '../../../src/engine/grouped-rule.js';

export const id = 'no-reduce-accumulator-copy';
export const upstream = "https://github.com/dmmulroy/anti-slop/blob/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b/src/rules/no-reduce-accumulator-copy.ts";

const MESSAGE =
  'Do not copy the reducer accumulator on every iteration; growing copies can cause quadratic work. Mutate a fresh, locally owned accumulator and return it, or use an iterator pipeline/flatMap.';
const WRAPPERS = new Set(['parenthesized_expression', 'as_expression', 'satisfies_expression', 'non_null_expression', 'type_assertion']);
const FUNCTION_TYPES = new Set([
  'function_declaration',
  'generator_function_declaration',
  'function_expression',
  'function',
  'generator_function',
  'arrow_function',
  'method_definition',
]);
const DECLARATION_TYPES = new Set(['lexical_declaration', 'variable_declaration']);
const ARRAY_COPY_METHODS = new Set(['concat', 'slice', 'toSpliced', 'toSorted', 'toReversed', 'with']);
const ARRAY_PRESERVING = new Set(['map', 'filter', 'flatMap', 'slice', 'concat', 'toSorted', 'toReversed', 'toSpliced']);

function unwrap(node: Node): Node {
  let cur = node;
  while (WRAPPERS.has(cur.type)) {
    const named = cur.namedChildren.filter((c: Node | null): c is Node => !!c);
    const inner = cur.type === 'type_assertion' ? named[named.length - 1] : named[0];
    if (!inner) break;
    cur = inner;
  }
  return cur;
}

function patternNames(node: Node | null, out: Set<string>): void {
  if (!node) return;
  switch (node.type) {
    case 'identifier':
    case 'shorthand_property_identifier_pattern':
      out.add(node.text);
      return;
    case 'required_parameter':
    case 'optional_parameter':
      patternNames(node.childForFieldName('pattern'), out);
      return;
    case 'assignment_pattern':
    case 'object_assignment_pattern':
      patternNames(node.childForFieldName('left') ?? node.children[0], out);
      return;
    case 'pair_pattern':
      patternNames(node.childForFieldName('value'), out);
      return;
    case 'type_annotation':
      return;
    default:
      for (const child of node.children) patternNames(child, out);
  }
}

function declTarget(stmt: Node): Node {
  return stmt.type === 'export_statement' ? (stmt.childForFieldName('declaration') ?? stmt) : stmt;
}

function statementBindings(stmt: Node, out: Set<string>): void {
  const target = declTarget(stmt);
  if (DECLARATION_TYPES.has(target.type)) {
    for (const child of target.children) {
      if (child?.type === 'variable_declarator') patternNames(child.childForFieldName('name'), out);
    }
  } else if (
    target.type === 'function_declaration' ||
    target.type === 'generator_function_declaration' ||
    target.type === 'class_declaration'
  ) {
    patternNames(target.childForFieldName('name'), out);
  } else if (target.type === 'import_statement') {
    for (const spec of target.descendantsOfType(['identifier'])) {
      if (spec) out.add(spec.text);
    }
  }
}

function scopeBinds(scope: Node, name: string): boolean {
  const names = new Set<string>();
  if (scope.type === 'program' || scope.type === 'statement_block') {
    for (const child of scope.children) if (child) statementBindings(child, names);
  } else if (FUNCTION_TYPES.has(scope.type)) {
    patternNames(scope.childForFieldName('parameters') ?? scope.childForFieldName('parameter'), names);
    if (scope.type === 'function_expression' || scope.type === 'function') {
      patternNames(scope.childForFieldName('name'), names);
    }
  } else if (scope.type === 'catch_clause') {
    patternNames(scope.childForFieldName('parameter'), names);
  } else if (scope.type === 'for_statement') {
    const init = scope.childForFieldName('initializer');
    if (init) statementBindings(init, names);
  } else if (scope.type === 'for_in_statement') {
    patternNames(scope.childForFieldName('left'), names);
  }
  return names.has(name);
}

/** Nearest enclosing scope that binds `name`, or null when the name is a global. */
function resolveScope(node: Node, name: string): Node | null {
  for (let scope = node.parent; scope; scope = scope.parent) {
    if (scopeBinds(scope, name)) return scope;
  }
  return null;
}

/** Declarator of a `const name = init` in the block/program scope, or null. */
function constDeclarator(scope: Node, name: string): Node | null {
  if (scope.type !== 'program' && scope.type !== 'statement_block') return null;
  for (const child of scope.children) {
    const target = child ? declTarget(child) : null;
    if (target?.type !== 'lexical_declaration' || target.children[0]?.text !== 'const') continue;
    for (const d of target.children) {
      if (d?.type === 'variable_declarator' && d.childForFieldName('name')?.text === name) return d;
    }
  }
  return null;
}

function isArrayType(type: Node | null): boolean {
  if (!type) return false;
  const inner = type.type === 'type_annotation' ? type.namedChildren[0] : type;
  if (!inner) return false;
  if (inner.type === 'array_type' || inner.type === 'tuple_type') return true;
  if (inner.type === 'parenthesized_type' || inner.type === 'readonly_type') return isArrayType(inner.namedChildren[0] ?? null);
  if (inner.type === 'generic_type') {
    const name = inner.childForFieldName('name')?.text;
    return name === 'Array' || name === 'ReadonlyArray';
  }
  return false;
}

function isKnownArray(node: Node, seen = new Set<Node>()): boolean {
  const expr = unwrap(node);
  if (expr.type === 'array') return true;
  if (expr.type === 'call_expression') {
    const method = methodTarget(expr.childForFieldName('function'));
    return !!method && ARRAY_PRESERVING.has(method.name) && isKnownArray(method.object, seen);
  }
  if (expr.type !== 'identifier') return false;
  const scope = resolveScope(expr, expr.text);
  const decl = scope && constDeclarator(scope, expr.text);
  if (!decl || seen.has(decl)) return false;
  seen.add(decl);
  const annotation = decl.childForFieldName('type');
  if (annotation) return isArrayType(annotation);
  const init = decl.childForFieldName('value');
  return !!init && isKnownArray(init, seen);
}

function methodTarget(callee: Node | null): { name: string; object: Node } | null {
  if (!callee) return null;
  const node = unwrap(callee);
  const object = node.childForFieldName('object');
  if (!object) return null;
  if (node.type === 'member_expression') {
    const property = node.childForFieldName('property');
    return property ? { name: property.text, object } : null;
  }
  if (node.type === 'subscript_expression') {
    const index = node.childForFieldName('index');
    return index?.type === 'string' ? { name: index.text.slice(1, -1), object } : null;
  }
  return null;
}

interface Reducer {
  callback: Node;
  accumulator: string;
  initial: Node | null;
}

function enclosingReducer(node: Node): Reducer | null {
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (cur.type === 'function_declaration' || cur.type === 'generator_function_declaration') return null;
    if (cur.type !== 'arrow_function' && cur.type !== 'function_expression' && cur.type !== 'function') continue;
    let owner = cur.parent;
    while (owner && WRAPPERS.has(owner.type)) owner = owner.parent;
    if (owner?.type !== 'arguments') return null;
    const call = owner.parent;
    const args = owner.namedChildren.filter((c: Node | null): c is Node => !!c && c.type !== 'comment');
    const method = call?.type === 'call_expression' ? methodTarget(call.childForFieldName('function')) : null;
    if (!method || (method.name !== 'reduce' && method.name !== 'reduceRight')) return null;
    if (args.length > 2 || !args[0] || unwrap(args[0]).id !== cur.id) return null;
    const param = cur.childForFieldName('parameter') ?? cur.childForFieldName('parameters')?.namedChildren.find((c: Node | null) => c && c.type !== 'comment') ?? null;
    const names = new Set<string>();
    if (param?.type === 'identifier') names.add(param.text);
    else if (param?.type === 'required_parameter' || param?.type === 'assignment_pattern') {
      const pattern = param.childForFieldName('pattern') ?? param.childForFieldName('left');
      if (pattern?.type === 'identifier') names.add(pattern.text);
    }
    if (names.size === 0) return null;
    return { callback: cur, accumulator: [...names][0], initial: args[1] ?? null };
  }
  return null;
}

function refersToAccumulator(node: Node, reducer: Reducer, seen = new Set<Node>()): boolean {
  const expr = unwrap(node);
  if (expr.type !== 'identifier') return false;
  const scope = resolveScope(expr, expr.text);
  if (!scope) return false;
  if (scope.id === reducer.callback.id) return expr.text === reducer.accumulator;
  const decl = constDeclarator(scope, expr.text);
  const init = decl?.childForFieldName('value');
  if (!decl || !init || seen.has(decl)) return false;
  seen.add(decl);
  return refersToAccumulator(init, reducer, seen);
}

function isGlobalOwner(node: Node, name: string): boolean {
  const expr = unwrap(node);
  return expr.type === 'identifier' && expr.text === name && resolveScope(expr, name) === null;
}

function copiesAccumulator(call: Node, reducer: Reducer): boolean {
  const method = methodTarget(call.childForFieldName('function'));
  if (!method) return false;
  const args = call.childForFieldName('arguments')?.namedChildren.filter((c: Node | null): c is Node => !!c && c.type !== 'comment') ?? [];
  const isAcc = (n: Node) => refersToAccumulator(n, reducer);
  if (method.name === 'assign' && isGlobalOwner(method.object, 'Object')) {
    return !!args[0] && unwrap(args[0]).type === 'object' && args.slice(1).some(isAcc);
  }
  if (method.name === 'from' && isGlobalOwner(method.object, 'Array')) {
    return !!args[0] && isAcc(args[0]);
  }
  if (ARRAY_COPY_METHODS.has(method.name)) {
    return !!reducer.initial && isKnownArray(reducer.initial) && isAcc(method.object);
  }
  return false;
}

function isCopyHit(node: Node): boolean {
  const reducer = methodTarget(node.childForFieldName('function')) ? enclosingReducer(node) : null;
  return !!reducer && copiesAccumulator(node, reducer);
}

export function check(root: Node, _source: string, index?: NodeIndex): { node: Node; message: string }[] {
  return (index ?? buildNodeIndex(root))
    .byType('call_expression')
    .filter(isCopyHit)
    .map((node) => ({ node, message: MESSAGE }));
}
