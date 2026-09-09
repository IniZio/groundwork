/**
 * Vendored from agentic-artifacts/scripts/check-comment-density.mjs.
 * Sole adaptation: countComments(filepath) → countComments(content) — readFileSync removed
 * so callers supply content directly. All counting logic is byte-faithful to the source.
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
