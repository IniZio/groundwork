import type { Node } from '../../../src/hooks/lib/tree-sitter.js';
import { buildNodeIndex, type NodeIndex } from '../../../src/engine/grouped-rule.js';

export const id = 'no-reflect-get';
export const upstream = "https://github.com/dmmulroy/anti-slop/blob/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b/src/rules/no-reflect-get.ts";

const FUNCTION_TYPES = new Set([
  'function_declaration',
  'generator_function_declaration',
  'function_expression',
  'function',
  'generator_function',
  'arrow_function',
  'method_definition',
]);
const DECLARATION_TYPES = new Set(['lexical_declaration', 'variable_declaration']);

function patternNames(node: Node | null, out: Set<string>): void {
  if (!node) return;
  switch (node.type) {
    case 'identifier':
    case 'shorthand_property_identifier_pattern':
      out.add(node.text);
      return;
    case 'assignment_pattern':
    case 'object_assignment_pattern':
      patternNames(node.childForFieldName('left') ?? node.children[0], out);
      return;
    case 'pair_pattern':
      patternNames(node.childForFieldName('value'), out);
      return;
    case 'type_annotation':
      return;
    default:
      for (const child of node.children) patternNames(child, out);
  }
}

function statementBindings(stmt: Node, out: Set<string>): void {
  const target = stmt.type === 'export_statement' ? (stmt.childForFieldName('declaration') ?? stmt) : stmt;
  if (DECLARATION_TYPES.has(target.type)) {
    for (const child of target.children) {
      if (child?.type === 'variable_declarator') patternNames(child.childForFieldName('name'), out);
    }
  } else if (
    target.type === 'function_declaration' ||
    target.type === 'generator_function_declaration' ||
    target.type === 'class_declaration'
  ) {
    patternNames(target.childForFieldName('name'), out);
  } else if (target.type === 'import_statement') {
    for (const spec of target.descendantsOfType(['identifier'])) {
      if (spec) out.add(spec.text);
    }
  }
}

function scopeBinds(scope: Node, name: string): boolean {
  const names = new Set<string>();
  if (scope.type === 'program' || scope.type === 'statement_block') {
    for (const child of scope.children) if (child) statementBindings(child, names);
  } else if (FUNCTION_TYPES.has(scope.type)) {
    patternNames(scope.childForFieldName('parameters') ?? scope.childForFieldName('parameter'), names);
    if (scope.type === 'function_expression' || scope.type === 'function') {
      patternNames(scope.childForFieldName('name'), names);
    }
  } else if (scope.type === 'catch_clause') {
    patternNames(scope.childForFieldName('parameter'), names);
  } else if (scope.type === 'for_statement') {
    const init = scope.childForFieldName('initializer');
    if (init) statementBindings(init, names);
  } else if (scope.type === 'for_in_statement') {
    patternNames(scope.childForFieldName('left'), names);
  }
  return names.has(name);
}

function isGlobalReflect(node: Node): boolean {
  if (node.type !== 'identifier' || node.text !== 'Reflect') return false;
  for (let scope = node.parent; scope; scope = scope.parent) {
    if (scopeBinds(scope, 'Reflect')) return false;
  }
  return true;
}

function isGetMember(callee: Node): boolean {
  if (callee.type === 'member_expression') {
    return callee.childForFieldName('property')?.text === 'get';
  }
  if (callee.type === 'subscript_expression') {
    const index = callee.childForFieldName('index');
    return index?.type === 'string' && index.text.slice(1, -1) === 'get';
  }
  return false;
}

export function check(root: Node, _source: string, index?: NodeIndex): { node: Node; message: string }[] {
  const hits: Node[] = [];
  for (const node of (index ?? buildNodeIndex(root)).byType('call_expression')) {
    const callee = node.childForFieldName('function');
    if (callee && isGetMember(callee)) {
      const object = callee.childForFieldName('object');
      if (object && isGlobalReflect(object)) hits.push(node);
    }
  }
  return hits.map((node) => ({
    node,
    message: 'Replace `Reflect.get` with typed property access. Parse dynamic input into a named domain type before reading it.',
  }));
}
