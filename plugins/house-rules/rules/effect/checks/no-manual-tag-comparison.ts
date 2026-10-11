import type { Node } from '../../../src/hooks/lib/tree-sitter.js';
import { buildNodeIndex, type CheckHit, type NodeIndex } from '../../../src/engine/grouped-rule.js';
import {
  isInsideBroadEffectHandler,
  isTagMember,
  tagMemberFromComparison,
} from '../../../src/analysis/effect-tagged-values.js';

export const id = 'no-manual-tag-comparison';
export const upstream = "https://github.com/dmmulroy/anti-slop/blob/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b/src/effect/rules/no-manual-tag-comparison.ts";

const COMPARISON_MESSAGE = 'Use Match.tag/Match.tags for tagged-value branching, or Predicate.isTagged for a simple reusable predicate.';
const SWITCH_MESSAGE = 'Use Match.value(value).pipe(Match.tag/Match.tags/Match.tagsExhaustive) or the tagged enum `$match` helper instead of switching on `_tag`.';

export function check(root: Node, _source: string, index?: NodeIndex, _filePath?: string): CheckHit[] {
  const idx = index ?? buildNodeIndex(root);
  const hits: CheckHit[] = [];
  for (const node of idx.byType('binary_expression')) {
    if (tagMemberFromComparison(node) === undefined || isInsideBroadEffectHandler(node)) continue;
    hits.push({ node, message: COMPARISON_MESSAGE });
  }
  for (const node of idx.byType('switch_statement')) {
    const discriminant = node.childForFieldName('value');
    if (!discriminant || !isTagMember(discriminant) || isInsideBroadEffectHandler(node)) continue;
    hits.push({ node, message: SWITCH_MESSAGE });
  }
  return hits;
}
