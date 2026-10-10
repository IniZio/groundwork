import type { Node } from '../../../src/hooks/lib/tree-sitter.js';
import { resolve } from '../../../src/analysis/lexical-bindings.js';
import { buildNodeIndex, type NodeIndex } from '../../../src/engine/grouped-rule.js';

export const id = 'no-accumulator-spread';

const MESSAGE =
  'Do not spread the reducer accumulator on every iteration; each copy is O(n) so the reduce is O(n^2). Mutate a fresh, locally owned accumulator and return it, or build the result with Object.fromEntries/flatMap.';
const WRAPPERS = new Set(['parenthesized_expression', 'as_expression', 'satisfies_expression', 'non_null_expression', 'type_assertion']);
const FUNCTION_TYPES = new Set(['function_declaration', 'generator_function_declaration', 'function_expression', 'function', 'generator_function', 'arrow_function', 'method_definition']);

function unwrap(node: Node): Node {
  let cur = node;
  while (WRAPPERS.has(cur.type)) {
    const named = cur.namedChildren.filter((c: Node | null): c is Node => !!c);
    const inner = cur.type === 'type_assertion' ? named[named.length - 1] : named[0];
    if (!inner) break;
    cur = inner;
  }
  return cur;
}

/** The reduce callback when `node`'s own function is a reduce/reduceRight callback, with its accumulator name. */
function reducerOf(node: Node): { accumulator: Node } | null {
  let fn = node.parent;
  while (fn && !FUNCTION_TYPES.has(fn.type)) fn = fn.parent;
  if (!fn || (fn.type !== 'arrow_function' && fn.type !== 'function_expression' && fn.type !== 'function')) return null;
  let owner = fn.parent;
  while (owner && WRAPPERS.has(owner.type)) owner = owner.parent;
  if (owner?.type !== 'arguments' || owner.parent?.type !== 'call_expression') return null;
  const callee = unwrap(owner.parent.childForFieldName('function') ?? owner);
  const method = callee.type === 'member_expression' ? callee.childForFieldName('property')?.text : callee.type === 'subscript_expression' ? callee.childForFieldName('index')?.text.slice(1, -1) : undefined;
  if (method !== 'reduce' && method !== 'reduceRight') return null;
  const args = owner.namedChildren.filter((c: Node | null): c is Node => !!c && c.type !== 'comment');
  if (args.length > 2 || !args[0] || unwrap(args[0]).id !== fn.id) return null;
  const param = fn.childForFieldName('parameter') ?? fn.childForFieldName('parameters')?.namedChildren.find((c: Node | null) => c && c.type !== 'comment') ?? null;
  const pattern = param?.type === 'identifier' ? param : (param?.childForFieldName('pattern') ?? param?.childForFieldName('left'));
  return pattern?.type === 'identifier' ? { accumulator: pattern } : null;
}

function spreadsAccumulator(spread: Node): boolean {
  const arg = spread.namedChildren.find((c: Node | null): c is Node => !!c && c.type !== 'comment');
  const target = arg && unwrap(arg);
  if (target?.type !== 'identifier' || (spread.parent?.type !== 'object' && spread.parent?.type !== 'array')) return false;
  const reducer = reducerOf(spread);
  if (!reducer || reducer.accumulator.text !== target.text) return false;
  const binding = resolve(target);
  return !!binding && binding.id.id === reducer.accumulator.id;
}

export function check(root: Node, _source: string, index?: NodeIndex): { node: Node; message: string }[] {
  return (index ?? buildNodeIndex(root))
    .byType('spread_element')
    .filter(spreadsAccumulator)
    .map((node) => ({ node, message: MESSAGE }));
}
