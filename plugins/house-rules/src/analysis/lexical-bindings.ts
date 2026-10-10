/**
 * Lexical bindings (declarations + resolution), mirroring ESLint/oxlint scope analysis for ES modules.
 * var -> nearest function/program/module/static-block scope (namespace bodies are function-like for var).
 * let/const/using/class -> nearest block, for-head, switch body, catch, or class scope.
 * function declaration -> enclosing block/function/program/module scope (strict block-level); named function expression -> own scope.
 * params -> function scope; the body block is the SAME scope. Class expression name -> class scope. Catch body shares the catch scope.
 * Namespaces: class/enum/import -> value+type (`import type` -> type); interface/type alias -> type; namespace -> value+type
 * (TS treats type-only namespaces as non-instantiated; value is chosen for parity with the upstream shadow audit);
 * var/let/const/using/param/function/catch -> value. `declare global {}` is a module scope; string-named modules bind nothing.
 * `using` is only recognised when the grammar yields a lexical_declaration for it.
 */
import type { Node, Tree } from '../hooks/lib/tree-sitter.js';

export type Namespace = 'value' | 'type';
export type BindingKind =
  | 'var'
  | 'let'
  | 'const'
  | 'using'
  | 'param'
  | 'function'
  | 'class'
  | 'enum'
  | 'namespace'
  | 'import'
  | 'catch'
  | 'interface'
  | 'type';
export type ScopeKind = 'program' | 'function' | 'block' | 'catch' | 'for' | 'class' | 'module';

export interface Scope {
  readonly kind: ScopeKind;
  readonly node: Node;
  readonly parent: Scope | null;
  readonly bindings: ReadonlyMap<string, readonly Binding[]>;
}

export interface Binding {
  readonly name: string;
  readonly kind: BindingKind;
  readonly namespaces: readonly Namespace[];
  readonly declared: boolean;
  readonly id: Node;
  readonly scope: Scope;
}

export interface LexicalBindings {
  readonly root: Scope;
  scopeOf(node: Node): Scope;
  resolve(identifier: Node, ns?: Namespace): Binding | null;
}

interface MutableScope {
  readonly kind: ScopeKind;
  readonly node: Node;
  readonly parent: MutableScope | null;
  readonly bindings: Map<string, Binding[]>;
}

const FUNCTION_NODES = new Set([
  'function_declaration',
  'generator_function_declaration',
  'function_expression',
  'generator_function',
  'arrow_function',
  'method_definition',
]);
const CLASS_NODES = new Set(['class_declaration', 'abstract_class_declaration', 'class']);
const MERGED_BODY_PARENTS = new Set([
  ...FUNCTION_NODES,
  'catch_clause',
  'internal_module',
  'module',
  'class_static_block',
  'ambient_declaration',
]);
const VALUE: readonly Namespace[] = ['value'];
const TYPE: readonly Namespace[] = ['type'];
const BOTH: readonly Namespace[] = ['value', 'type'];
const LEXICAL_KEYWORDS = new Set(['var', 'let', 'const', 'using']);

let buildCount = 0;
const cache = new WeakMap<Tree, LexicalBindings>();

export function bindingBuildCount(): number {
  return buildCount;
}

export function analyzeBindings(tree: Tree): LexicalBindings {
  let result = cache.get(tree);
  if (!result) {
    result = build(tree);
    cache.set(tree, result);
  }
  return result;
}

export function resolve(identifier: Node, ns?: Namespace): Binding | null {
  return analyzeBindings(identifier.tree).resolve(identifier, ns);
}

function patternIdentifiers(pattern: Node | null, out: Node[] = []): Node[] {
  if (!pattern) return out;
  switch (pattern.type) {
    case 'identifier':
    case 'shorthand_property_identifier_pattern':
      out.push(pattern);
      break;
    case 'pair_pattern':
      patternIdentifiers(pattern.childForFieldName('value'), out);
      break;
    case 'assignment_pattern':
    case 'object_assignment_pattern':
      patternIdentifiers(pattern.childForFieldName('left'), out);
      break;
    case 'object_pattern':
    case 'array_pattern':
    case 'rest_pattern':
      for (const child of pattern.namedChildren) patternIdentifiers(child, out);
      break;
    default:
      break;
  }
  return out;
}

function firstKeyword(node: Node): string | null {
  for (const child of node.children) {
    if (child && LEXICAL_KEYWORDS.has(child.type)) return child.type;
  }
  return null;
}

function build(tree: Tree): LexicalBindings {
  buildCount++;
  const scopes = new Map<number, MutableScope>();
  const declaringIds = new Map<number, Binding>();
  const root = newScope('program', tree.rootNode, null);
  let declaredDepth = 0;

  function newScope(kind: ScopeKind, node: Node, parent: MutableScope | null): MutableScope {
    const scope: MutableScope = { kind, node, parent, bindings: new Map() };
    scopes.set(node.id, scope);
    return scope;
  }

  function bind(
    scope: MutableScope,
    id: Node | null,
    kind: BindingKind,
    namespaces: readonly Namespace[],
  ): void {
    if (!id) return;
    const binding: Binding = {
      name: id.text,
      kind,
      namespaces,
      declared: declaredDepth > 0,
      id,
      scope: scope as Scope,
    };
    const list = scope.bindings.get(binding.name);
    if (list) list.push(binding);
    else scope.bindings.set(binding.name, [binding]);
    declaringIds.set(id.id, binding);
  }

  function bindPattern(scope: MutableScope, pattern: Node | null, kind: BindingKind): void {
    for (const id of patternIdentifiers(pattern)) bind(scope, id, kind, VALUE);
  }

  function hoistTarget(scope: MutableScope): MutableScope {
    let current = scope;
    while (!['function', 'program', 'module'].includes(current.kind) && current.parent) current = current.parent;
    return current;
  }

  function declarationScope(scope: MutableScope): MutableScope {
    let current = scope;
    while (!['block', 'function', 'program', 'module'].includes(current.kind) && current.parent) {
      current = current.parent;
    }
    return current;
  }

  function bindParameters(scope: MutableScope, node: Node): void {
    const single = node.childForFieldName('parameter');
    if (single) bindPattern(scope, single, 'param');
    const list = node.childForFieldName('parameters');
    if (!list) return;
    for (const param of list.namedChildren) {
      if (!param) continue;
      const pattern = param.childForFieldName('pattern');
      bindPattern(scope, pattern ?? (param.type.endsWith('_parameter') ? null : param), 'param');
    }
  }

  function bindImports(scope: MutableScope, node: Node): void {
    const statementTypeOnly = node.children.some((child: Node | null) => child?.type === 'type');
    const clause = node.namedChildren.find((child: Node | null) => child?.type === 'import_clause');
    if (clause) {
      for (const part of clause.namedChildren) {
        if (!part) continue;
        if (part.type === 'identifier') {
          bind(scope, part, 'import', statementTypeOnly ? TYPE : BOTH);
        } else if (part.type === 'namespace_import') {
          bind(scope, part.namedChildren.find((c: Node | null) => c?.type === 'identifier') ?? null, 'import', statementTypeOnly ? TYPE : BOTH);
        } else if (part.type === 'named_imports') {
          for (const spec of part.namedChildren) {
            if (spec?.type !== 'import_specifier') continue;
            const typeOnly = statementTypeOnly || spec.children.some((c: Node | null) => c?.type === 'type');
            bind(scope, spec.childForFieldName('alias') ?? spec.childForFieldName('name'), 'import', typeOnly ? TYPE : BOTH);
          }
        }
      }
      return;
    }
    const require = node.namedChildren.find((child: Node | null) => child?.type === 'import_require_clause');
    bind(scope, require?.namedChildren[0] ?? null, 'import', BOTH);
  }

  function visitChildren(node: Node, scope: MutableScope): void {
    for (const child of node.children) if (child) visit(child, scope);
  }

  function visit(node: Node, scope: MutableScope): void {
    const type = node.type;
    if (type === 'statement_block') {
      const parentType = node.parent?.type;
      if (parentType && MERGED_BODY_PARENTS.has(parentType) && scope.node.id === node.parent?.id) {
        return visitChildren(node, scope);
      }
      return visitChildren(node, newScope('block', node, scope));
    }
    if (type === 'switch_body') return visitChildren(node, newScope('block', node, scope));
    if (type === 'ambient_declaration') {
      declaredDepth++;
      const isGlobal = node.children.some((child: Node | null) => child?.type === 'global');
      visitChildren(node, isGlobal ? newScope('module', node, scope) : scope);
      declaredDepth--;
      return;
    }
    if (type === 'lexical_declaration' || type === 'variable_declaration') {
      const keyword = (firstKeyword(node) ?? 'var') as BindingKind;
      const target = keyword === 'var' ? hoistTarget(scope) : scope;
      for (const declarator of node.namedChildren) {
        if (declarator?.type === 'variable_declarator') {
          bindPattern(target, declarator.childForFieldName('name'), keyword);
        }
      }
    } else if (type === 'import_statement') {
      bindImports(scope, node);
    } else if (type === 'import_alias') {
      bind(scope, node.namedChildren.find((c: Node | null) => c?.type === 'identifier') ?? null, 'import', BOTH);
    } else if (type === 'interface_declaration') {
      bind(scope, node.childForFieldName('name'), 'interface', TYPE);
    } else if (type === 'type_alias_declaration') {
      bind(scope, node.childForFieldName('name'), 'type', TYPE);
    } else if (type === 'enum_declaration') {
      bind(declarationScope(scope), node.childForFieldName('name'), 'enum', BOTH);
    } else if (type === 'function_signature') {
      bind(declarationScope(scope), node.childForFieldName('name'), 'function', VALUE);
    } else if (type === 'internal_module' || type === 'module') {
      const name = node.childForFieldName('name');
      const first = name?.type === 'nested_identifier' ? (name.namedChildren[0] ?? null) : name;
      if (first?.type === 'identifier') bind(declarationScope(scope), first, 'namespace', BOTH);
      return visitChildren(node, newScope('module', node, scope));
    } else if (CLASS_NODES.has(type)) {
      const name = node.childForFieldName('name');
      const inner = newScope('class', node, scope);
      bind(type === 'class' ? inner : declarationScope(scope), name, 'class', BOTH);
      return visitChildren(node, inner);
    } else if (FUNCTION_NODES.has(type)) {
      const isDeclaration = type === 'function_declaration' || type === 'generator_function_declaration';
      if (isDeclaration) bind(declarationScope(scope), node.childForFieldName('name'), 'function', VALUE);
      const inner = newScope('function', node, scope);
      if (!isDeclaration && (type === 'function_expression' || type === 'generator_function')) {
        bind(inner, node.childForFieldName('name'), 'function', VALUE);
      }
      bindParameters(inner, node);
      return visitChildren(node, inner);
    } else if (type === 'class_static_block') {
      return visitChildren(node, newScope('function', node, scope));
    } else if (type === 'catch_clause') {
      const inner = newScope('catch', node, scope);
      bindPattern(inner, node.childForFieldName('parameter'), 'catch');
      return visitChildren(node, inner);
    } else if (type === 'for_statement') {
      return visitChildren(node, newScope('for', node, scope));
    } else if (type === 'for_in_statement') {
      const inner = newScope('for', node, scope);
      const keyword = firstKeyword(node);
      if (keyword) {
        bindPattern(keyword === 'var' ? hoistTarget(scope) : inner, node.childForFieldName('left'), keyword as BindingKind);
      }
      return visitChildren(node, inner);
    }
    visitChildren(node, scope);
  }

  visitChildren(tree.rootNode, root);

  function scopeOf(node: Node): Scope {
    for (let current: Node | null = node; current; current = current.parent) {
      const scope = scopes.get(current.id);
      if (scope) return scope as Scope;
    }
    return root as Scope;
  }

  return {
    root: root as Scope,
    scopeOf,
    resolve(identifier, ns) {
      const wanted: Namespace = ns ?? (identifier.type === 'type_identifier' ? 'type' : 'value');
      const own = declaringIds.get(identifier.id);
      if (own && own.namespaces.includes(wanted)) return own;
      const name = identifier.text;
      for (let scope: Scope | null = scopeOf(identifier); scope; scope = scope.parent) {
        const hit = scope.bindings.get(name)?.find((b) => b.namespaces.includes(wanted));
        if (hit) return hit;
      }
      return null;
    },
  };
}
