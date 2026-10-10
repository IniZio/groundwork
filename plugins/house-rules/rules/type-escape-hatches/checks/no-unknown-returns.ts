import type { Node } from '../../../src/hooks/lib/tree-sitter.js';
import { buildNodeIndex, type CheckHit, type NodeIndex } from '../../../src/engine/grouped-rule.js';

export const id = 'no-unknown-returns';
export const upstream = "https://github.com/dmmulroy/anti-slop/blob/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b/src/rules/no-unknown-returns.ts";
export const tsOnly = true;

const MESSAGE = 'This function exposes `unknown` to its caller. Parse the value at its boundary and return a named domain type.';
const OWNERS = new Set([
  'function_declaration', 'generator_function_declaration', 'function_expression', 'generator_function',
  'arrow_function', 'method_definition', 'function_signature', 'abstract_method_signature',
  'method_signature', 'call_signature', 'construct_signature', 'function_type', 'constructor_type',
]);
const PROMISES = new Set(['Promise', 'PromiseLike']);
const MAX_DEPTH = 32;

type Bindings = Map<number, { arg: Node; bindings: Bindings }>;

function declarationsOf(scope: Node): Node[] {
  const out: Node[] = [];
  for (const child of scope.namedChildren) {
    const decl = child.type === 'export_statement' ? child.childForFieldName('declaration') : child;
    if (decl && decl.type === 'type_alias_declaration') out.push(decl);
  }
  return out;
}

function typeParameter(owner: Node, name: string): Node | null {
  const params = owner.childForFieldName('type_parameters');
  return params?.namedChildren.find((p: Node) => p.childForFieldName('name')?.text === name) ?? null;
}

function declaresInfer(node: Node, name: string): boolean {
  if (node.type === 'infer_type' && node.namedChildren[0]?.text === name) return true;
  return node.namedChildren.some((child: Node) => declaresInfer(child, name));
}

function within(node: Node, ancestor: Node | null): boolean {
  for (let cur: Node | null = node; cur; cur = cur.parent) if (ancestor && cur.id === ancestor.id) return true;
  return false;
}

type Lookup = { kind: 'alias'; alias: Node } | { kind: 'param'; param: Node } | { kind: 'shadow' } | null;

function lookup(ref: Node, name: string): Lookup {
  let child: Node = ref;
  for (let cur = ref.parent; cur; child = cur, cur = cur.parent) {
    const param = typeParameter(cur, name);
    if (param) return { kind: 'param', param };
    if (cur.type === 'conditional_type' && within(child, cur.childForFieldName('consequence'))
      && declaresInfer(cur.childForFieldName('right') ?? cur, name)) return { kind: 'shadow' };
    if (cur.type === 'index_signature') {
      const clause = cur.namedChildren.find((c: Node) => c.type === 'mapped_type_clause');
      if (clause?.childForFieldName('name')?.text === name) return { kind: 'shadow' };
    }
    const alias = declarationsOf(cur).find((d) => d.childForFieldName('name')?.text === name);
    if (alias) return { kind: 'alias', alias };
  }
  return null;
}

function expand(alias: Node, args: Node[], bindings: Bindings, path: Set<number>, depth: number): boolean {
  if (path.has(alias.id)) return false;
  const next: Bindings = new Map();
  const params = alias.childForFieldName('type_parameters')?.namedChildren ?? [];
  params.forEach((p: Node, i: number) => {
    if (args[i]) next.set(p.id, { arg: args[i], bindings });
  });
  const value = alias.childForFieldName('value');
  return value ? isUnknown(value, next, new Set([...path, alias.id]), depth + 1) : false;
}

function resolveName(ref: Node, name: string, args: Node[], bindings: Bindings, path: Set<number>, depth: number): boolean | null {
  const found = lookup(ref, name);
  if (!found) return null;
  if (found.kind === 'shadow') return false;
  if (found.kind === 'param') {
    const bound = bindings.get(found.param.id);
    return bound ? isUnknown(bound.arg, bound.bindings, path, depth + 1) : false;
  }
  return expand(found.alias, args, bindings, path, depth);
}

function isUnknown(type: Node, bindings: Bindings, path: Set<number>, depth: number): boolean {
  if (depth > MAX_DEPTH) return false;
  switch (type.type) {
    case 'predefined_type':
      return type.text === 'unknown';
    case 'parenthesized_type':
    case 'union_type':
      return type.namedChildren.some((child: Node) => isUnknown(child, bindings, path, depth + 1));
    case 'type_identifier':
      return resolveName(type, type.text, [], bindings, path, depth) ?? false;
    case 'generic_type': {
      const name = type.childForFieldName('name');
      if (!name || name.type !== 'type_identifier') return false;
      const args = type.childForFieldName('type_arguments')?.namedChildren ?? [];
      const resolved = resolveName(name, name.text, args, bindings, path, depth);
      if (resolved !== null) return resolved;
      const first = args[0];
      return PROMISES.has(name.text) && first !== undefined && isUnknown(first, bindings, path, depth + 1);
    }
    default:
      return false;
  }
}

function returnedType(owner: Node): Node | null {
  const field = owner.childForFieldName('return_type') ?? owner.childForFieldName('type');
  if (!field) return null;
  return field.type === 'type_annotation' ? (field.namedChildren[0] ?? null) : field;
}

export function check(root: Node, _source: string, index?: NodeIndex): CheckHit[] {
  const hits: CheckHit[] = [];
  for (const node of (index ?? buildNodeIndex(root)).all) {
    if (!OWNERS.has(node.type)) continue;
    const returned = returnedType(node);
    if (returned && isUnknown(returned, new Map(), new Set(), 0)) hits.push({ node: returned, message: MESSAGE });
  }
  return hits;
}
