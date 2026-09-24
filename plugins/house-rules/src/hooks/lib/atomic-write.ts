import { chmodSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export type AtomicWriteResult =
  | { ok: true }
  | { ok: false; reason: string };

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

export function normalizeTrailingNewline(content: string, trailNl: boolean): string {
  if (trailNl && !content.endsWith('\n')) return content + '\n';
  if (!trailNl && content.endsWith('\n')) return content.slice(0, -1);
  return content;
}

/**
 * Write `normalizedContent` to `absPath` atomically.
 * Steps: mode-preserve → tmp write → tmp re-read verify → orig-hash re-check → rename.
 * `verifyContent` overrides what the tmp re-read is compared against (defaults to `normalizedContent`).
 * Returns { ok: false, reason } on any failure; tmp is cleaned up.
 */
export function atomicWrite(
  absPath: string,
  normalizedContent: string,
  origHash: string,
  opts?: { afterTmpWrite?: (tmp: string, dest: string) => void; verifyContent?: string },
): AtomicWriteResult {
  const tmp = absPath + `.cdg-${process.pid}`;
  try {
    const mode = statSync(absPath).mode & 0o7777;
    writeFileSync(tmp, normalizedContent);
    chmodSync(tmp, mode);
    opts?.afterTmpWrite?.(tmp, absPath);

    const expected = opts?.verifyContent ?? normalizedContent;
    const tmpContent = readFileSync(tmp, 'utf8');
    if (tmpContent !== expected) {
      try { unlinkSync(tmp); } catch { }
      return { ok: false, reason: `tmp content mismatch for ${absPath}` };
    }

    let currentContent: string;
    try {
      currentContent = readFileSync(absPath, 'utf8');
    } catch (e) {
      try { unlinkSync(tmp); } catch { }
      return { ok: false, reason: `could not re-read ${absPath}: ${e}` };
    }
    if (sha256(currentContent) !== origHash) {
      try { unlinkSync(tmp); } catch { }
      return { ok: false, reason: `${absPath} changed on disk before rename` };
    }

    renameSync(tmp, absPath);
    return { ok: true };
  } catch (e) {
    try { unlinkSync(tmp); } catch { }
    return { ok: false, reason: `write failed ${absPath}: ${e}` };
  }
}
