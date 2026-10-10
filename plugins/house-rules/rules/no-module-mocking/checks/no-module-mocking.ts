import type { Node } from '../../../src/hooks/lib/tree-sitter.js';

export const id = 'no-module-mocking';
export const upstream =
  'https://github.com/dmmulroy/anti-slop/blob/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b/src/rules/no-module-mocking.ts';

const MOCK_METHODS = new Set(['doMock', 'mock', 'unstable_mockModule']);
const MESSAGE =
  'Replace module mocking with dependency injection through a real interface, service layer, or faithful test implementation.';
const FUNCTION_TYPES = new Set([
  'function_declaration',
  'function_expression',
  'generator_function',
  'generator_function_declaration',
  'arrow_function',
  'method_definition',
]);
const BLOCK_TYPES = new Set(['program', 'statement_block', 'class_body']);

interface ImportBinding {
  source: string;
  imported: string;
}

function stringValue(node: Node | null): string | null {
  if (!node || (node.type !== 'string' && node.type !== 'template_string')) return null;
  if (node.namedChildren.some((c: Node) => c.type !== 'string_fragment')) return null;
  return node.namedChildren.map((c: Node) => c.text).join('');
}

function collectImports(root: Node): Map<string, ImportBinding> {
  const out = new Map<string, ImportBinding>();
  for (const stmt of root.namedChildren) {
    if (stmt.type !== 'import_statement') continue;
    const source = stringValue(stmt.childForFieldName('source'));
    if (source === null) continue;
    for (const clause of stmt.namedChildren.filter((c: Node) => c.type === 'import_clause')) {
      for (const part of clause.namedChildren) {
        if (part.type === 'identifier') out.set(part.text, { source, imported: 'default' });
        else if (part.type === 'namespace_import') {
          const ns = part.namedChildren.find((c: Node) => c.type === 'identifier');
          if (ns) out.set(ns.text, { source, imported: '*' });
        } else if (part.type === 'named_imports') {
          for (const spec of part.namedChildren) {
            if (spec.type !== 'import_specifier') continue;
            const name = spec.childForFieldName('name');
            const alias = spec.childForFieldName('alias');
            if (name) out.set((alias ?? name).text, { source, imported: name.text });
          }
        }
      }
    }
  }
  return out;
}

function patternDeclares(node: Node | null, name: string): boolean {
  if (!node) return false;
  if (node.type === 'identifier' || node.type === 'shorthand_property_identifier_pattern') {
    return node.text === name;
  }
  return node.namedChildren.some((c: Node) => patternDeclares(c, name));
}

function functionDeclares(fn: Node, name: string): boolean {
  const params = fn.childForFieldName('parameters');
  if (params) return params.namedChildren.some((p: Node) => patternDeclares(p, name));
  const single = fn.childForFieldName('parameter');
  return single !== null && patternDeclares(single, name);
}

function blockDeclares(block: Node, name: string): boolean {
  return block.namedChildren.some((stmt: Node) => {
    if (stmt.type === 'lexical_declaration' || stmt.type === 'variable_declaration') {
      return stmt.namedChildren.some(
        (d: Node) => d.type === 'variable_declarator' && patternDeclares(d.childForFieldName('name'), name),
      );
    }
    if (stmt.type === 'function_declaration' || stmt.type === 'class_declaration') {
      return stmt.childForFieldName('name')?.text === name;
    }
    return false;
  });
}

function locallyDeclared(from: Node, name: string): boolean {
  for (let n: Node | null = from.parent; n; n = n.parent) {
    if (FUNCTION_TYPES.has(n.type) && functionDeclares(n, name)) return true;
    if (BLOCK_TYPES.has(n.type) && blockDeclares(n, name)) return true;
  }
  return false;
}

function isFrameworkObject(obj: Node, imports: Map<string, ImportBinding>): boolean {
  if (obj.type !== 'identifier') return false;
  const name = obj.text;
  if (locallyDeclared(obj, name)) return false;
  const imp = imports.get(name);
  if (imp) {
    return (imp.source === 'vitest' && imp.imported === 'vi') || (imp.source === '@jest/globals' && imp.imported === 'jest');
  }
  return name === 'vi' || name === 'jest';
}

function methodName(callee: Node): string | null {
  if (callee.type === 'member_expression') {
    const prop = callee.childForFieldName('property');
    return prop && prop.type === 'property_identifier' ? prop.text : null;
  }
  if (callee.type === 'subscript_expression') {
    const index = callee.childForFieldName('index');
    return index && index.type === 'string' ? stringValue(index) : null;
  }
  return null;
}

export function check(root: Node, _source: string): { node: Node; message: string }[] {
  const imports = collectImports(root);
  const hits: { node: Node; message: string }[] = [];
  const walk = (node: Node): void => {
    if (node.type === 'call_expression') {
      const callee = node.childForFieldName('function');
      const obj = callee?.childForFieldName('object');
      const method = callee ? methodName(callee) : null;
      if (obj && method !== null && MOCK_METHODS.has(method) && isFrameworkObject(obj, imports)) {
        hits.push({ node, message: MESSAGE });
      }
    }
    for (const child of node.namedChildren) walk(child);
  };
  walk(root);
  return hits;
}
