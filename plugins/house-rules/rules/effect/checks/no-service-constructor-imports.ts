import type { Node } from '../../../src/hooks/lib/tree-sitter.js';
import { buildNodeIndex, type CheckHit, type NodeIndex } from '../../../src/engine/grouped-rule.js';

export const id = 'no-service-constructor-imports';
export const upstream = "https://github.com/dmmulroy/anti-slop/blob/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b/src/effect/rules/no-service-constructor-imports.ts";

const SERVICE_CONSTRUCTOR_NAME = /^make[A-Z]/u;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;

function message(name: string): string {
  return `Do not import Effect service constructor "${name}" into runtime code. Import the owning Layer, yield the contextual service, and allow its requirements to propagate to the composition root.`;
}

export function check(root: Node, _source: string, index?: NodeIndex, filePath?: string): CheckHit[] {
  if (filePath !== undefined && TEST_FILE.test(filePath.replaceAll('\\', '/'))) return [];
  const hits: CheckHit[] = [];
  for (const decl of (index ?? buildNodeIndex(root)).byType('import_statement')) {
    const source = decl.childForFieldName('source')?.text.slice(1, -1) ?? '';
    if (!source.startsWith('./') && !source.startsWith('../')) continue;
    for (const specifier of (index ?? buildNodeIndex(decl)).byType('import_specifier')) {
      if (specifier.parent?.parent?.parent?.id !== decl.id) continue;
      const name = specifier.childForFieldName('name')?.text ?? '';
      if (SERVICE_CONSTRUCTOR_NAME.test(name)) hits.push({ node: specifier, message: message(name) });
    }
  }
  return hits;
}
