import type { Node } from '../../../src/hooks/lib/tree-sitter.js';
import { buildNodeIndex, type NodeIndex } from '../../../src/engine/grouped-rule.js';
import { arrayMethodTarget, isKnownArrayExpression, unwrap } from '../../../src/analysis/array-method.js';
import { resolve } from '../../../src/analysis/lexical-bindings.js';

export const id = 'no-reduce-accumulator-copy';
export const upstream = "https://github.com/dmmulroy/anti-slop/blob/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b/src/rules/no-reduce-accumulator-copy.ts";

const MESSAGE =
  'Do not copy the reducer accumulator on every iteration; growing copies can cause quadratic work. Mutate a fresh, locally owned accumulator and return it, or use an iterator pipeline/flatMap.';
const WRAPPERS = new Set(['parenthesized_expression', 'as_expression', 'satisfies_expression', 'non_null_expression', 'type_assertion']);
const ARRAY_COPY_METHODS = new Set(['concat', 'slice', 'toSpliced', 'toSorted', 'toReversed', 'with']);

interface Reducer {
  callback: Node;
  accumulator: string;
  initial: Node | null;
}

function enclosingReducer(node: Node): Reducer | null {
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (cur.type === 'function_declaration' || cur.type === 'generator_function_declaration') return null;
    if (cur.type !== 'arrow_function' && cur.type !== 'function_expression' && cur.type !== 'function') continue;
    let owner = cur.parent;
    while (owner && WRAPPERS.has(owner.type)) owner = owner.parent;
    if (owner?.type !== 'arguments') return null;
    const call = owner.parent;
    const args = owner.namedChildren.filter((c: Node | null): c is Node => !!c && c.type !== 'comment');
    const method = call?.type === 'call_expression' ? arrayMethodTarget(call.childForFieldName('function')) : null;
    if (!method || (method.name !== 'reduce' && method.name !== 'reduceRight')) return null;
    if (args.length > 2 || !args[0] || unwrap(args[0]).id !== cur.id) return null;
    const param = cur.childForFieldName('parameter') ?? cur.childForFieldName('parameters')?.namedChildren.find((c: Node | null) => c && c.type !== 'comment') ?? null;
    const names = new Set<string>();
    if (param?.type === 'identifier') names.add(param.text);
    else if (param?.type === 'required_parameter' || param?.type === 'assignment_pattern') {
      const pattern = param.childForFieldName('pattern') ?? param.childForFieldName('left');
      if (pattern?.type === 'identifier') names.add(pattern.text);
    }
    if (names.size === 0) return null;
    return { callback: cur, accumulator: [...names][0], initial: args[1] ?? null };
  }
  return null;
}

function refersToAccumulator(node: Node, reducer: Reducer, seen = new Set<Node>()): boolean {
  const expr = unwrap(node);
  if (expr.type !== 'identifier') return false;
  const binding = resolve(expr, 'value');
  if (!binding) return false;
  if (binding.kind === 'param') return binding.scope.node.id === reducer.callback.id && expr.text === reducer.accumulator;
  const decl = binding.kind === 'const' ? binding.id.parent : null;
  const init = decl?.type === 'variable_declarator' ? decl.childForFieldName('value') : null;
  if (!decl || !init || seen.has(decl)) return false;
  seen.add(decl);
  return refersToAccumulator(init, reducer, seen);
}

function isGlobalOwner(node: Node, name: string): boolean {
  const expr = unwrap(node);
  return expr.type === 'identifier' && expr.text === name && resolve(expr, 'value') === null;
}

function copiesAccumulator(call: Node, reducer: Reducer): boolean {
  const method = arrayMethodTarget(call.childForFieldName('function'));
  if (!method) return false;
  const args = call.childForFieldName('arguments')?.namedChildren.filter((c: Node | null): c is Node => !!c && c.type !== 'comment') ?? [];
  const isAcc = (n: Node) => refersToAccumulator(n, reducer);
  if (method.name === 'assign' && isGlobalOwner(method.object, 'Object')) {
    return !!args[0] && unwrap(args[0]).type === 'object' && args.slice(1).some(isAcc);
  }
  if (method.name === 'from' && isGlobalOwner(method.object, 'Array')) {
    return !!args[0] && isAcc(args[0]);
  }
  if (ARRAY_COPY_METHODS.has(method.name)) {
    return !!reducer.initial && isKnownArrayExpression(reducer.initial) && isAcc(method.object);
  }
  return false;
}

function isCopyHit(node: Node): boolean {
  const reducer = arrayMethodTarget(node.childForFieldName('function')) ? enclosingReducer(node) : null;
  return !!reducer && copiesAccumulator(node, reducer);
}

export function check(root: Node, _source: string, index?: NodeIndex): { node: Node; message: string }[] {
  return (index ?? buildNodeIndex(root))
    .byType('call_expression')
    .filter(isCopyHit)
    .map((node) => ({ node, message: MESSAGE }));
}
