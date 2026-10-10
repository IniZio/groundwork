import type { Node, Tree } from '../hooks/lib/tree-sitter.js';

export interface TypeBinding {
  readonly alias: Node | null;
  readonly name: string;
  readonly scope: Node;
}

export interface TypeAliasEnvironment {
  readonly aliases: readonly Node[];
  readonly bindingsByName: ReadonlyMap<string, readonly TypeBinding[]>;
}

export type ResolvedTypeMatcher = (type: Node, matches: (child: Node) => boolean) => boolean;

export interface TypeNodeIndex {
  byType(type: string): readonly Node[];
}

interface Substitution {
  readonly substitutions: Substitutions;
  readonly type: Node;
}

type Substitutions = ReadonlyMap<string, Substitution>;

const MAX_DEPTH = 64;

const SCOPE_OWNERS: ReadonlySet<string> = new Set([
  'program',
  'statement_block',
  'class_static_block',
  'switch_body',
  'switch_statement',
]);

const BINDING_TYPES: readonly string[] = [
  'type_alias_declaration',
  'interface_declaration',
  'enum_declaration',
  'class_declaration',
  'abstract_class_declaration',
  'class',
  'internal_module',
  'module',
  'import_specifier',
  'import_clause',
  'namespace_import',
];

const environmentsByTree = new WeakMap<Tree, TypeAliasEnvironment>();

function sameNode(a: Node | null, b: Node | null): boolean {
  return a !== null && b !== null && a.id === b.id;
}

function namedField(node: Node, field: string): Node | null {
  return node.childForFieldName(field);
}

function typeParameterNodes(owner: Node): Node[] {
  const list = namedField(owner, 'type_parameters');
  if (!list) return [];
  return list.namedChildren.filter(
    (child: Node | null): child is Node => child !== null && child.type === 'type_parameter',
  );
}

function collectInferNames(node: Node, names: Set<string>): void {
  const stack: Node[] = [node];
  for (let current = stack.pop(); current; current = stack.pop()) {
    if (current.type === 'infer_type') {
      const name = current.namedChildren.find(
        (child: Node | null) => child !== null && child.type === 'type_identifier',
      );
      if (name) names.add(name.text);
    }
    for (const child of current.namedChildren) if (child) stack.push(child);
  }
}

function lexicalTypeParameterNames(use: Node): ReadonlySet<string> {
  const names = new Set<string>();
  let descendant: Node = use;
  for (let current: Node | null = use; current; current = current.parent) {
    for (const parameter of typeParameterNodes(current)) {
      const name = namedField(parameter, 'name');
      if (name) names.add(name.text);
    }
    if (current.type === 'conditional_type') {
      const right = namedField(current, 'right');
      if (right && sameNode(descendant, namedField(current, 'consequence'))) {
        collectInferNames(right, names);
      }
    }
    if (current.type === 'mapped_type_clause' && sameNode(descendant, namedField(current, 'alias'))) {
      const name = namedField(current, 'name');
      if (name) names.add(name.text);
    }
    if (current.type === 'index_signature') {
      const clause = current.namedChildren.find(
        (child: Node | null) => child !== null && child.type === 'mapped_type_clause',
      );
      const name = clause ? namedField(clause, 'name') : null;
      if (name && sameNode(descendant, namedField(current, 'type'))) names.add(name.text);
    }
    descendant = current;
  }
  return names;
}

function enclosingTypeScope(node: Node): Node {
  for (let current = node.parent; current; current = current.parent) {
    if (SCOPE_OWNERS.has(current.type)) return current;
  }
  return node;
}

function declaredTypeBindings(
  node: Node,
): readonly { readonly alias: Node | null; readonly name: string }[] {
  switch (node.type) {
    case 'type_alias_declaration': {
      const name = namedField(node, 'name');
      return name ? [{ alias: node, name: name.text }] : [];
    }
    case 'interface_declaration':
    case 'enum_declaration':
    case 'class_declaration':
    case 'abstract_class_declaration':
    case 'class':
    case 'internal_module':
    case 'module': {
      const name = namedField(node, 'name');
      const named = name && (name.type === 'type_identifier' || name.type === 'identifier');
      return named ? [{ alias: null, name: name.text }] : [];
    }
    case 'import_specifier': {
      const local = namedField(node, 'alias') ?? namedField(node, 'name');
      return local ? [{ alias: null, name: local.text }] : [];
    }
    case 'import_clause': {
      const local = node.namedChildren.find(
        (child: Node | null) => child !== null && child.type === 'identifier',
      );
      return local ? [{ alias: null, name: local.text }] : [];
    }
    case 'namespace_import': {
      const local = node.namedChildren.find(
        (child: Node | null) => child !== null && child.type === 'identifier',
      );
      return local ? [{ alias: null, name: local.text }] : [];
    }
    default:
      return [];
  }
}

function collectTypeBindings(
  candidates: readonly Node[],
  bindingsByName: Map<string, TypeBinding[]>,
  aliases: Node[],
): void {
  for (const node of candidates) {
    for (const declared of declaredTypeBindings(node)) {
      const bindings = bindingsByName.get(declared.name) ?? [];
      bindings.push({ ...declared, scope: enclosingTypeScope(node) });
      bindingsByName.set(declared.name, bindings);
      if (declared.alias) aliases.push(declared.alias);
    }
  }
}

function walkCandidates(root: Node): Node[] {
  const wanted = new Set(BINDING_TYPES);
  const found: Node[] = [];
  const stack: Node[] = [root];
  for (let current = stack.pop(); current; current = stack.pop()) {
    if (wanted.has(current.type)) found.push(current);
    const children = current.namedChildren;
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child) stack.push(child);
    }
  }
  return found;
}

/** Collect every lexical type alias and competing type binding in a tree, memoised per tree. */
export function environment(root: Node, index?: TypeNodeIndex): TypeAliasEnvironment {
  const cached = environmentsByTree.get(root.tree);
  if (cached) return cached;
  const candidates = index ? BINDING_TYPES.flatMap((type) => index.byType(type)) : walkCandidates(root);
  const bindingsByName = new Map<string, TypeBinding[]>();
  const aliases: Node[] = [];
  collectTypeBindings(candidates, bindingsByName, aliases);
  const created: TypeAliasEnvironment = { aliases, bindingsByName };
  environmentsByTree.set(root.tree, created);
  return created;
}

function ancestorDistance(ancestor: Node, node: Node): number | null {
  let distance = 0;
  for (let current: Node | null = node; current; current = current.parent) {
    if (current.id === ancestor.id) return distance;
    distance += 1;
  }
  return null;
}

function nearestTypeBindings(name: string, use: Node, env: TypeAliasEnvironment): readonly TypeBinding[] {
  let nearestDistance = Number.POSITIVE_INFINITY;
  let nearest: TypeBinding[] = [];
  for (const candidate of env.bindingsByName.get(name) ?? []) {
    const distance = ancestorDistance(candidate.scope, use);
    if (distance === null || distance > nearestDistance) continue;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = [];
    }
    nearest.push(candidate);
  }
  return nearest;
}

/** Resolve the nearest visible alias declaration with this name, respecting lexical shadowing. */
export function visibleTypeAlias(name: string, use: Node, env: TypeAliasEnvironment): Node | null {
  if (lexicalTypeParameterNames(use).has(name)) return null;
  const bindings = nearestTypeBindings(name, use, env);
  return bindings.length === 1 ? (bindings[0]?.alias ?? null) : null;
}

/** Return whether a local declaration or type parameter shadows a built-in type at this use. */
export function hasVisibleTypeBinding(name: string, use: Node, env: TypeAliasEnvironment): boolean {
  return lexicalTypeParameterNames(use).has(name) || nearestTypeBindings(name, use, env).length > 0;
}

function typeReferenceName(type: Node): string | null {
  if (type.type === 'type_identifier') return type.text;
  if (type.type !== 'generic_type') return null;
  const name = namedField(type, 'name');
  return name && name.type === 'type_identifier' ? name.text : null;
}

function typeParameterDefault(parameter: Node): Node | null {
  const wrapper = namedField(parameter, 'value');
  if (!wrapper) return null;
  return wrapper.type === 'default_type' ? (wrapper.namedChildren[0] ?? null) : wrapper;
}

function aliasSubstitutions(alias: Node, reference: Node, base: Substitutions): Substitutions | null {
  const parameters = typeParameterNodes(alias);
  const argumentList = namedField(reference, 'type_arguments');
  const explicit = argumentList ? argumentList.namedChildren.filter((child: Node | null): child is Node => child !== null) : [];
  const next = new Map(base);
  for (const [index, parameter] of parameters.entries()) {
    const name = namedField(parameter, 'name');
    const explicitArgument = explicit[index];
    const argument = explicitArgument ?? typeParameterDefault(parameter);
    if (!name || !argument) return null;
    const snapshot = explicitArgument ? base : next;
    next.set(name.text, { type: argument, substitutions: new Map(snapshot) });
  }
  return next;
}

/** Match a type after resolving visible aliases and substituting their type parameters. */
export function resolvedTypeMatches(
  type: Node,
  env: TypeAliasEnvironment,
  matcher: ResolvedTypeMatcher,
): boolean {
  const evaluate = (
    current: Node,
    substitutions: Substitutions,
    resolving: ReadonlySet<number>,
    depth: number,
  ): boolean => {
    const name = depth < MAX_DEPTH ? typeReferenceName(current) : null;
    if (name !== null) {
      const substitution = current.type === 'type_identifier' ? substitutions.get(name) : undefined;
      if (substitution) {
        return evaluate(substitution.type, substitution.substitutions, resolving, depth + 1);
      }
      const alias = visibleTypeAlias(name, current, env);
      const body = alias ? namedField(alias, 'value') : null;
      if (alias && body && !resolving.has(alias.id)) {
        const next = aliasSubstitutions(alias, current, substitutions);
        if (next) return evaluate(body, next, new Set(resolving).add(alias.id), depth + 1);
      }
    }
    return matcher(current, (child) => evaluate(child, substitutions, resolving, depth + 1));
  };

  return evaluate(type, new Map(), new Set(), 0);
}
