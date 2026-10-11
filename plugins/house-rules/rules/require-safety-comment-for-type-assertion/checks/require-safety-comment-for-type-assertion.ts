import type { Node } from '../../../src/hooks/lib/tree-sitter.js';
import type { CheckHit, NodeIndex } from '../../../src/engine/grouped-rule.js';
import { findAssertionsNeedingJustification } from '../../../src/analysis/type-assertion-safety.js';

export const id = 'require-safety-comment-for-type-assertion';
export const upstream = "https://github.com/dmmulroy/anti-slop/blob/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b/src/rules/require-safety-comment-for-type-assertion.ts";
export const tsOnly = true;

export const MESSAGE =
  'This type assertion has no `SAFETY:` justification. State the checked invariant immediately before the assertion or its containing statement.';

export function check(root: Node, _source: string, _index?: NodeIndex, _filePath?: string): CheckHit[] {
  return findAssertionsNeedingJustification(root).map((node) => ({ node, message: MESSAGE }));
}
