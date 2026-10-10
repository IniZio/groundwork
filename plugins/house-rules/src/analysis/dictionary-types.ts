import type { Node } from '../hooks/lib/tree-sitter.js';
import { buildNodeIndex, type NodeIndex } from '../engine/grouped-rule.js';
import {
  environment as typeAliasEnvironment,
  hasVisibleTypeBinding,
  visibleTypeAlias,
  type TypeAliasEnvironment,
} from './type-alias-resolution.js';

const BUILT_INS = new Set(['Record', 'Readonly', 'Partial', 'Required', 'Pick', 'Omit', 'PropertyKey', 'NonNullable']);
const WRAPPERS = new Set(['Readonly', 'Partial', 'Required', 'NonNullable']);

export type UnsafeDictionaryValue = 'any' | 'empty-object' | 'object' | 'union' | 'unknown';
type Subs = ReadonlyMap<string, Node>;
type Resolved = { type: Node; subs: Subs };

export interface TypeEnvironment {
  readonly interfaces: ReadonlyMap<string, readonly Node[]>;
  readonly typeAliases: TypeAliasEnvironment;
}

const child = (n: Node, type: string): Node | undefined => n.namedChildren.find((c: Node) => c.type === type);
const members = (n: Node): Node[] => n.namedChildren.filter((c: Node) => c.type !== 'comment');

export function createTypeEnvironment(root: Node, index?: NodeIndex): TypeEnvironment {
  const interfaces = new Map<string, Node[]>();
  for (const statement of root.namedChildren) {
    const decl = statement.type === 'export_statement' ? statement.childForFieldName('declaration') : statement;
    const name = decl?.type === 'interface_declaration' ? decl.childForFieldName('name') : null;
    if (decl && name) interfaces.set(name.text, [...(interfaces.get(name.text) ?? []), decl]);
  }
  return { interfaces, typeAliases: typeAliasEnvironment(root, index ?? buildNodeIndex(root)) };
}

function isBuiltIn(name: string, use: Node, env: TypeEnvironment): boolean {
  return BUILT_INS.has(name) && !hasVisibleTypeBinding(name, use, env.typeAliases);
}

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

function isEmptyInterface(decls: readonly Node[]): boolean {
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

export function classifyUnsafeDictionaryValue(type: Node, env: TypeEnvironment): UnsafeDictionaryValue | null {
  return unsafeDirect(type, env, new Map(), new Set());
}

function unsafeDirect(type: Node, env: TypeEnvironment, subs: Subs, resolving: ReadonlySet<string>): UnsafeDictionaryValue | null {
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
    return parts.length > 0 && parts.every((p: UnsafeDictionaryValue | null) => p !== null) ? parts[0]! : null;
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
  const alias = visibleTypeAlias(name, u, env.typeAliases);
  const value = alias?.childForFieldName('value');
  if (!alias || !value || resolving.has(name)) return null;
  const next = aliasSubs(alias, u, subs);
  return next ? unsafeDirect(value, env, next, new Set(resolving).add(name)) : null;
}

export function annotationOf(sig: Node): Node | undefined {
  return (child(sig, 'type_annotation') ?? child(sig, 'opting_type_annotation'))?.namedChildren[0];
}

function dictionaryValues(type: Node, env: TypeEnvironment, subs: Subs, resolving: ReadonlySet<string>): Resolved[] {
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
  const alias = visibleTypeAlias(name, u, env.typeAliases);
  const value = alias?.childForFieldName('value');
  if (!alias || !value || resolving.has(name)) return [];
  const next = aliasSubs(alias, u, subs);
  return next ? dictionaryValues(value, env, next, new Set(resolving).add(name)) : [];
}

export function classifyUnsafeDictionary(type: Node, env: TypeEnvironment): UnsafeDictionaryValue | null {
  for (const v of dictionaryValues(type, env, new Map(), new Set())) {
    const unsafe = unsafeDirect(v.type, env, v.subs, new Set());
    if (unsafe !== null) return unsafe;
  }
  return null;
}
