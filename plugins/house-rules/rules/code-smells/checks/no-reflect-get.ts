import type { Node } from '../../../src/hooks/lib/tree-sitter.js';
import { resolve } from '../../../src/analysis/lexical-bindings.js';
import { buildNodeIndex, type NodeIndex } from '../../../src/engine/grouped-rule.js';

export const id = 'no-reflect-get';
export const upstream = "https://github.com/dmmulroy/anti-slop/blob/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b/src/rules/no-reflect-get.ts";

function isGlobalReflect(node: Node): boolean {
  return node.type === 'identifier' && node.text === 'Reflect' && resolve(node) === null;
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
