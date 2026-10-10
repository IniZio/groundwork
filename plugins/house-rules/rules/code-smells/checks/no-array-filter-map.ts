import type { Node } from '../../../src/hooks/lib/tree-sitter.js';

export const id = 'no-array-filter-map';
export const upstream = "https://github.com/dmmulroy/anti-slop/blob/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b/src/rules/no-array-filter-map.ts";

const WRAPPERS = new Set([
  'parenthesized_expression',
  'non_null_expression',
  'as_expression',
  'satisfies_expression',
  'type_assertion',
]);
const FUNCTION_TYPES = new Set([
  'function_declaration',
  'generator_function_declaration',
  'function_expression',
  'function',
  'generator_function',
  'arrow_function',
  'method_definition',
]);
const ARRAY_PRESERVING = new Set(['map', 'filter', 'flatMap', 'slice', 'concat', 'toSorted', 'toReversed', 'toSpliced']);

type Binding = { kind: 'declarator' | 'param' | 'other'; node: Node; isConst?: boolean };

function unwrap(node: Node): Node {
  let cur = node;
  while (WRAPPERS.has(cur.type)) {
    const inner = cur.childForFieldName('expression') ?? cur.namedChildren.find((c: Node) => c.type !== 'type_annotation' && c.type !== 'type_arguments') ?? null;
    if (!inner || inner === cur) break;
    cur = inner;
  }
  return cur;
}

function methodTarget(callee: Node): { name: string; object: Node } | null {
  const node = unwrap(callee);
  const object = node.childForFieldName('object');
  if (!object) return null;
  if (node.type === 'member_expression') {
    const prop = node.childForFieldName('property');
    return prop?.type === 'property_identifier' ? { name: prop.text, object } : null;
  }
  if (node.type === 'subscript_expression') {
    const index = node.childForFieldName('index');
    return index?.type === 'string' ? { name: index.text.slice(1, -1), object } : null;
  }
  return null;
}

function isArrayAnnotation(type: Node | null): boolean {
  if (!type) return false;
  switch (type.type) {
    case 'type_annotation':
    case 'parenthesized_type':
      return isArrayAnnotation(type.namedChildren[0] ?? null);
    case 'array_type':
    case 'tuple_type':
      return true;
    case 'readonly_type':
      return isArrayAnnotation(type.namedChildren[0] ?? null);
    case 'generic_type': {
      const name = type.childForFieldName('name');
      return name?.type === 'type_identifier' && (name.text === 'Array' || name.text === 'ReadonlyArray');
    }
    default:
      return false;
  }
}

function patternBindings(node: Node | null, owner: Node, out: Map<string, Binding>, kind: Binding['kind'], isConst?: boolean): void {
  if (!node) return;
  if (node.type === 'identifier') {
    out.set(node.text, { kind, node: owner, isConst });
    return;
  }
  if (node.type === 'type_annotation') return;
  const simple = kind === 'other';
  for (const child of node.children) patternBindings(child, owner, out, simple ? kind : 'other');
}

function declarationBindings(decl: Node, out: Map<string, Binding>): void {
  const isConst = decl.type === 'lexical_declaration' && decl.children[0]?.type === 'const';
  for (const d of decl.children) {
    if (d.type !== 'variable_declarator') continue;
    const name = d.childForFieldName('name');
    if (name?.type === 'identifier') out.set(name.text, { kind: 'declarator', node: d, isConst });
    else patternBindings(name, d, out, 'other');
  }
}

function statementBindings(stmt: Node, out: Map<string, Binding>): void {
  const target = stmt.type === 'export_statement' ? (stmt.childForFieldName('declaration') ?? stmt) : stmt;
  if (target.type === 'lexical_declaration' || target.type === 'variable_declaration') {
    declarationBindings(target, out);
  } else if (['function_declaration', 'generator_function_declaration', 'class_declaration'].includes(target.type)) {
    patternBindings(target.childForFieldName('name'), target, out, 'other');
  } else if (target.type === 'import_statement') {
    for (const spec of target.descendantsOfType(['identifier'])) if (spec) out.set(spec.text, { kind: 'other', node: spec });
  }
}

function scopeBindings(scope: Node): Map<string, Binding> {
  const out = new Map<string, Binding>();
  if (scope.type === 'program' || scope.type === 'statement_block') {
    for (const child of scope.children) if (child) statementBindings(child, out);
  } else if (FUNCTION_TYPES.has(scope.type)) {
    const params = scope.childForFieldName('parameters');
    if (params) {
      for (const p of params.namedChildren) {
        const pattern = p.childForFieldName('pattern');
        if (p.type === 'identifier') out.set(p.text, { kind: 'param', node: p });
        else if (pattern?.type === 'identifier') out.set(pattern.text, { kind: 'param', node: p });
        else patternBindings(pattern ?? p, p, out, 'other');
      }
    } else {
      patternBindings(scope.childForFieldName('parameter'), scope, out, 'other');
    }
    if (scope.type === 'function_expression' || scope.type === 'function') {
      patternBindings(scope.childForFieldName('name'), scope, out, 'other');
    }
  } else if (scope.type === 'catch_clause') {
    patternBindings(scope.childForFieldName('parameter'), scope, out, 'other');
  } else if (scope.type === 'for_statement') {
    const init = scope.childForFieldName('initializer');
    if (init) statementBindings(init, out);
  } else if (scope.type === 'for_in_statement') {
    patternBindings(scope.childForFieldName('left'), scope, out, 'other');
  }
  return out;
}

function resolve(ident: Node): { binding: Binding; scope: Node } | null {
  for (let scope = ident.parent; scope; scope = scope.parent) {
    const binding = scopeBindings(scope).get(ident.text);
    if (binding) return { binding, scope };
  }
  return null;
}

function hasPlainWrite(scope: Node, name: string): boolean {
  const writes = scope.descendantsOfType(['assignment_expression', 'augmented_assignment_expression']);
  return writes.some((w: Node | null) => {
    const left = w?.childForFieldName('left');
    return left?.type === 'identifier' && left.text === name;
  });
}

function isKnownArray(node: Node, visited: Set<number>): boolean {
  const expr = unwrap(node);
  if (expr.type === 'array') return true;
  if (expr.type === 'call_expression') {
    const method = methodTarget(expr.childForFieldName('function') ?? expr);
    return !!method && ARRAY_PRESERVING.has(method.name) && isKnownArray(method.object, visited);
  }
  if (expr.type !== 'identifier') return false;
  const resolved = resolve(expr);
  if (!resolved || resolved.binding.kind === 'other') return false;
  const { binding, scope } = resolved;
  if (visited.has(binding.node.id)) return false;
  visited.add(binding.node.id);
  if (hasPlainWrite(scope, expr.text)) return false;
  const annotation = binding.node.childForFieldName('type');
  if (annotation) return isArrayAnnotation(annotation);
  if (binding.kind === 'declarator' && binding.isConst) {
    const value = binding.node.childForFieldName('value');
    return !!value && isKnownArray(value, visited);
  }
  return false;
}

function isFilterMap(call: Node): boolean {
  const outer = methodTarget(call.childForFieldName('function') ?? call);
  if (!outer || (outer.name !== 'map' && outer.name !== 'filter')) return false;
  const innerCall = unwrap(outer.object);
  if (innerCall.type !== 'call_expression') return false;
  const inner = methodTarget(innerCall.childForFieldName('function') ?? innerCall);
  if (!inner || inner.name !== (outer.name === 'map' ? 'filter' : 'map')) return false;
  return isKnownArray(inner.object, new Set<number>());
}

function walk(node: Node, hits: Node[]): void {
  if (node.type === 'call_expression' && isFilterMap(node)) hits.push(node);
  for (const child of node.children) if (child) walk(child, hits);
}

export function check(root: Node, _source: string): { node: Node; message: string }[] {
  const hits: Node[] = [];
  walk(root, hits);
  return hits.map((node) => {
    const outer = methodTarget(node.childForFieldName('function') ?? node)!;
    const first = outer.name === 'map' ? 'filter' : 'map';
    return {
      node,
      message: `Avoid consecutive array \`${first}\` and \`${outer.name}\` passes. Prefer \`.values().${first}(...).${outer.name}(...).toArray()\` where iterator helpers are supported, or a single \`flatMap\`/mutating reducer. Preserve callback ordering, indexes, and filtering semantics.`,
    };
  });
}
