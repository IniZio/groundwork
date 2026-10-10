import type { Node } from '../../../src/hooks/lib/tree-sitter.js';
import { buildNodeIndex, type CheckHit, type NodeIndex } from '../../../src/engine/grouped-rule.js';
import {
  annotationOf,
  classifyUnsafeDictionary,
  classifyUnsafeDictionaryValue,
  createTypeEnvironment,
  type TypeEnvironment,
  type UnsafeDictionaryValue,
} from '../../../src/analysis/dictionary-types.js';
import { visibleTypeAlias } from '../../../src/analysis/type-alias-resolution.js';

export const id = 'no-unsafe-dictionary-type';
export const upstream = "https://github.com/dmmulroy/anti-slop/blob/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b/src/rules/no-unsafe-dictionary-type.ts";
export const tsOnly = true;

const NON_REFERENCE_PARENTS = new Set(['generic_type', 'nested_type_identifier', 'extends_type_clause', 'implements_clause', 'class_heritage', 'extends_clause', 'mapped_type_clause', 'infer_type']);
const HERITAGE_PARENTS = new Set(['extends_type_clause', 'implements_clause', 'class_heritage', 'extends_clause']);

type Env = TypeEnvironment;
const same = (a: Node, b: Node): boolean => a.id === b.id;
function isInsideConstraint(node: Node): boolean {
  for (let cur = node.parent; cur; cur = cur.parent) if (cur.type === 'constraint' && cur.parent?.type === 'type_parameter') return true;
  return false;
}

function isInsideAliasDeclaration(node: Node): boolean {
  for (let cur = node.parent; cur; cur = cur.parent) if (cur.type === 'type_alias_declaration') return true;
  return false;
}

function isReferencePosition(node: Node): boolean {
  const parent = node.parent;
  if (!parent || NON_REFERENCE_PARENTS.has(parent.type)) return false;
  const name = parent.childForFieldName('name');
  if (name && same(name, node)) return false;
  return !(parent.type === 'type_parameter' && parent.namedChildren[0] && same(parent.namedChildren[0], node));
}

function shouldReport(node: Node, env: Env): boolean {
  if (node.parent && HERITAGE_PARENTS.has(node.parent.type)) return false;
  if (node.type === 'type_identifier') {
    if (!isReferencePosition(node)) return false;
    if (visibleTypeAlias(node.text, node, env.typeAliases) !== null && !isInsideAliasDeclaration(node)) return false;
  }
  if (isInsideConstraint(node) || classifyUnsafeDictionary(node, env) === null) return false;
  for (let cur = node.parent; cur; cur = cur.parent) {
    const typeNode = cur.type === 'generic_type' || cur.type === 'object_type';
    if (typeNode && classifyUnsafeDictionary(cur, env) !== null) return false;
  }
  return true;
}

const message = (value: UnsafeDictionaryValue): string =>
  `This dictionary's ${value} value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.`;

function visit(node: Node, env: Env, hits: CheckHit[]): void {
  if (node.type === 'generic_type' || node.type === 'object_type' || node.type === 'type_identifier') {
    const unsafe = shouldReport(node, env) ? classifyUnsafeDictionary(node, env) : null;
    if (unsafe !== null) hits.push({ node, message: message(unsafe) });
  } else if (node.type === 'index_signature' && node.parent?.type !== 'object_type') {
    const value = annotationOf(node);
    const unsafe = value ? classifyUnsafeDictionaryValue(value, env) : null;
    if (unsafe !== null) hits.push({ node, message: message(unsafe) });
  }
}

export function check(root: Node, _source: string, index?: NodeIndex): CheckHit[] {
  const idx = index ?? buildNodeIndex(root);
  const hits: CheckHit[] = [];
  const env = createTypeEnvironment(root, idx);
  for (const node of idx.all) visit(node, env, hits);
  return hits;
}
