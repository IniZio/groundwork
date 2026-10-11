import type { Node } from '../../../src/hooks/lib/tree-sitter.js';
import type { CheckHit, NodeIndex } from '../../../src/engine/grouped-rule.js';
import { findMissingBlankLines } from '../../../src/analysis/statement-padding.js';

export const id = 'require-readable-spacing';
export const upstream = "https://github.com/dmmulroy/anti-slop/blob/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b/src/rules/require-readable-spacing.ts";
export const tsOnly = false;

export const MESSAGE = 'Expected blank line before this statement.';

export function check(root: Node, _source: string, _index?: NodeIndex, _filePath?: string): CheckHit[] {
  return findMissingBlankLines(root).map((v) => ({ node: v.next, message: MESSAGE }));
}
