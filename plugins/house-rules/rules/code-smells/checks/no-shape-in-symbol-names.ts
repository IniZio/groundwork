import type { Node } from '../../../src/hooks/lib/tree-sitter.js';

export const id = 'no-shape-in-symbol-names';
export const upstream = "https://github.com/dmmulroy/anti-slop/blob/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b/src/rules/no-shape-in-symbol-names.ts";

const NAME_TYPES = new Set([
  'identifier',
  'property_identifier',
  'private_property_identifier',
  'shorthand_property_identifier',
  'shorthand_property_identifier_pattern',
  'type_identifier',
  'statement_identifier',
  'namespace_identifier',
]);
const JSX_TAGS = new Set(['jsx_opening_element', 'jsx_closing_element', 'jsx_self_closing_element']);

/** A non-computed `a.shape` member name belongs to another value; JSX tag members (`<a.Shape/>`) still count. */
function isBorrowedMemberName(node: Node): boolean {
  const parent = node.parent;
  if (!parent || parent.type !== 'member_expression') return false;
  if (parent.childForFieldName('property')?.id !== node.id) return false;
  return !(parent.parent && JSX_TAGS.has(parent.parent.type));
}

function walk(node: Node, hits: Node[]): void {
  if (NAME_TYPES.has(node.type) && node.text.toLowerCase().includes('shape') && !isBorrowedMemberName(node)) {
    hits.push(node);
  }
  for (const child of node.children) if (child) walk(child, hits);
}

export function check(root: Node, _source: string): { node: Node; message: string }[] {
  const hits: Node[] = [];
  walk(root, hits);
  return hits.map((node) => ({
    node,
    message: `Rename symbol "${node.text}" for its domain role; "shape" describes structure rather than ownership.`,
  }));
}
