import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Rule, RuleContext, Finding, FixResult, FixFileResult, FixOptions } from '../../src/engine/types.js';
import { commentDensityEditCheck } from './edit-check.js';
import { netNewCommentRows, density, autoFix } from '../../src/hooks/lib/comment-density.js';
import { languageForPath, LANGUAGES } from '../../src/hooks/languages/registry.js';
import { refusesPreExistingRemoval } from '../../src/hooks/gate.js';
import { fixEntryFor } from './languages.js';
import { atomicWrite, normalizeTrailingNewline, sha256 } from '../../src/hooks/lib/atomic-write.js';
import { appendFix } from '../../src/hooks/lib/autofix-ledger.js';

const CAP = 5;

function normForFingerprint(row: string): string {
  return row.trim().replace(/\s+/g, ' ');
}

const rule: Rule = {
  id: 'comment-density',
  meta: { description: 'Flags files where added comment lines exceed 5 per 100 added lines.' },
  languages: LANGUAGES,
  editCheck: commentDensityEditCheck,

  canFixPath(filePath: string): boolean {
    const lang = languageForPath(filePath);
    if (!lang) return false;
    const entry = fixEntryFor(lang);
    return entry.stability === 'stable' && entry.applicability === 'safe';
  },

  async check(ctx: RuleContext): Promise<Finding[]> {
    const findings: Finding[] = [];
    for (const file of ctx.files ?? []) {
      if (!file.addedHunks || !file.text) continue;

      const lang = languageForPath(file.path);
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

  async fix(ctx: RuleContext, opts?: FixOptions): Promise<FixResult> {
    let fixed = 0;
    let skipped = 0;
    const files: FixFileResult[] = [];

    const doWrite = opts?.write !== false;

    function decline(filePath: string, reason: string): void {
      files.push({ path: filePath, status: 'declined', reason });
      skipped++;
    }

    for (const file of ctx.files ?? []) {
      if (!file.addedHunks || !file.text) { decline(file.path, 'no added lines'); continue; }

      const lang = languageForPath(file.path);
      if (!lang) { decline(file.path, 'unsupported language'); continue; }

      if (!rule.canFixPath!(file.path)) {
        const reason = `autofix not enabled for ${lang} (${fixEntryFor(lang).stability})`;
        decline(file.path, reason);
        continue;
      }

      const rowSet = new Set(file.addedHunks.flatMap(h => h.added.map(n => n - 1)));
      const baseText = file.baseText ?? '';
      const netResult = await netNewCommentRows(baseText, file.text, lang, file.addedHunks);
      const netNewRows0 = netResult.ok ? new Set(netResult.rows.map(n => n - 1)) : rowSet;

      const ar = await autoFix(file.text, lang, rowSet, undefined, netNewRows0);
      if (!ar.ok) { decline(file.path, `autofix failed: ${ar.reason}`); continue; }
      if (ar.removed === 0) { decline(file.path, 'no removable comments'); continue; }

      const removedCheck = ar.rowChanges.map(rc => ({ preExisting: !rowSet.has(rc.origRow) }));
      if (refusesPreExistingRemoval(removedCheck)) { decline(file.path, 'fix would remove pre-existing comments'); continue; }

      const absPath = path.join(ctx.repoRoot, file.path);
      let diskText: string;
      try { diskText = readFileSync(absPath, 'utf8'); } catch { decline(file.path, 'file read error'); continue; }

      if (diskText !== file.text) { decline(file.path, 'file changed on disk since scan'); continue; }

      const origHash = sha256(diskText);
      const content = normalizeTrailingNewline(ar.fixed, diskText.endsWith('\n'));

      if (doWrite) {
        const wr = atomicWrite(absPath, content, origHash);
        if (!wr.ok) {
          process.stderr.write(`comment-density rule: ${wr.reason}\n`);
          decline(file.path, `write failed: ${wr.reason}`);
          continue;
        }

        const removed = ar.removedTexts;
        const n = removed.length;
        appendFix({
          file: absPath,
          fixedContent: content,
          removed,
          reason: `comment-density: autofix removed ${n} over-budget comment(s)`,
          source: 'housekeep',
        });
      }

      files.push({ path: file.path, status: 'fixed', before: diskText, after: content });
      fixed++;
    }

    return { fixed, skipped, files };
  },
};

export default rule;
