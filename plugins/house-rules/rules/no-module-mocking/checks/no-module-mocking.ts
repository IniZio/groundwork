import type { Node } from '../../../src/hooks/lib/tree-sitter.js';
import { resolve } from '../../../src/analysis/lexical-bindings.js';

export const id = 'no-module-mocking';
export const upstream =
  'https://github.com/dmmulroy/anti-slop/blob/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b/src/rules/no-module-mocking.ts';

const MOCK_METHODS = new Set(['doMock', 'mock', 'unstable_mockModule']);
const MESSAGE =
  'Replace module mocking with dependency injection through a real interface, service layer, or faithful test implementation.';
function stringValue(node: Node | null): string | null {
  if (!node || (node.type !== 'string' && node.type !== 'template_string')) return null;
  if (node.namedChildren.some((c: Node) => c.type !== 'string_fragment')) return null;
  return node.namedChildren.map((c: Node) => c.text).join('');
}

function isFrameworkImport(declared: Node): boolean {
  const spec = declared.parent;
  if (spec?.type !== 'import_specifier') return false;
  const stmt = spec.parent?.parent?.parent;
  if (stmt?.type !== 'import_statement') return false;
  const source = stringValue(stmt.childForFieldName('source'));
  const imported = spec.childForFieldName('name')?.text;
  return (source === 'vitest' && imported === 'vi') || (source === '@jest/globals' && imported === 'jest');
}

function isFrameworkObject(obj: Node): boolean {
  if (obj.type !== 'identifier') return false;
  const binding = resolve(obj, 'value');
  if (!binding) return obj.text === 'vi' || obj.text === 'jest';
  return binding.kind === 'import' && isFrameworkImport(binding.id);
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
  const hits: { node: Node; message: string }[] = [];
  const walk = (node: Node): void => {
    if (node.type === 'call_expression') {
      const callee = node.childForFieldName('function');
      const obj = callee?.childForFieldName('object');
      const method = callee ? methodName(callee) : null;
      if (obj && method !== null && MOCK_METHODS.has(method) && isFrameworkObject(obj)) {
        hits.push({ node, message: MESSAGE });
      }
    }
    for (const child of node.namedChildren) walk(child);
  };
  walk(root);
  return hits;
}
