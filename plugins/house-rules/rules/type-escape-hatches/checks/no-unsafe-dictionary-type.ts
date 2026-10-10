import type { Node } from '../../../src/hooks/lib/tree-sitter.js';
import { buildNodeIndex, type CheckHit, type NodeIndex } from '../../../src/engine/grouped-rule.js';

export const id = 'no-unsafe-dictionary-type';
export const upstream = "https://github.com/dmmulroy/anti-slop/blob/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b/src/rules/no-unsafe-dictionary-type.ts";
export const tsOnly = true;

const BUILT_INS = new Set(['Record', 'Readonly', 'Partial', 'Required', 'Pick', 'Omit', 'PropertyKey', 'NonNullable']);
const WRAPPERS = new Set(['Readonly', 'Partial', 'Required', 'NonNullable']);
const SCOPES = new Set(['program', 'statement_block', 'class_static_block', 'switch_body']);
const TYPE_DECLS = new Set(['type_alias_declaration', 'interface_declaration', 'enum_declaration', 'class_declaration', 'abstract_class_declaration', 'class']);
const NON_REFERENCE_PARENTS = new Set(['generic_type', 'nested_type_identifier', 'extends_type_clause', 'implements_clause', 'class_heritage', 'extends_clause', 'mapped_type_clause', 'infer_type']);
const HERITAGE_PARENTS = new Set(['extends_type_clause', 'implements_clause', 'class_heritage', 'extends_clause']);

type Unsafe = 'any' | 'empty-object' | 'object' | 'union' | 'unknown';
type Subs = ReadonlyMap<string, Node>;
type Binding = { alias: Node | null; scope: Node };
type Env = { interfaces: Map<string, Node[]>; bindings: Map<string, Binding[]> };
type Resolved = { type: Node; subs: Subs };

const same = (a: Node, b: Node): boolean => a.id === b.id;
const child = (n: Node, type: string): Node | undefined => n.namedChildren.find((c: Node) => c.type === type);
const members = (n: Node): Node[] => n.namedChildren.filter((c: Node) => c.type !== 'comment');

function unwrap(type: Node): Node {
  let cur = type;
  while ((cur.type === 'parenthesized_type' || cur.type === 'readonly_type') && cur.namedChildren[0]) cur = cur.namedChildren[0];
  return cur;
}

function refName(type: Node): string | null {
  if (type.type === 'type_identifier') return type.text;
  const head = type.type === 'generic_type' ? type.namedChildren[0] : undefined;
  return head?.type === 'type_identifier' ? head.text : null;
}

function refArgs(type: Node): Node[] {
  return type.type === 'generic_type' ? (child(type, 'type_arguments')?.namedChildren ?? []) : [];
}

function aliasParams(alias: Node): Node[] {
  return child(alias, 'type_parameters')?.namedChildren.filter((p: Node) => p.type === 'type_parameter') ?? [];
}

function paramDefault(param: Node): Node | null {
  return child(param, 'default_type')?.namedChildren[0] ?? null;
}

function declaredBinding(node: Node): { alias: Node | null; name: string } | null {
  if (TYPE_DECLS.has(node.type)) {
    const name = node.childForFieldName('name');
    return name ? { alias: node.type === 'type_alias_declaration' ? node : null, name: name.text } : null;
  }
  if (node.type === 'import_specifier') {
    const last = node.namedChildren[node.namedChildren.length - 1];
    return last ? { alias: null, name: last.text } : null;
  }
  if (node.type === 'namespace_import') {
    return node.namedChildren[0] ? { alias: null, name: node.namedChildren[0].text } : null;
  }
  if (node.type === 'identifier' && node.parent?.type === 'import_clause') return { alias: null, name: node.text };
  return null;
}

function enclosingScope(node: Node): Node {
  for (let cur = node.parent; cur; cur = cur.parent) if (SCOPES.has(cur.type)) return cur;
  return node;
}

function buildEnv(root: Node, index: NodeIndex): Env {
  const interfaces = new Map<string, Node[]>();
  const bindings = new Map<string, Binding[]>();
  for (const statement of root.namedChildren) {
    const decl = statement.type === 'export_statement' ? statement.childForFieldName('declaration') : statement;
    const name = decl?.type === 'interface_declaration' ? decl.childForFieldName('name') : null;
    if (decl && name) interfaces.set(name.text, [...(interfaces.get(name.text) ?? []), decl]);
  }
  const declarations = [...TYPE_DECLS, 'import_specifier', 'namespace_import']
    .flatMap((type) => index.byType(type))
    .concat(index.byType('import_clause').flatMap((clause) => clause.namedChildren.filter((c: Node) => c.type === 'identifier')));
  for (const node of declarations) {
    const declared = declaredBinding(node);
    if (!declared) continue;
    const list = bindings.get(declared.name) ?? [];
    list.push({ alias: declared.alias, scope: enclosingScope(node) });
    bindings.set(declared.name, list);
  }
  return { interfaces, bindings };
}

function lexicalTypeParams(use: Node): Set<string> {
  const names = new Set<string>();
  let below: Node = use;
  for (let cur: Node | null = use; cur && cur.type !== 'program'; below = cur, cur = cur.parent) {
    for (const p of child(cur, 'type_parameters')?.namedChildren ?? []) {
      if (p.namedChildren[0]) names.add(p.namedChildren[0].text);
    }
    const clause = cur.type === 'index_signature' ? child(cur, 'mapped_type_clause') : undefined;
    if (clause && !same(clause, below) && clause.namedChildren[0]) names.add(clause.namedChildren[0].text);
  }
  return names;
}

function nearestBindings(name: string, use: Node, env: Env): Binding[] {
  let best = Number.POSITIVE_INFINITY;
  let nearest: Binding[] = [];
  for (const candidate of env.bindings.get(name) ?? []) {
    let distance = 0;
    let cur: Node | null = use;
    while (cur && !same(cur, candidate.scope)) { cur = cur.parent; distance++; }
    if (!cur || distance > best) continue;
    if (distance < best) { best = distance; nearest = []; }
    nearest.push(candidate);
  }
  return nearest;
}

function visibleAlias(name: string, use: Node, env: Env): Node | null {
  if (lexicalTypeParams(use).has(name)) return null;
  const found = nearestBindings(name, use, env);
  return found.length === 1 ? (found[0]!.alias) : null;
}

function isBuiltIn(name: string, use: Node, env: Env): boolean {
  return BUILT_INS.has(name) && !lexicalTypeParams(use).has(name) && nearestBindings(name, use, env).length === 0;
}

function isUnappliedRef(type: Node, name: string): boolean {
  const u = unwrap(type);
  return u.type === 'type_identifier' && u.text === name;
}

function isNever(type: Node | undefined): boolean {
  const u = type ? unwrap(type) : null;
  return u?.type === 'predefined_type' && u.text === 'never';
}

function isEmptyMember(member: Node): boolean {
  if (member.type !== 'property_signature' || !member.children.some((c: Node) => c.type === '?')) return false;
  return isNever(child(member, 'type_annotation')?.namedChildren[0]);
}

function isEmptyInterface(decls: Node[]): boolean {
  const [decl] = decls;
  const body = decl?.childForFieldName('body');
  return decls.length === 1 && !!body && !child(decl!, 'extends_type_clause') && members(body).every(isEmptyMember);
}

function resolveArgument(type: Node, base: Subs, resolving: ReadonlySet<string> = new Set()): Node {
  const u = unwrap(type);
  const name = u.type === 'type_identifier' || u.type === 'generic_type' ? refName(u) : null;
  if (name === null || resolving.has(name)) return type;
  const sub = base.get(name);
  return sub === undefined ? type : resolveArgument(sub, base, new Set(resolving).add(name));
}

function aliasSubs(alias: Node, ref: Node, base: Subs): Subs | null {
  const args = refArgs(ref);
  const next = new Map(base);
  for (const [i, param] of aliasParams(alias).entries()) {
    const arg = args[i] ?? paramDefault(param);
    if (!arg || !param.namedChildren[0]) return null;
    next.set(param.namedChildren[0].text, resolveArgument(arg, next));
  }
  return next;
}

function unsafeDirect(type: Node, env: Env, subs: Subs, resolving: ReadonlySet<string>): Unsafe | null {
  const u = unwrap(type);
  if (u.type === 'predefined_type') {
    return u.text === 'unknown' || u.text === 'any' || u.text === 'object' ? u.text : null;
  }
  if (u.type === 'object_type') return members(u).every(isEmptyMember) ? 'empty-object' : null;
  if (u.type === 'union_type') {
    return u.namedChildren.some((m: Node) => unsafeDirect(m, env, subs, resolving) !== null) ? 'union' : null;
  }
  if (u.type === 'intersection_type') {
    const parts = u.namedChildren.map((m: Node) => unsafeDirect(m, env, subs, resolving));
    if (parts.includes('any')) return 'any';
    return parts.length > 0 && parts.every((p: Unsafe | null) => p !== null) ? parts[0]! : null;
  }
  const name = refName(u);
  if (name === null) return null;
  if (WRAPPERS.has(name) && isBuiltIn(name, u, env)) {
    const wrapped = refArgs(u)[0];
    return wrapped ? unsafeDirect(wrapped, env, subs, resolving) : null;
  }
  const sub = subs.get(name);
  if (sub !== undefined) return isUnappliedRef(sub, name) ? null : unsafeDirect(sub, env, subs, resolving);
  const decls = env.interfaces.get(name);
  if (decls !== undefined) return isEmptyInterface(decls) ? 'empty-object' : null;
  const alias = visibleAlias(name, u, env);
  const value = alias?.childForFieldName('value');
  if (!alias || !value || resolving.has(name)) return null;
  const next = aliasSubs(alias, u, subs);
  return next ? unsafeDirect(value, env, next, new Set(resolving).add(name)) : null;
}

function annotationOf(sig: Node): Node | undefined {
  return (child(sig, 'type_annotation') ?? child(sig, 'opting_type_annotation'))?.namedChildren[0];
}

function dictionaryValues(type: Node, env: Env, subs: Subs, resolving: ReadonlySet<string>): Resolved[] {
  const u = unwrap(type);
  if (u.type === 'object_type') {
    return u.namedChildren
      .filter((m: Node) => m.type === 'index_signature')
      .flatMap((m: Node) => { const t = annotationOf(m); return t ? [{ type: t, subs }] : []; });
  }
  const name = refName(u);
  if (name === null) return [];
  const sub = subs.get(name);
  if (sub !== undefined) return isUnappliedRef(sub, name) ? [] : dictionaryValues(sub, env, subs, resolving);
  const args = refArgs(u);
  if (WRAPPERS.has(name) && isBuiltIn(name, u, env)) {
    return args[0] ? dictionaryValues(args[0], env, subs, resolving) : [];
  }
  if (name === 'Record' && isBuiltIn(name, u, env)) return args[1] ? [{ type: args[1], subs }] : [];
  if ((name === 'Pick' || name === 'Omit') && isBuiltIn(name, u, env)) {
    return args[0] ? dictionaryValues(args[0], env, subs, resolving) : [];
  }
  const alias = visibleAlias(name, u, env);
  const value = alias?.childForFieldName('value');
  if (!alias || !value || resolving.has(name)) return [];
  const next = aliasSubs(alias, u, subs);
  return next ? dictionaryValues(value, env, next, new Set(resolving).add(name)) : [];
}

function classify(type: Node, env: Env): Unsafe | null {
  for (const v of dictionaryValues(type, env, new Map(), new Set())) {
    const unsafe = unsafeDirect(v.type, env, v.subs, new Set());
    if (unsafe !== null) return unsafe;
  }
  return null;
}

function isInsideConstraint(node: Node): boolean {
  for (let cur = node.parent; cur; cur = cur.parent) if (cur.type === 'constraint' && cur.parent?.type === 'type_parameter') return true;
  return false;
}

function isInsideAliasDeclaration(node: Node): boolean {
  for (let cur = node.parent; cur; cur = cur.parent) if (cur.type === 'type_alias_declaration') return true;
  return false;
}

function isReferencePosition(node: Node): boolean {
  const parent = node.parent;
  if (!parent || NON_REFERENCE_PARENTS.has(parent.type)) return false;
  const name = parent.childForFieldName('name');
  if (name && same(name, node)) return false;
  return !(parent.type === 'type_parameter' && parent.namedChildren[0] && same(parent.namedChildren[0], node));
}

function shouldReport(node: Node, env: Env): boolean {
  if (node.parent && HERITAGE_PARENTS.has(node.parent.type)) return false;
  if (node.type === 'type_identifier') {
    if (!isReferencePosition(node)) return false;
    if (visibleAlias(node.text, node, env) !== null && !isInsideAliasDeclaration(node)) return false;
  }
  if (isInsideConstraint(node) || classify(node, env) === null) return false;
  for (let cur = node.parent; cur; cur = cur.parent) {
    const typeNode = cur.type === 'generic_type' || cur.type === 'object_type';
    if (typeNode && classify(cur, env) !== null) return false;
  }
  return true;
}

const message = (value: Unsafe): string =>
  `This dictionary's ${value} value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.`;

function visit(node: Node, env: Env, hits: CheckHit[]): void {
  if (node.type === 'generic_type' || node.type === 'object_type' || node.type === 'type_identifier') {
    const unsafe = shouldReport(node, env) ? classify(node, env) : null;
    if (unsafe !== null) hits.push({ node, message: message(unsafe) });
  } else if (node.type === 'index_signature' && node.parent?.type !== 'object_type') {
    const value = annotationOf(node);
    const unsafe = value ? unsafeDirect(value, env, new Map(), new Set()) : null;
    if (unsafe !== null) hits.push({ node, message: message(unsafe) });
  }
}

export function check(root: Node, _source: string, index?: NodeIndex): CheckHit[] {
  const idx = index ?? buildNodeIndex(root);
  const hits: CheckHit[] = [];
  const env = buildEnv(root, idx);
  for (const node of idx.all) visit(node, env, hits);
  return hits;
}
