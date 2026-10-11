/**
 * Shared type-assertion safety analysis, mirroring anti-slop `require-safety-comment-for-type-assertion`.
 * Non-const `x as T` and `<T>x` need a `SAFETY: <reason>` comment directly before the assertion, or before its
 * owning statement (or the `export` wrapper of that statement). `as const`, `<const>x` and `satisfies` are exempt.
 */
import type { Node } from '../hooks/lib/tree-sitter.js';

const OWNER_KINDS = new Set([
  'expression_statement',
  'public_field_definition',
  'return_statement',
  'throw_statement',
  'lexical_declaration',
  'variable_declaration',
]);

/** Identical to upstream `markerPattern(["SAFETY"])`. */
export const SAFETY_MARKER_PATTERN = new RegExp(String.raw`(?:^|[^\p{L}\p{N}_])(?:SAFETY)\s*:\s*\S`, 'u');

/** True for `x as T` and `<T>x`, including const assertions. */
export function isTypeAssertion(node: Node): boolean {
  return node.type === 'as_expression' || node.type === 'type_assertion';
}

/** True for `x as const` and `<const>x`. */
export function isConstAssertion(node: Node): boolean {
  if (node.type === 'as_expression') {
    const last = node.child(node.childCount - 1);
    return last !== null && !last.isNamed && last.text === 'const';
  }
  if (node.type === 'type_assertion') {
    const args = node.namedChildren.find((c: Node | null) => c?.type === 'type_arguments');
    return args !== undefined && args !== null && /^<\s*const\s*>$/.test(args.text);
  }
  return false;
}

/** Comment body without its `//` or slash-star delimiters. */
export function commentValue(comment: Node): string {
  const t = comment.text;
  return t.startsWith('//') ? t.slice(2) : t.replace(/^\/\*/, '').replace(/\*\/$/, '');
}

/** True when the comment text carries a `SAFETY: <non-blank reason>` marker. */
export function hasSafetyMarker(comment: Node): boolean {
  return comment.type === 'comment' && SAFETY_MARKER_PATTERN.test(commentValue(comment));
}

/** Contiguous comments immediately preceding a node. */
function commentsBefore(node: Node): Node[] {
  const out: Node[] = [];
  for (let p = node.previousSibling; p?.type === 'comment'; p = p.previousSibling) out.push(p);
  return out;
}

function justifiersBefore(owner: Node, assertion: Node): Node[] {
  return commentsBefore(owner).filter((c) => c.endIndex <= assertion.startIndex && hasSafetyMarker(c));
}

/** SAFETY comments that justify the assertion: walks up to the owning statement, then its export wrapper. */
export function justifyingComments(assertion: Node): Node[] {
  let cur: Node = assertion;
  for (;;) {
    const found = justifiersBefore(cur, assertion);
    if (found.length > 0) return found;
    const parent = cur.parent;
    if (!parent) return [];
    if (OWNER_KINDS.has(cur.type)) {
      const decl = parent.childForFieldName('declaration');
      return parent.type === 'export_statement' && decl !== null && decl.id === cur.id ? justifiersBefore(parent, assertion) : [];
    }
    if (parent.type === 'program') return [];
    cur = parent;
  }
}

/** Every non-const type assertion under `root` with no justifying SAFETY comment. */
export function findAssertionsNeedingJustification(root: Node): Node[] {
  return root
    .descendantsOfType(['as_expression', 'type_assertion'])
    .filter((n: Node | null): n is Node => n !== null && !isConstAssertion(n) && justifyingComments(n).length === 0);
}

/** True when the comment is a SAFETY comment that justifies at least one non-const type assertion. */
export function commentJustifiesAssertion(comment: Node): boolean {
  if (!hasSafetyMarker(comment)) return false;
  let root: Node = comment;
  while (root.parent) root = root.parent;
  return root
    .descendantsOfType(['as_expression', 'type_assertion'])
    .some((n: Node | null) => n !== null && !isConstAssertion(n) && justifyingComments(n).some((c) => c.id === comment.id));
}
