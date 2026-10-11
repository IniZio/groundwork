import type { Node } from '../../../src/hooks/lib/tree-sitter.js';
import { buildNodeIndex, type NodeIndex } from '../../../src/engine/grouped-rule.js';

export const id = 'silent-early-return-in-test';

const TEST_FILE = /(\.(test|spec)\.[^/\\]+$)|((^|[/\\])(test|tests|__tests__)[/\\])/;
const FUNCTION_TYPES = new Set([
  'arrow_function', 'function_expression', 'function', 'function_declaration', 'generator_function', 'generator_function_declaration', 'method_definition',
]);
const MESSAGE = 'Early `return` makes this test pass without asserting. Assert the precondition with `expect(...)` first, or use `it.skipIf(cond)` / `test.skipIf(cond)`.';

function isTestCallee(callee: Node): boolean {
  if (callee.type === 'identifier') return callee.text === 'it' || callee.text === 'test';
  if (callee.type === 'member_expression') {
    const object = callee.childForFieldName('object');
    const property = callee.childForFieldName('property')?.text;
    return !!object && (object.text === 'it' || object.text === 'test') && property === 'only';
  }
  if (callee.type === 'call_expression') {
    const inner = callee.childForFieldName('function');
    if (inner?.type !== 'member_expression') return false;
    const object = inner.childForFieldName('object');
    return !!object && (object.text === 'it' || object.text === 'test' || /^(it|test)\.only$/.test(object.text)) && inner.childForFieldName('property')?.text === 'each';
  }
  return false;
}

function testBody(call: Node): Node | null {
  const callee = call.childForFieldName('function');
  if (!callee || !isTestCallee(callee)) return null;
  const args = call.childForFieldName('arguments')?.namedChildren ?? [];
  const callback = args[args.length - 1];
  if (!callback || !FUNCTION_TYPES.has(callback.type)) return null;
  const body = callback.childForFieldName('body');
  return body?.type === 'statement_block' ? body : null;
}

/** Visits `node` and descendants, never entering nested functions. */
function walk(node: Node, visit: (n: Node) => void): void {
  visit(node);
  for (const child of node.namedChildren) {
    if (!FUNCTION_TYPES.has(child.type)) walk(child, visit);
  }
}

function identifiers(node: Node): Set<string> {
  const names = new Set<string>();
  walk(node, (n) => {
    if (n.type === 'identifier') names.add(n.text);
  });
  return names;
}

function isBareReturn(node: Node | null): boolean {
  if (!node) return false;
  if (node.type === 'return_statement') return node.namedChildren.length === 0;
  if (node.type === 'statement_block') return node.namedChildren.length === 1 && isBareReturn(node.namedChildren[0] ?? null);
  return false;
}

function isExpectCall(node: Node): boolean {
  if (node.type !== 'call_expression') return false;
  let callee: Node | null = node.childForFieldName('function');
  while (callee && (callee.type === 'member_expression' || callee.type === 'call_expression')) {
    callee = callee.childForFieldName(callee.type === 'member_expression' ? 'object' : 'function');
  }
  return callee?.type === 'identifier' && callee.text === 'expect';
}

function silentGuards(body: Node): Node[] {
  const expects: Node[] = [];
  const guards: Node[] = [];
  walk(body, (n) => {
    if (isExpectCall(n)) expects.push(n);
    else if (n.type === 'if_statement' && !n.childForFieldName('alternative') && isBareReturn(n.childForFieldName('consequence'))) guards.push(n);
  });
  return guards.filter((guard) => {
    const cond = guard.childForFieldName('condition');
    if (!cond) return false;
    const used = identifiers(cond);
    return !expects.some((e) => e.endIndex <= guard.startIndex && [...identifiers(e)].some((name) => used.has(name)));
  });
}

export function check(root: Node, _source: string, index?: NodeIndex, filePath?: string): { node: Node; message: string }[] {
  if (!filePath || !TEST_FILE.test(filePath)) return [];
  return (index ?? buildNodeIndex(root))
    .byType('call_expression')
    .flatMap((call) => {
      const body = testBody(call);
      return body ? silentGuards(body).map((node) => ({ node, message: MESSAGE })) : [];
    });
}
