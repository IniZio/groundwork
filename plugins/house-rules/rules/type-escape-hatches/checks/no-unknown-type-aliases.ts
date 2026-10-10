import type { Node } from '../../../src/hooks/lib/tree-sitter.js';
import type { CheckHit } from '../../../src/engine/grouped-rule.js';

export const id = 'no-unknown-type-aliases';
export const upstream = "https://github.com/dmmulroy/anti-slop/blob/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b/src/rules/no-unknown-type-aliases.ts";
export const tsOnly = true;

interface Alias { params: string[]; value: Node }
interface Bound { node: Node; bindings: Bindings }
type Bindings = Map<string, Bound>;

const MAX_DEPTH = 32;

function collectAliases(node: Node, aliases: Map<string, Alias>, all: Node[]): void {
  if (node.type === 'type_alias_declaration') {
    const name = node.childForFieldName('name');
    const value = node.childForFieldName('value');
    if (name && value) {
      const params = (node.childForFieldName('type_parameters')?.namedChildren ?? [])
        .map((p: Node) => p.childForFieldName('name')?.text ?? '');
      aliases.set(name.text, { params, value });
      all.push(node);
    }
  }
  for (const child of node.namedChildren) collectAliases(child, aliases, all);
}

function matches(type: Node | null, bindings: Bindings, aliases: Map<string, Alias>, depth: number): boolean {
  if (!type || depth > MAX_DEPTH) return false;
  const next = (n: Node | null, b: Bindings = bindings) => matches(n, b, aliases, depth + 1);
  switch (type.type) {
    case 'predefined_type':
      return type.text === 'unknown';
    case 'parenthesized_type':
    case 'union_type':
      return type.namedChildren.some((child: Node | null) => next(child));
    case 'type_identifier': {
      const bound = bindings.get(type.text);
      if (bound) return matches(bound.node, bound.bindings, aliases, depth + 1);
      const alias = aliases.get(type.text);
      return !!alias && alias.params.length === 0 && next(alias.value, new Map());
    }
    case 'generic_type': {
      const alias = aliases.get(type.childForFieldName('name')?.text ?? '');
      if (!alias) return false;
      const args = type.childForFieldName('type_arguments')?.namedChildren ?? [];
      const inner: Bindings = new Map();
      alias.params.forEach((param, i) => {
        if (args[i]) inner.set(param, { node: args[i], bindings });
      });
      return next(alias.value, inner);
    }
    default:
      return false;
  }
}

export function check(root: Node, _source: string): CheckHit[] {
  const aliases = new Map<string, Alias>();
  const declarations: Node[] = [];
  collectAliases(root, aliases, declarations);
  const hits: CheckHit[] = [];
  for (const decl of declarations) {
    const name = decl.childForFieldName('name')!;
    if (!matches(decl.childForFieldName('value'), new Map(), aliases, 0)) continue;
    hits.push({
      node: name,
      message: `Type alias \`${name.text}\` hides \`unknown\`. Keep \`unknown\` explicit at the parsing boundary or on an allowed \`cause\` field; otherwise use the parsed owner type.`,
    });
  }
  return hits;
}
