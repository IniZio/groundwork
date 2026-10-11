/**
 * Statement-type matchers for padding-line analysis, mirroring eslint-stylistic `padding-line-between-statements`
 * (`StatementTypes`, `isBlockLikeStatement`, IIFE detection) and the require-readable-spacing overload selectors.
 * Not mirrored: `multiline-using` — tree-sitter-typescript 0.23 parses `using x = f();` as an assignment expression
 * statement, never a declaration, so that type never matches.
 */
import type { Node } from '../hooks/lib/tree-sitter.js';

export type PaddingStatementType =
  | 'import'
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'multiline-const'
  | 'multiline-let'
  | 'multiline-var'
  | 'multiline-using'
  | 'return'
  | 'if'
  | 'switch'
  | 'try'
  | 'for'
  | 'while'
  | 'do'
  | 'block-like';

const FUNCTION_EXPRESSIONS = new Set(['function_expression', 'function', 'generator_function', 'arrow_function']);

/** `labeled_statement` -> its body, repeatedly. */
export function unwrapLabeled(node: Node): Node {
  let cur = node;
  while (cur.type === 'labeled_statement') {
    const body = cur.childForFieldName('body') ?? cur.namedChildren[cur.namedChildren.length - 1];
    if (!body || body.id === cur.id) break;
    cur = body;
  }
  return cur;
}

function firstTokenText(node: Node): string {
  let cur: Node = node;
  while (cur.childCount > 0) {
    const next = cur.child(0);
    if (!next) break;
    cur = next;
  }
  return cur.text;
}

function isMultiline(node: Node): boolean {
  return node.startPosition.row !== node.endPosition.row;
}

function keyword(node: Node, types: readonly string[], word: string): boolean {
  return types.includes(node.type) && firstTokenText(node) === word;
}

function unwrapParens(node: Node): Node {
  let cur = node;
  while (cur.type === 'parenthesized_expression') {
    const inner = cur.namedChildren.find((c: Node) => c.type !== 'comment');
    if (!inner) break;
    cur = inner;
  }
  return cur;
}

function isIIFEStatement(node: Node): boolean {
  if (node.type !== 'expression_statement') return false;
  const first = node.namedChildren.find((c: Node) => c.type !== 'comment');
  if (!first) return false;
  let expr = unwrapParens(first);
  if (expr.type === 'unary_expression') {
    const arg = expr.childForFieldName('argument');
    if (!arg) return false;
    expr = unwrapParens(arg);
  }
  if (expr.type !== 'call_expression') return false;
  const fn = expr.childForFieldName('function');
  if (!fn) return false;
  let callee = unwrapParens(fn);
  if (callee.type === 'sequence_expression') {
    const last = callee.namedChildren[callee.namedChildren.length - 1];
    if (!last) return false;
    callee = unwrapParens(last);
  }
  return FUNCTION_EXPRESSIONS.has(callee.type);
}

/** Last leaf that is not `;`, a comment, or zero-width (automatic semicolon). */
function lastMeaningfulLeaf(node: Node): Node | null {
  if (node.type === 'comment') return null;
  if (node.childCount === 0) {
    if (node.startIndex === node.endIndex || node.text === ';') return null;
    return node;
  }
  for (let i = node.childCount - 1; i >= 0; i--) {
    const child = node.child(i);
    if (!child) continue;
    const leaf = lastMeaningfulLeaf(child);
    if (leaf) return leaf;
  }
  return null;
}

function isBlockLikeStatement(node: Node): boolean {
  if (node.type === 'do_statement' && node.childForFieldName('body')?.type === 'statement_block') return true;
  if (isIIFEStatement(node)) return true;
  const leaf = lastMeaningfulLeaf(node);
  if (!leaf || leaf.text !== '}') return false;
  const parent = leaf.parent;
  if (parent?.type === 'switch_body') return true;
  if (parent?.type !== 'statement_block') return false;
  const owner = parent.parent?.type;
  return owner !== 'internal_module' && owner !== 'module' && owner !== 'class_static_block';
}

export function matchesStatementType(node: Node, type: PaddingStatementType): boolean {
  const n = unwrapLabeled(node);
  if (n.type === 'comment') return false;
  switch (type) {
    case 'import':
      return n.type === 'import_statement';
    case 'function':
      return n.type === 'function_declaration' || n.type === 'generator_function_declaration';
    case 'class':
      return keyword(n, ['class_declaration'], 'class');
    case 'interface':
      return keyword(n, ['interface_declaration'], 'interface');
    case 'type':
      return keyword(n, ['type_alias_declaration'], 'type');
    case 'multiline-const':
      return keyword(n, ['lexical_declaration'], 'const') && isMultiline(n);
    case 'multiline-let':
      return keyword(n, ['lexical_declaration'], 'let') && isMultiline(n);
    case 'multiline-var':
      return keyword(n, ['variable_declaration'], 'var') && isMultiline(n);
    case 'multiline-using':
      return false;
    case 'return':
      return n.type === 'return_statement';
    case 'if':
      return n.type === 'if_statement';
    case 'switch':
      return n.type === 'switch_statement';
    case 'try':
      return n.type === 'try_statement';
    case 'for':
      return n.type === 'for_statement' || n.type === 'for_in_statement';
    case 'while':
      return n.type === 'while_statement';
    case 'do':
      return n.type === 'do_statement';
    case 'block-like':
      return isBlockLikeStatement(n);
  }
}

function declarationOf(node: Node): Node | null {
  return node.type === 'export_statement' ? node.childForFieldName('declaration') : null;
}

/** `function f(): void;`, `export function f(): void;`, `declare function f(): void;`, `export declare function ...`. */
export function isOverloadSignature(node: Node): boolean {
  if (node.type === 'function_signature') return true;
  const decl = declarationOf(node) ?? node;
  if (decl.type === 'function_signature') return true;
  if (decl.type === 'ambient_declaration') return decl.namedChildren.some((c: Node) => c.type === 'function_signature');
  return false;
}

export function isOverloadOrImplementation(node: Node): boolean {
  if (isOverloadSignature(node)) return true;
  const decl = declarationOf(node) ?? node;
  return decl.type === 'function_declaration';
}
