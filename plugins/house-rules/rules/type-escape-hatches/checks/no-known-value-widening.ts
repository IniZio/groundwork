import type { Node } from '../../../src/hooks/lib/tree-sitter.js';
import { buildNodeIndex, type CheckHit, type NodeIndex } from '../../../src/engine/grouped-rule.js';
import {
  classifyUnsafeDictionaryValue,
  classifyWideningTarget,
  createTypeEnvironment,
  isKnownEvidenceExpression,
  unwrapExpression,
  type TypeEnvironment,
  type WideningTarget,
} from '../../../src/analysis/dictionary-types.js';
import { resolve, type Binding } from '../../../src/analysis/lexical-bindings.js';
import { containsUnknownType, functionParameterBindingName, functionParameterTypeAnnotation } from '../../../src/analysis/function-parameters.js';

export const id = 'no-known-value-widening';
export const upstream = "https://github.com/dmmulroy/anti-slop/blob/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b/src/rules/no-known-value-widening.ts";
export const tsOnly = true;

const FUNCTIONS = new Set(['arrow_function', 'function_declaration', 'function_expression', 'generator_function', 'generator_function_declaration', 'function_signature']);
const RETURN_OWNERS = new Set(['arrow_function', 'function_declaration', 'function_expression', 'generator_function', 'generator_function_declaration', 'method_definition']);

const named = (node: Node): Node[] => node.namedChildren.filter((c: Node | null): c is Node => c !== null && c.type !== 'comment');
const isAssertion = (node: Node): boolean => node.type === 'as_expression' || node.type === 'type_assertion';

/** The type inside a `: T` annotation field, if any. */
function annotationType(owner: Node | null, field: string): Node | null {
  const annotation = owner?.childForFieldName(field);
  return annotation ? (named(annotation)[0] ?? null) : null;
}

const DESTRUCTURING = new Set(['object_pattern', 'array_pattern', 'pair_pattern', 'rest_pattern', 'assignment_pattern', 'object_assignment_pattern']);

function constDeclarator(binding: Binding): Node | null {
  if (binding.kind !== 'const') return null;
  let child: Node = binding.id;
  let parent = child.parent;
  while (parent !== null && DESTRUCTURING.has(parent.type)) {
    child = parent;
    parent = child.parent;
  }
  if (parent?.type !== 'variable_declarator' || parent.childForFieldName('name')?.id !== child.id) return null;
  return parent;
}

const hasNonInitWrite = (binding: Binding): boolean => binding.references.some((r) => r.isWrite && !r.init);

/** The declarator when the binding is a plain `let|const|var x ...` identifier declaration. */
function variableDeclarator(binding: Binding): Node | null {
  const declarator = binding.id.parent;
  if (declarator?.type !== 'variable_declarator' || declarator.childForFieldName('name')?.id !== binding.id.id) return null;
  return declarator;
}

function stableConstInit(binding: Binding): Node | null {
  const declarator = constDeclarator(binding);
  const init = declarator?.childForFieldName('value') ?? null;
  return init && !hasNonInitWrite(binding) ? init : null;
}

function hasKnownEvidence(expression: Node, visited: ReadonlySet<number> = new Set()): boolean {
  if (isKnownEvidenceExpression(expression)) return true;
  const unwrapped = unwrapExpression(expression, true);
  if (unwrapped.type !== 'identifier') return false;
  const binding = resolve(unwrapped);
  if (!binding || visited.has(binding.id.id)) return false;
  const init = stableConstInit(binding);
  return init !== null && hasKnownEvidence(init, new Set([...visited, binding.id.id]));
}

function functionNode(node: Node): Node | null {
  return FUNCTIONS.has(node.type) ? node : null;
}

function localFunctionForCall(callee: Node): Node | null {
  const unwrapped = unwrapExpression(callee, true);
  const direct = functionNode(unwrapped);
  if (direct) return direct;
  if (unwrapped.type !== 'identifier') return null;
  const binding = resolve(unwrapped);
  if (!binding) return null;
  if (binding.kind === 'function') return binding.id.parent ? functionNode(binding.id.parent) : null;
  const init = variableDeclarator(binding)?.childForFieldName('value');
  return init ? functionNode(unwrapExpression(init, true)) : null;
}

function parameters(owner: Node): Node[] {
  const list = owner.childForFieldName('parameters');
  if (!list) return owner.childForFieldName('parameter') ? [owner.childForFieldName('parameter')!] : [];
  return named(list).filter((p) => p.type === 'required_parameter' || p.type === 'optional_parameter');
}

const parameterName = (parameter: Node): string | null => {
  const pattern = parameter.childForFieldName('pattern');
  return pattern?.type === 'identifier' ? functionParameterBindingName(pattern) : null;
};

function informative(type: Node, env: TypeEnvironment): boolean {
  return classifyUnsafeDictionaryValue(type, env) === null;
}

function callArgumentEvidence(expression: Node, env: TypeEnvironment, visited: ReadonlySet<number>): boolean {
  if (expression.type === 'parenthesized_expression' || expression.type === 'non_null_expression' || expression.type === 'satisfies_expression') {
    const inner = named(expression)[0];
    return inner !== undefined && callArgumentEvidence(inner, env, visited);
  }
  if (isAssertion(expression)) {
    const parts = named(expression);
    const type = expression.type === 'as_expression' ? parts[1] : parts.find((c) => c.type === 'type_arguments') && named(parts.find((c) => c.type === 'type_arguments')!)[0];
    return type !== undefined && informative(type, env);
  }
  if (expression.type === 'call_expression') {
    const owner = localFunctionForCall(expression.childForFieldName('function') ?? named(expression)[0]!);
    const returnType = owner ? annotationType(owner, 'return_type') : null;
    return returnType !== null && informative(returnType, env);
  }
  if (expression.type !== 'identifier') return isKnownEvidenceExpression(expression);
  const binding = resolve(expression);
  if (!binding || visited.has(binding.id.id)) return false;
  const owner = binding.id.parent;
  const isAnnotated =
    owner !== null &&
    ((owner.type === 'variable_declarator' && owner.childForFieldName('name')?.id === binding.id.id) ||
      ((owner.type === 'required_parameter' || owner.type === 'optional_parameter') && owner.childForFieldName('pattern')?.id === binding.id.id));
  const annotation = isAnnotated ? annotationType(owner, 'type') : null;
  if (annotation) return informative(annotation, env);
  const init = stableConstInit(binding);
  return init !== null && callArgumentEvidence(init, env, new Set([...visited, binding.id.id]));
}

function keyName(key: Node): string {
  if (key.type === 'string') return key.text.slice(1, -1);
  return key.text;
}

function functionName(owner: Node | null): string {
  if (!owner) return 'anonymous function';
  const name = owner.childForFieldName('name');
  if (name && owner.type !== 'method_definition') return name.text;
  const parent = owner.parent;
  if (owner.type === 'method_definition' && name) return keyName(name);
  if (parent?.type === 'variable_declarator') {
    const declared = parent.childForFieldName('name');
    if (declared?.type === 'identifier') return declared.text;
  }
  return 'anonymous function';
}

function enclosingFunction(node: Node): Node | null {
  const seen = new Set<number>();
  for (let current = node.parent; current && current.type !== 'program' && !seen.has(current.id); current = current.parent) {
    seen.add(current.id);
    if (RETURN_OWNERS.has(current.type)) return current;
  }
  return null;
}

/** An assertion directly nested in another assertion (parentheses ignored) leaves reporting to the outer one. */
function hasParentAssertion(node: Node): boolean {
  const seen = new Set<number>();
  let current = node.parent;
  while (current && current.type === 'parenthesized_expression' && !seen.has(current.id)) {
    seen.add(current.id);
    current = current.parent;
  }
  return current !== null && isAssertion(current);
}

function isEmptyObject(expression: Node): boolean {
  const unwrapped = unwrapExpression(expression, true);
  return unwrapped.type === 'object' && named(unwrapped).length === 0;
}

export function check(root: Node, _source: string, index?: NodeIndex): CheckHit[] {
  const idx = index ?? buildNodeIndex(root);
  const env = createTypeEnvironment(root, idx);
  const hits: CheckHit[] = [];

  const report = (expression: Node | null | undefined, target: WideningTarget | null, subject: string): void => {
    if (!expression || !target) return;
    if ((target.kind === 'open dictionary' || target.kind === 'generic container') && isEmptyObject(expression)) return;
    if (!hasKnownEvidence(expression)) return;
    hits.push({
      node: expression,
      message: `The explicit ${target.kind} type on ${subject} discards known type evidence. Keep inference, validate with \`satisfies\`, or use a named owner contract.`,
    });
  };
  const targetOf = (type: Node | null): WideningTarget | null => (type ? classifyWideningTarget(type, env) : null);

  for (const node of idx.byType('variable_declarator')) {
    const name = node.childForFieldName('name');
    if (name?.type !== 'identifier') continue;
    report(node.childForFieldName('value'), targetOf(annotationType(node, 'type')), `binding \`${name.text}\``);
  }
  for (const node of idx.byType('public_field_definition')) {
    const key = node.childForFieldName('name');
    if (!key) continue;
    report(node.childForFieldName('value'), targetOf(annotationType(node, 'type')), `property \`${keyName(key)}\``);
  }
  for (const node of idx.byType('assignment_expression')) {
    const left = node.childForFieldName('left');
    if (left?.type !== 'identifier') continue;
    const binding = resolve(left);
    const declarator = binding ? variableDeclarator(binding) : null;
    const name = declarator?.childForFieldName('name');
    if (!declarator || name?.type !== 'identifier') continue;
    report(node.childForFieldName('right'), targetOf(annotationType(declarator, 'type')), `binding \`${name.text}\``);
  }
  for (const node of idx.byType('call_expression')) {
    const callee = node.childForFieldName('function');
    const owner = callee ? localFunctionForCall(callee) : null;
    const predicate = owner?.childForFieldName('return_type');
    const subjectName = predicate?.type === 'type_predicate_annotation' ? named(predicate)[0]?.childForFieldName('name')?.text : undefined;
    if (!owner || subjectName === undefined) continue;
    const params = parameters(owner);
    const position = params.findIndex((p) => parameterName(p) === subjectName);
    const parameter = params[position];
    const args = node.childForFieldName('arguments');
    const argument = args ? named(args)[position] : undefined;
    if (!parameter || !argument || argument.type === 'spread_element') continue;
    const annotation = functionParameterTypeAnnotation(parameter);
    const annotated = annotation ? (named(annotation)[0] ?? null) : null;
    if (!containsUnknownType(annotated)) continue;
    if (!callArgumentEvidence(argument, env, new Set())) continue;
    hits.push({
      node: argument,
      message: `The explicit unknown type on argument for parameter \`${functionParameterBindingName(parameter.childForFieldName('pattern')!)}\` of \`${functionName(owner)}\` discards known type evidence. Keep inference, validate with \`satisfies\`, or use a named owner contract.`,
    });
  }
  for (const node of idx.byType('return_statement')) {
    const owner = enclosingFunction(node);
    report(named(node)[0], targetOf(annotationType(owner, 'return_type')), `return value of \`${functionName(owner)}\``);
  }
  for (const node of idx.byType('arrow_function')) {
    const body = node.childForFieldName('body');
    if (!body || body.type === 'statement_block') continue;
    report(body, targetOf(annotationType(node, 'return_type')), `return value of \`${functionName(node)}\``);
  }
  for (const node of [...idx.byType('as_expression'), ...idx.byType('type_assertion')]) {
    if (hasParentAssertion(node)) continue;
    const parts = named(node);
    const expression = node.type === 'as_expression' ? parts[0] : parts[parts.length - 1];
    const typeArgs = parts.find((c) => c.type === 'type_arguments');
    const type = node.type === 'as_expression' ? parts[1] : typeArgs ? named(typeArgs)[0] : undefined;
    report(expression, targetOf(type ?? null), 'assertion');
  }
  return hits.sort((a, b) => (a.node?.startIndex ?? 0) - (b.node?.startIndex ?? 0));
}
