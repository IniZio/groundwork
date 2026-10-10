import type { Node } from '../hooks/lib/tree-sitter.js';

/** Return whether a type is or contains TypeScript's absorbing unknown top type. */
export function containsUnknownType(type: Node | null): boolean {
  if (!type) return false;
  switch (type.type) {
    case 'predefined_type':
      return type.text === 'unknown';
    case 'parenthesized_type':
    case 'union_type':
      return type.namedChildren.some((child: Node | null) => containsUnknownType(child));
    default:
      return false;
  }
}

/** Return the type annotation node attached to a function parameter, or null. */
export function functionParameterTypeAnnotation(parameter: Node): Node | null {
  return parameter.childForFieldName('type');
}

/** Return only a parameter pattern's local binding, excluding rest markers. */
export function functionParameterBindingName(pattern: Node): string {
  const inner = pattern.type === 'rest_pattern' ? (pattern.namedChildren[0] ?? pattern) : pattern;
  return inner.text.trim();
}
