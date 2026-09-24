import { readFileSync, writeFileSync, chmodSync, renameSync, unlinkSync, statSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Rule, RuleContext, Finding, FixResult } from '../../src/engine/types.js';
import { detectLanguage, netNewCommentRows, density, autoFix } from '../../src/hooks/lib/comment-density.js';
import { LANG_FIX_TABLE, refusesPreExistingRemoval } from '../../src/hooks/gate.js';

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

const CAP = 5;

function normForFingerprint(row: string): string {
  return row.trim().replace(/\s+/g, ' ');
}

const rule: Rule = {
  id: 'comment-density',
  meta: { description: 'Flags files where added comment lines exceed 5 per 100 added lines.' },
  vehicles: ['tree-sitter', 'diff'],

  async check(ctx: RuleContext): Promise<Finding[]> {
    const findings: Finding[] = [];
    for (const file of ctx.files ?? []) {
      if (!file.addedHunks || !file.text) continue;

      const lang = detectLanguage(file.path);
      if (!lang) continue;

      const totalAdded = file.addedHunks.reduce((s, h) => s + h.added.length, 0);
      if (totalAdded === 0) continue;

      const baseText = file.baseText ?? '';

      let effective: number;
      let commentRows: number[]; // 1-based

      const netResult = await netNewCommentRows(baseText, file.text, lang, file.addedHunks);
      if (netResult.ok) {
        effective = netResult.rows.length;
        commentRows = netResult.rows;
      } else {
        const rowSet = new Set(file.addedHunks.flatMap(h => h.added.map(n => n - 1)));
        const dr = await density(file.text, lang, rowSet);
        effective = dr.effective;
        commentRows = dr.commentRows.map(r => r + 1);
      }

      if (effective / totalAdded * 100 > CAP) {
        const ratio = (effective / totalAdded * 100).toFixed(1);
        const first5 = commentRows.slice(0, 5).join(', ');
        const message = `${ratio}/100 (${effective} comments in ${totalAdded} added lines; rows ${first5})`;
        const line = commentRows[0];

        const postLines = file.text.split('\n');
        const fingerprintTexts = commentRows
          .map(r => normForFingerprint(postLines[r - 1] ?? ''))
          .sort();
        const fingerprintBasis = fingerprintTexts.join('\n');

        findings.push({
          ruleId: 'comment-density',
          path: file.path,
          line,
          message,
          fingerprintBasis,
        });
      }
    }
    return findings;
  },

  async fix(ctx: RuleContext): Promise<FixResult> {
    let fixed = 0;
    let skipped = 0;

    for (const file of ctx.files ?? []) {
      if (!file.addedHunks || !file.text) { skipped++; continue; }

      const lang = detectLanguage(file.path);
      if (!lang) { skipped++; continue; }

      const tableEntry = LANG_FIX_TABLE[lang];
      if (!tableEntry || tableEntry.stability !== 'stable' || tableEntry.applicability !== 'safe') {
        skipped++;
        continue;
      }

      const rowSet = new Set(file.addedHunks.flatMap(h => h.added.map(n => n - 1)));
      const baseText = file.baseText ?? '';
      const netResult = await netNewCommentRows(baseText, file.text, lang, file.addedHunks);
      const netNewRows0 = netResult.ok ? new Set(netResult.rows.map(n => n - 1)) : rowSet;

      const ar = await autoFix(file.text, lang, rowSet, undefined, netNewRows0);
      if (!ar.ok || ar.removed === 0) { skipped++; continue; }

      const removedCheck = ar.rowChanges.map(rc => ({ preExisting: !rowSet.has(rc.origRow) }));
      if (refusesPreExistingRemoval(removedCheck)) { skipped++; continue; }

      const absPath = path.join(ctx.repoRoot, file.path);
      let diskText: string;
      try { diskText = readFileSync(absPath, 'utf8'); } catch { skipped++; continue; }

      const trailNl = diskText.endsWith('\n');
      let content = ar.fixed;
      if (trailNl && !content.endsWith('\n')) content += '\n';
      else if (!trailNl && content.endsWith('\n')) content = content.slice(0, -1);

      const origHash = sha256(diskText);
      let wrote = false;
      try {
        const mode = statSync(absPath).mode & 0o7777;
        const tmp = absPath + `.cdg-${process.pid}`;
        writeFileSync(tmp, content);
        chmodSync(tmp, mode);
        const current = readFileSync(absPath, 'utf8');
        if (sha256(current) !== origHash) {
          try { unlinkSync(tmp); } catch { /* ignore */ }
          skipped++;
          continue;
        }
        renameSync(tmp, absPath);
        wrote = true;
      } catch { skipped++; continue; }

      if (wrote) { fixed++; } else { skipped++; }
    }

    return { fixed, skipped };
  },
};

export default rule;
