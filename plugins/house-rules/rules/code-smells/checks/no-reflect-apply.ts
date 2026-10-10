import type { Node } from '../../../src/hooks/lib/tree-sitter.js';
import { buildNodeIndex, type NodeIndex } from '../../../src/engine/grouped-rule.js';
import { resolve } from '../../../src/analysis/lexical-bindings.js';

export const id = 'no-reflect-apply';
export const upstream = "https://github.com/dmmulroy/anti-slop/blob/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b/src/rules/no-reflect-apply.ts";

function isGlobalReflect(node: Node): boolean {
  return node.type === 'identifier' && node.text === 'Reflect' && resolve(node) === null;
}

function isApplyMember(callee: Node): boolean {
  if (callee.type === 'member_expression') {
    return callee.childForFieldName('property')?.text === 'apply';
  }
  if (callee.type === 'subscript_expression') {
    const index = callee.childForFieldName('index');
    return index?.type === 'string' && index.text.slice(1, -1) === 'apply';
  }
  return false;
}

function isReflectApply(node: Node): boolean {
  const callee = node.childForFieldName('function');
  if (!callee || !isApplyMember(callee)) return false;
  const object = callee.childForFieldName('object');
  return !!object && isGlobalReflect(object);
}

export function check(root: Node, _source: string, index?: NodeIndex): { node: Node; message: string }[] {
  return (index ?? buildNodeIndex(root))
    .byType('call_expression')
    .filter(isReflectApply)
    .map((node) => ({
      node,
      message: 'Replace `Reflect.apply` with a typed function call. Model dynamic dispatch behind a named interface.',
    }));
}
