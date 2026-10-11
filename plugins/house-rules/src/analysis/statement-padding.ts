/**
 * Statement-padding matcher, mirroring anti-slop `require-readable-spacing`: eslint-stylistic
 * `padding-line-between-statements` with an 11-entry policy, on top of tree-sitter.
 * Reports only "blank line required"; extra blank lines are never reported. Comments are never statements and
 * count as separators when looking for a blank line (`includeComments` semantics).
 * Not mirrored: upstream double-visits TSDeclareFunction (a self-pair); each real pair is reported once.
 * Interface/type-literal scopes pair only method signatures, as upstream; no policy entry can match them.
 */
import type { Node } from '../hooks/lib/tree-sitter.js';
import {
  isOverloadOrImplementation,
  isOverloadSignature,
  matchesStatementType,
  unwrapLabeled,
  type PaddingStatementType,
} from './padding-statement-types.js';

export type PaddingSelectorId = 'top-level-non-import' | 'overload-signature' | 'overload-or-implementation';

export type PaddingOperand =
  | '*'
  | PaddingStatementType
  | readonly PaddingStatementType[]
  | { readonly selector: PaddingSelectorId };

export interface PaddingPolicyEntry {
  readonly blankLine: 'always' | 'any';
  readonly prev: PaddingOperand;
  readonly next: PaddingOperand;
}

const DECLARATIONS = ['function', 'class', 'interface', 'type'] as const;
const MULTILINE_BINDINGS = ['multiline-const', 'multiline-let', 'multiline-var', 'multiline-using'] as const;
const CONTROL_FLOW = ['return', 'if', 'switch', 'try', 'for', 'while', 'do'] as const;
const TOP_LEVEL_NON_IMPORT = { selector: 'top-level-non-import' } as const;

/** Entry-for-entry upstream policy; the last matching entry wins. */
export const STATEMENT_PADDING_POLICY: readonly PaddingPolicyEntry[] = [
  { blankLine: 'always', prev: 'import', next: '*' },
  { blankLine: 'always', prev: '*', next: TOP_LEVEL_NON_IMPORT },
  { blankLine: 'always', prev: TOP_LEVEL_NON_IMPORT, next: '*' },
  { blankLine: 'always', prev: '*', next: DECLARATIONS },
  { blankLine: 'always', prev: DECLARATIONS, next: '*' },
  { blankLine: 'always', prev: '*', next: MULTILINE_BINDINGS },
  { blankLine: 'always', prev: MULTILINE_BINDINGS, next: '*' },
  { blankLine: 'always', prev: '*', next: CONTROL_FLOW },
  { blankLine: 'always', prev: 'block-like', next: '*' },
  { blankLine: 'any', prev: 'import', next: 'import' },
  { blankLine: 'any', prev: { selector: 'overload-signature' }, next: { selector: 'overload-or-implementation' } },
];

export interface PaddingViolation {
  prev: Node;
  next: Node;
  /** ESLint loc semantics: 1-based lines, 0-based UTF-16 columns. */
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

function matchesSelector(node: Node, id: PaddingSelectorId): boolean {
  switch (id) {
    case 'top-level-non-import':
      return node.parent?.type === 'program' && node.type !== 'import_statement';
    case 'overload-signature':
      return isOverloadSignature(node);
    case 'overload-or-implementation':
      return isOverloadOrImplementation(node);
  }
}

function matchesOperand(node: Node, operand: PaddingOperand): boolean {
  if (operand === '*') return true;
  const inner = unwrapLabeled(node);
  if (typeof operand === 'string') return matchesStatementType(inner, operand);
  if ('selector' in operand) return matchesSelector(inner, operand.selector);
  return operand.some((type) => matchesStatementType(inner, type));
}

function paddingFor(prev: Node, next: Node): 'always' | 'any' {
  for (let i = STATEMENT_PADDING_POLICY.length - 1; i >= 0; i--) {
    const entry = STATEMENT_PADDING_POLICY[i];
    if (entry && matchesOperand(prev, entry.prev) && matchesOperand(next, entry.next)) return entry.blankLine;
  }
  return 'any';
}

/** Statement lists (scopes) whose consecutive members are paired. */
function scopes(root: Node): Node[][] {
  const lists: Node[][] = [];
  const isStatement = (n: Node): boolean => n.type !== 'comment' && n.type !== 'hash_bang_line' && n.type !== 'ERROR';
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    switch (node.type) {
      case 'program':
      case 'statement_block':
      case 'switch_body':
        lists.push(node.namedChildren.filter(isStatement));
        break;
      case 'switch_case':
      case 'switch_default': {
        const value = node.childForFieldName('value');
        lists.push(node.namedChildren.filter((n: Node) => isStatement(n) && n.id !== value?.id));
        break;
      }
      case 'interface_body':
      case 'object_type':
        lists.push(node.namedChildren.filter((n: Node) => n.type === 'method_signature'));
        break;
    }
    for (const child of node.namedChildren) stack.push(child);
  }
  return lists;
}

/** Leaves (tokens and comments) in source order; zero-width leaves are dropped. */
function collectLeaves(root: Node): Node[] {
  const leaves: Node[] = [];
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.childCount === 0) {
      if (node.endIndex > node.startIndex) leaves.push(node);
      continue;
    }
    for (let i = node.childCount - 1; i >= 0; i--) {
      const child = node.child(i);
      if (child) stack.push(child);
    }
  }
  return leaves;
}

/** Index of the first leaf whose end is past `index`, i.e. the leaf containing or following it. */
function firstLeafEndingAfter(leaves: readonly Node[], index: number): number {
  let lo = 0;
  let hi = leaves.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const leaf = leaves[mid];
    if (leaf && leaf.endIndex > index) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Index of prev's last token; a `;` alone on its line before the next token is skipped. */
function actualLastIndex(prev: Node, leaves: readonly Node[]): number {
  const at = firstLeafEndingAfter(leaves, prev.endIndex - 1);
  const semi = leaves[at];
  if (!semi || semi.endIndex !== prev.endIndex || semi.type !== ';') return at;
  let b = at - 1;
  while (b >= 0 && leaves[b]?.type === 'comment') b--;
  let a = at + 1;
  while (a < leaves.length && leaves[a]?.type === 'comment') a++;
  const before = leaves[b];
  const after = leaves[a];
  const semicolonLess =
    before !== undefined &&
    after !== undefined &&
    before.startIndex >= prev.startIndex &&
    before.endPosition.row !== semi.startPosition.row &&
    semi.endPosition.row === after.startPosition.row;
  return semicolonLess ? b : at;
}

function hasBlankLine(prev: Node, next: Node, leaves: readonly Node[]): boolean {
  let i = actualLastIndex(prev, leaves);
  let cur = leaves[i];
  if (!cur) return false;
  if (next.startPosition.row - cur.endPosition.row < 2) return false;
  while (cur.startIndex < next.startIndex) {
    const following = leaves[++i];
    if (!following) return false;
    if (following.startPosition.row - cur.endPosition.row >= 2) return true;
    cur = following;
  }
  return false;
}

function lineLength(root: Node, row: number): number {
  const lines = root.text.split('\n');
  const rel = row - root.startPosition.row;
  const line = lines[rel] ?? '';
  const text = line.endsWith('\r') ? line.slice(0, -1) : line;
  return rel === 0 ? root.startPosition.column + text.length : text.length;
}

function reportLoc(root: Node, next: Node): Pick<PaddingViolation, 'line' | 'column' | 'endLine' | 'endColumn'> {
  const { startPosition: s, endPosition: e } = next;
  if (s.row === e.row) return { line: s.row + 1, column: s.column, endLine: e.row + 1, endColumn: e.column };
  return { line: s.row + 1, column: s.column, endLine: s.row + 1, endColumn: lineLength(root, s.row) };
}

/** Consecutive statement pairs that policy requires padded with a blank line but are not. Sorted by position. */
export function findMissingBlankLines(root: Node): PaddingViolation[] {
  const leaves = collectLeaves(root);
  const violations: PaddingViolation[] = [];
  for (const list of scopes(root)) {
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const next = list[i];
      if (!prev || !next) continue;
      if (paddingFor(prev, next) !== 'always') continue;
      if (hasBlankLine(prev, next, leaves)) continue;
      violations.push({ prev, next, ...reportLoc(root, next) });
    }
  }
  return violations.sort((a, b) => a.next.startIndex - b.next.startIndex);
}
