import type { Node } from '../../../src/hooks/lib/tree-sitter.js';
import { buildNodeIndex, type CheckHit, type NodeIndex } from '../../../src/engine/grouped-rule.js';
import {
  isMatchPatternObject,
  isStringLiteral,
  propertyName,
} from '../../../src/analysis/effect-tagged-values.js';

export const id = 'no-manual-tagged-construction';
export const upstream = "https://github.com/dmmulroy/anti-slop/blob/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b/src/effect/rules/no-manual-tagged-construction.ts";

const MESSAGE = 'Use the existing Schema tagged `.make`, tagged class/error constructor, or Data.taggedEnum variant constructor instead of writing a literal `_tag` object.';

export function check(root: Node, _source: string, index?: NodeIndex, _filePath?: string): CheckHit[] {
  const idx = index ?? buildNodeIndex(root);
  const hits: CheckHit[] = [];
  for (const node of idx.byType('object')) {
    if (isMatchPatternObject(node)) continue;
    const tag = node.namedChildren.find(
      (property: Node | null) =>
        property?.type === 'pair' &&
        propertyName(property) === '_tag' &&
        isStringLiteral(property.childForFieldName('value')),
    );
    if (tag) hits.push({ node: tag, message: MESSAGE });
  }
  return hits;
}
