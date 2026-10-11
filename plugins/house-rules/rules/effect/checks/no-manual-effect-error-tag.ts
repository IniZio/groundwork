import type { Node } from '../../../src/hooks/lib/tree-sitter.js';
import { buildNodeIndex, type CheckHit, type NodeIndex } from '../../../src/engine/grouped-rule.js';
import {
  isInsideBroadEffectHandler,
  isReasonTagMember,
  isTagMember,
  tagMemberFromComparison,
} from '../../../src/analysis/effect-tagged-values.js';

export const id = 'no-manual-effect-error-tag';
export const upstream = "https://github.com/dmmulroy/anti-slop/blob/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b/src/effect/rules/no-manual-effect-error-tag.ts";

const TAG_MESSAGE = 'Use Effect.catchTag or Effect.catchTags instead of manually discriminating a tagged error in a broad Effect catch handler.';
const REASON_MESSAGE = 'Use Effect.catchReason or Effect.catchReasons instead of manually discriminating a tagged `reason` in a broad Effect catch handler.';

export function check(root: Node, _source: string, index?: NodeIndex, _filePath?: string): CheckHit[] {
  const idx = index ?? buildNodeIndex(root);
  const hits: CheckHit[] = [];
  for (const node of idx.byType('binary_expression')) {
    const member = tagMemberFromComparison(node);
    if (member === undefined || !isInsideBroadEffectHandler(node)) continue;
    hits.push({ node, message: isReasonTagMember(member) ? REASON_MESSAGE : TAG_MESSAGE });
  }
  for (const node of idx.byType('switch_statement')) {
    const discriminant = node.childForFieldName('value');
    if (!discriminant || !isTagMember(discriminant) || !isInsideBroadEffectHandler(node)) continue;
    hits.push({ node, message: isReasonTagMember(discriminant) ? REASON_MESSAGE : TAG_MESSAGE });
  }
  return hits;
}
