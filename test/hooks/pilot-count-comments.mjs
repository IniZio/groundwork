// check-comments-exempt — vendored snapshot; large JSDoc is provenance, not over-commenting
/**
 * Vendored from agentic-artifacts/scripts/check-comment-density.mjs.
 * Upstream revision: 81e8ae69bc1c720ad9e5733d8232db1790a7299a (committed 2026-09-06).
 *
 * Divergences from upstream (all within the countComments function body):
 *   1. Signature / read path: countComments(filepath) → export function countComments(content);
 *      the `readFileSync` call and `const text = …` binding are removed; callers supply
 *      file content directly as a string.
 *   2. The comment `// Skip @ts- directives` (upstream line ~95, inside the `//` branch) was
 *      deleted. Behaviourally inert — the surrounding conditional is unchanged.
 *
 * Semantic downgrade: this file is a snapshot, not a live mirror of upstream. No tooling
 * detects drift from the upstream source; re-vendoring is a manual step. The parity test
 * therefore validates consistency with this snapshot, not with the live pilot.
 *
 * Diff excerpt (upstream → vendored, countComments function only):
 *   - function countComments(filepath) {
 *   -   const text = readFileSync(filepath, 'utf8');
 *   -   const lines = text.split('\n');
 *   + export function countComments(content) {
 *   +   const lines = content.split('\n');
 *   ...
 *   -         // Skip @ts- directives
 *        if (trimmed.startsWith('//@ts-') || trimmed.startsWith('// @ts-')) continue;
 */

export function countComments(content) {
  const lines = content.split('\n');
  const total = lines.length;
  let comments = 0;
  let inBlock = false;
  let skipBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (i === 0 && trimmed.startsWith('#!')) continue;

    if (!inBlock) {
      if (trimmed.startsWith('/*') || trimmed.startsWith('{/*')) {
        const isJsx = trimmed.startsWith('{/*');
        const closer = isJsx ? '*/' : '*/';
        if (i < 3) {
          const closeIdx = trimmed.indexOf(closer, isJsx ? 3 : 2);
          if (closeIdx !== -1) {
            skipBlock = false;
            continue;
          }
          skipBlock = true;
          inBlock = true;
          let closesBy = -1;
          for (let j = i + 1; j < lines.length && j <= 3; j++) {
            if (lines[j].trim().includes(closer)) { closesBy = j; break; }
          }
          if (closesBy !== -1 && closesBy < 3) {
            i = closesBy;
            inBlock = false;
            skipBlock = false;
            continue;
          }
          skipBlock = false;
          comments++;
          continue;
        }

        inBlock = true;
        skipBlock = false;
        comments++;

        const startOffset = trimmed.startsWith('{/*') ? 3 : 2;
        if (trimmed.indexOf(closer, startOffset) !== -1) {
          inBlock = false;
        }
        continue;
      }

      if (trimmed.startsWith('{/*') && trimmed.includes('*/')) {
        comments++;
        continue;
      }

      if (trimmed.startsWith('//')) {
        if (trimmed.startsWith('//@ts-') || trimmed.startsWith('// @ts-')) continue;
        comments++;
        continue;
      }

    } else {
      comments++;
      const closer = skipBlock ? '*/' : '*/';
      if (trimmed.includes('*/')) {
        inBlock = false;
        skipBlock = false;
      }
    }
  }

  return { total, comments };
}
