/**
 * Shared Effect tagged-value analysis, mirroring anti-slop `effect/shared/tagged-values.ts` on tree-sitter.
 * Parentheses are transparent (ESTree has no paren node). An optional-chain expression such as `x?._tag` is a
 * ChainExpression upstream, so it is not a tag member; `(x?.y)._tag` is, because the parens end the chain.
 */
import type { Node } from '../hooks/lib/tree-sitter.js';

const EQUALITY_OPERATORS = new Set(['==', '===', '!=', '!==']);
const BROAD_EFFECT_CATCH_METHODS = new Set(['catch', 'catchAll', 'catchIf']);
const FUNCTION_EXPRESSIONS = new Set(['arrow_function', 'function_expression', 'generator_function', 'method_definition']);
const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  n: '\n',
  r: '\r',
  t: '\t',
  b: '\b',
  f: '\f',
  v: '\v',
  '0': '\0',
};

function unparen(node: Node): Node {
  let cur = node;
  while (cur.type === 'parenthesized_expression') {
    const inner = cur.namedChildren[0];
    if (!inner) break;
    cur = inner;
  }
  return cur;
}

function decodeEscape(text: string): string {
  const body = text.slice(1);
  if (body.startsWith('u{')) return String.fromCodePoint(parseInt(body.slice(2, -1), 16));
  if (body.startsWith('u') || body.startsWith('x')) return String.fromCharCode(parseInt(body.slice(1), 16));
  return SIMPLE_ESCAPES[body] ?? body;
}

/** Cooked value of a plain string literal node, or undefined when the node is not one (template strings excluded). */
function stringValue(node: Node): string | undefined {
  if (node.type !== 'string') return undefined;
  let out = '';
  for (const child of node.namedChildren) {
    if (child.type === 'string_fragment') out += child.text;
    else if (child.type === 'escape_sequence') out += decodeEscape(child.text);
  }
  return out;
}

/** Whether a node is a plain string literal (`'x'`, `"x"`); template literals do not count. */
export function isStringLiteral(node: Node | null | undefined): boolean {
  return !!node && stringValue(unparen(node)) !== undefined;
}

function hasOptionalChain(node: Node): boolean {
  let cur: Node | null = node;
  while (cur && (cur.type === 'member_expression' || cur.type === 'subscript_expression' || cur.type === 'call_expression')) {
    if (cur.children.some((c: Node | null) => c?.type === 'optional_chain')) return true;
    cur = cur.childForFieldName(cur.type === 'call_expression' ? 'function' : 'object');
  }
  return false;
}

/** Read a member access as `{ object, name }` for `.name` or `['name']`; null for anything else. */
function memberAccess(node: Node): { readonly object: Node; readonly name: string } | null {
  const target = unparen(node);
  if (hasOptionalChain(target)) return null;
  const object = target.childForFieldName('object');
  if (!object) return null;
  if (target.type === 'member_expression') {
    const property = target.childForFieldName('property');
    return property?.type === 'property_identifier' ? { object, name: property.text } : null;
  }
  if (target.type === 'subscript_expression') {
    const index = target.childForFieldName('index');
    const name = index ? stringValue(unparen(index)) : undefined;
    return name === undefined ? null : { object, name };
  }
  return null;
}

/** Whether a node reads `<expr>._tag` or `<expr>["_tag"]`. */
export function isTagMember(node: Node | null | undefined): boolean {
  return !!node && memberAccess(node)?.name === '_tag';
}

/** Return the `_tag` member operand of `x._tag === 'lit'` (either side) for an equality binary expression. */
export function tagMemberFromComparison(node: Node): Node | undefined {
  if (node.type !== 'binary_expression') return undefined;
  const operator = node.childForFieldName('operator')?.text;
  const left = node.childForFieldName('left');
  const right = node.childForFieldName('right');
  if (!operator || !EQUALITY_OPERATORS.has(operator) || !left || !right) return undefined;
  if (isTagMember(left) && isStringLiteral(right)) return unparen(left);
  if (isTagMember(right) && isStringLiteral(left)) return unparen(right);
  return undefined;
}

function isBroadEffectCatchCall(node: Node | null | undefined): node is Node {
  if (node?.type !== 'call_expression') return false;
  const callee = node.childForFieldName('function');
  const access = callee ? memberAccess(callee) : null;
  const target = callee ? unparen(callee) : null;
  return (
    target?.type === 'member_expression' &&
    access !== null &&
    access.object.type === 'identifier' &&
    access.object.text === 'Effect' &&
    BROAD_EFFECT_CATCH_METHODS.has(access.name)
  );
}

/** Whether the nearest enclosing function expression is a callback argument of `Effect.catch|catchAll|catchIf`. */
export function isInsideBroadEffectHandler(node: Node): boolean {
  let current: Node | null = node.parent;
  while (current) {
    if (FUNCTION_EXPRESSIONS.has(current.type)) {
      let outer: Node | null = current.parent;
      while (outer?.type === 'parenthesized_expression') {
        current = outer;
        outer = outer.parent;
      }
      if (outer?.type !== 'arguments') return false;
      const call = outer.parent;
      return isBroadEffectCatchCall(call);
    }
    current = current.parent;
  }
  return false;
}

/** Whether a tag member's object is itself `.reason` / `["reason"]`, i.e. `x.reason._tag`. */
export function isReasonTagMember(node: Node): boolean {
  const object = memberAccess(node)?.object;
  if (!object) return false;
  // An inner chain member is still a MemberExpression upstream, so optional chains are allowed here.
  const target = unparen(object);
  if (target.type === 'member_expression') {
    const property = target.childForFieldName('property');
    return property?.type === 'property_identifier' && property.text === 'reason';
  }
  if (target.type === 'subscript_expression') {
    const index = target.childForFieldName('index');
    return !!index && stringValue(unparen(index)) === 'reason';
  }
  return false;
}

/** Static key of an object member (`pair`, shorthand, method), or undefined for computed non-string/other keys. */
export function propertyName(property: Node): string | undefined {
  if (property.type === 'shorthand_property_identifier') return property.text;
  if (property.type !== 'pair' && property.type !== 'method_definition') return undefined;
  const key = property.childForFieldName(property.type === 'pair' ? 'key' : 'name');
  if (!key) return undefined;
  if (key.type === 'property_identifier') return key.text;
  if (key.type === 'computed_property_name') {
    const inner = key.namedChildren[0];
    return inner ? stringValue(unparen(inner)) : undefined;
  }
  return stringValue(key);
}

/** Whether an object literal is an argument of `Match.when(...)` / `Match.not(...)`. */
export function isMatchPatternObject(node: Node): boolean {
  if (node.type !== 'object') return false;
  let child = node;
  let args = node.parent;
  while (args?.type === 'parenthesized_expression') {
    child = args;
    args = args.parent;
  }
  if (args?.type !== 'arguments' || !args.namedChildren.some((c: Node | null) => c?.id === child.id)) return false;
  const call = args.parent;
  const callee = call?.type === 'call_expression' ? call.childForFieldName('function') : null;
  if (!callee) return false;
  const target = unparen(callee);
  if (target.type !== 'member_expression') return false;
  const object = target.childForFieldName('object');
  const property = target.childForFieldName('property');
  return (
    object?.type === 'identifier' &&
    object.text === 'Match' &&
    property?.type === 'property_identifier' &&
    (property.text === 'when' || property.text === 'not')
  );
}
