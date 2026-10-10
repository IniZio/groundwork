import type { Node } from '../../../src/hooks/lib/tree-sitter.js';
import type { CheckHit } from '../../../src/engine/grouped-rule.js';

export const id = 'no-object-parameters';
export const upstream = "https://github.com/dmmulroy/anti-slop/blob/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b/src/rules/no-object-parameters.ts";
export const tsOnly = true;

const PARAMETER_TYPES = new Set(['required_parameter', 'optional_parameter']);
const SCOPES = new Set(['program', 'statement_block', 'switch_body']);
const DECLARATIONS = new Set(['type_alias_declaration', 'interface_declaration', 'enum_declaration', 'class_declaration', 'abstract_class_declaration']);

type Env = Map<number, Map<string, Node[]>>;
interface Subst { type: Node; subs: Subs }
type Subs = ReadonlyMap<string, Subst>;

function scopeOf(node: Node): Node | null {
  for (let p = node.parent; p; p = p.parent) if (SCOPES.has(p.type)) return p;
  return null;
}

function bindingNames(node: Node): string[] {
  if (DECLARATIONS.has(node.type)) {
    const name = node.childForFieldName('name');
    return name ? [name.text] : [];
  }
  if (node.type === 'import_specifier') {
    const local = node.childForFieldName('alias') ?? node.childForFieldName('name');
    return local ? [local.text] : [];
  }
  if (node.type === 'namespace_import') return node.namedChildren.map((c: Node) => c.text);
  if (node.type === 'import_clause') {
    return node.namedChildren.filter((c: Node) => c.type === 'identifier').map((c: Node) => c.text);
  }
  return [];
}

function collectBindings(node: Node, out: Env): void {
  const names = bindingNames(node);
  const scope = names.length > 0 ? scopeOf(node) : null;
  if (scope) {
    const byName = out.get(scope.id) ?? new Map<string, Node[]>();
    for (const name of names) byName.set(name, [...(byName.get(name) ?? []), node]);
    out.set(scope.id, byName);
  }
  for (const child of node.namedChildren) collectBindings(child, out);
}

function typeParameterNames(node: Node): string[] {
  const list = node.namedChildren.find((c: Node) => c.type === 'type_parameters');
  if (!list) return [];
  return list.namedChildren
    .filter((p: Node) => p.type === 'type_parameter')
    .map((p: Node) => (p.childForFieldName('name') ?? p.namedChildren[0])?.text ?? '');
}

function inferNames(node: Node, out: string[]): string[] {
  if (node.type === 'infer_type') out.push((node.childForFieldName('name') ?? node.namedChildren[0])?.text ?? '');
  for (const child of node.namedChildren) inferNames(child, out);
  return out;
}

function lexicallyShadowed(name: string, use: Node): boolean {
  let child: Node = use;
  for (let p = use.parent; p; child = p, p = p.parent) {
    if (typeParameterNames(p).includes(name)) return true;
    if (p.type === 'index_signature') {
      const clause = p.namedChildren.find((c: Node) => c.type === 'mapped_type_clause');
      if (clause?.namedChildren[0]?.text === name) return true;
    }
    if (p.type === 'conditional_type') {
      const consequence = p.childForFieldName('consequence');
      const right = p.childForFieldName('right');
      if (right && consequence && child.id === consequence.id && inferNames(right, []).includes(name)) return true;
    }
  }
  return false;
}

function visibleAlias(name: string, use: Node, env: Env): Node | null {
  if (lexicallyShadowed(name, use)) return null;
  for (let p = use.parent; p; p = p.parent) {
    const found = env.get(p.id)?.get(name);
    if (!found) continue;
    return found.length === 1 && found[0]!.type === 'type_alias_declaration' ? found[0]! : null;
  }
  return null;
}

function referenceParts(type: Node): { name: string; args: Node[] } | null {
  if (type.type === 'type_identifier') return { name: type.text, args: [] };
  if (type.type !== 'generic_type') return null;
  const name = type.childForFieldName('name');
  if (!name || name.type !== 'type_identifier') return null;
  const args = type.childForFieldName('type_arguments')?.namedChildren ?? [];
  return { name: name.text, args };
}

function aliasSubs(alias: Node, args: Node[], base: Subs): Subs | null {
  const params = alias.namedChildren.find((c: Node) => c.type === 'type_parameters')
    ?.namedChildren.filter((p: Node) => p.type === 'type_parameter') ?? [];
  const next = new Map(base);
  for (const [i, param] of params.entries()) {
    const explicit = args[i];
    const arg = explicit ?? param.childForFieldName('value');
    if (!arg) return null;
    const name = (param.childForFieldName('name') ?? param.namedChildren[0])?.text ?? '';
    next.set(name, { type: arg, subs: new Map(explicit ? base : next) });
  }
  return next;
}

function resolvesToObject(type: Node, env: Env, subs: Subs, seen: ReadonlySet<number>): boolean {
  const ref = referenceParts(type);
  if (ref) {
    const sub = subs.get(ref.name);
    if (sub && ref.args.length === 0) return resolvesToObject(sub.type, env, sub.subs, seen);
    const alias = visibleAlias(ref.name, type, env);
    if (alias && !seen.has(alias.id)) {
      const next = aliasSubs(alias, ref.args, subs);
      const value = alias.childForFieldName('value');
      if (next && value) return resolvesToObject(value, env, next, new Set([...seen, alias.id]));
    }
  }
  if (type.type === 'predefined_type') return type.text === 'object';
  if (type.type === 'parenthesized_type' || type.type === 'union_type') {
    return type.namedChildren.some((c: Node) => resolvesToObject(c, env, subs, seen));
  }
  return false;
}

function bindingName(pattern: Node): string {
  const inner = pattern.type === 'rest_pattern' ? (pattern.namedChildren[0] ?? pattern) : pattern;
  return inner.text.trim();
}

function visit(node: Node, env: Env, hits: CheckHit[]): void {
  if (node.type === 'formal_parameters') {
    for (const param of node.namedChildren) {
      if (!PARAMETER_TYPES.has(param.type)) continue;
      const pattern = param.childForFieldName('pattern');
      const annotation = param.childForFieldName('type');
      const type = annotation?.namedChildren[0];
      if (!pattern || !annotation || !type || !resolvesToObject(type, env, new Map(), new Set())) continue;
      hits.push({
        node: annotation,
        message: `Parameter \`${bindingName(pattern)}\` uses the broad \`object\` type. Accept a named owner type; parse external input at its boundary before calling this function.`,
      });
    }
  }
  for (const child of node.namedChildren) visit(child, env, hits);
}

export function check(root: Node, _source: string): CheckHit[] {
  const env = new Map() as Env;
  collectBindings(root, env);
  const hits: CheckHit[] = [];
  visit(root, env, hits);
  return hits;
}
