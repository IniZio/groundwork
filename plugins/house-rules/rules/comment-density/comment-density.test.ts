import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import rule from './index.js';
import { cases } from './cases.js';
import { ruleTester } from '../../src/engine/rule-tester.js';
import { netNewCommentRows, detectLanguage } from '../../src/hooks/lib/comment-density.js';
import { diffTextToHunks } from '../../src/hooks/lib/work-scope.js';

// Register ruleTester suite
ruleTester(rule, cases);

// ---------------------------------------------------------------------------
// Parity tests: rule findings must match what netNewCommentRows/density produce
// ---------------------------------------------------------------------------

const FIXTURES_DIR = path.resolve(import.meta.dir, '../../test/fixtures/comment-density');

describe('comment-density parity', () => {
  it('clean.ts: no findings', async () => {
    const text = readFileSync(path.join(FIXTURES_DIR, 'clean.ts'), 'utf8');
    const lang = detectLanguage('clean.ts');
    expect(lang).not.toBeNull();
    const allLines = text.split('\n').map((_, i) => i + 1);
    const hunks = [{ added: allLines, removed: [], removedBaseLineNos: [] }];

    const netResult = await netNewCommentRows('', text, lang!, hunks);
    expect(netResult.ok).toBe(true);
    if (!netResult.ok) return;

    const findings = await rule.check({
      repoRoot: FIXTURES_DIR,
      mode: 'cli',
      files: [{
        path: 'clean.ts',
        text,
        addedHunks: hunks,
      }],
    });
    // clean.ts has no comments: both report 0 net-new comments
    expect(findings).toHaveLength(0);
    expect(netResult.rows.length).toBe(0);
  });

  it('over-cap.ts: findings match net-new comment count', async () => {
    const text = readFileSync(path.join(FIXTURES_DIR, 'over-cap.ts'), 'utf8');
    const lang = detectLanguage('over-cap.ts');
    expect(lang).not.toBeNull();
    const rawLines = text.split('\n');
    // exclude trailing empty line
    const lineCount = rawLines[rawLines.length - 1] === '' ? rawLines.length - 1 : rawLines.length;
    const allLines = Array.from({ length: lineCount }, (_, i) => i + 1);
    const hunks = [{ added: allLines, removed: [], removedBaseLineNos: [] }];

    const netResult = await netNewCommentRows('', text, lang!, hunks);
    expect(netResult.ok).toBe(true);
    if (!netResult.ok) return;

    const findings = await rule.check({
      repoRoot: FIXTURES_DIR,
      mode: 'cli',
      files: [{
        path: 'over-cap.ts',
        text,
        addedHunks: hunks,
      }],
    });

    // Both the rule and direct netNewCommentRows agree: over-cap file has findings
    const totalAdded = hunks.reduce((s, h) => s + h.added.length, 0);
    const directOver = netResult.rows.length / totalAdded * 100 > 5;
    expect(directOver).toBe(true);
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe('comment-density');
    // finding message includes the net-new comment count
    expect(findings[0].message).toContain(`${netResult.rows.length} comments in`);
  });

  it('base/post pair with moved comment: parity on net-new rows', async () => {
    // base has a comment at line 1; post moves it to line 3
    // greedy pairing pairs the moved comment, so net-new = 0 → under cap
    const baseText = `// moved comment\nexport const a = 1;\nexport const b = 2;\n${Array.from({ length: 30 }, (_, i) => `export const c${i} = ${i};`).join('\n')}`;
    const postText = `export const a = 1;\nexport const b = 2;\n// moved comment\n${Array.from({ length: 30 }, (_, i) => `export const c${i} = ${i};`).join('\n')}`;

    const lang = detectLanguage('moved.ts');
    expect(lang).not.toBeNull();

    const hunks = diffTextToHunks(baseText, postText);
    const netResult = await netNewCommentRows(baseText, postText, lang!, hunks);
    expect(netResult.ok).toBe(true);
    if (!netResult.ok) return;

    const findings = await rule.check({
      repoRoot: '/tmp',
      mode: 'cli',
      files: [{
        path: 'moved.ts',
        text: postText,
        baseText,
        addedHunks: hunks,
      }],
    });

    // Direct calculation and rule both agree: moved comment pairs → same result
    const totalAdded = hunks.reduce((s, h) => s + h.added.length, 0);
    const directOver = netResult.rows.length / Math.max(totalAdded, 1) * 100 > 5;
    const ruleFinds = findings.length > 0;
    expect(directOver).toBe(ruleFinds);
  });
});
