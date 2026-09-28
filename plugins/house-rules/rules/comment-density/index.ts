import type { Rule, RuleContext, Finding } from '../../src/engine/types.js';
import { commentDensityEditCheck } from './edit-check.js';
import { netNewCommentRows, density } from '../../src/hooks/lib/comment-density.js';
import { languageForPath, LANGUAGES } from '../../src/hooks/languages/registry.js';
import { commentDensityFix, canFixPathHelper } from './fix.js';
import { getParser } from '../../src/hooks/lib/tree-sitter-loader.js';
import { parserForPath } from '../../src/hooks/languages/parse.js';
import { formatRowList } from '../../src/engine/run.js';

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
    return canFixPathHelper(filePath);
  },

  async check(ctx: RuleContext): Promise<Finding[]> {
    const findings: Finding[] = [];
    for (const file of ctx.files ?? []) {
      if (!file.addedHunks || !file.text) continue;

      const lang = languageForPath(file.path);
      if (!lang) continue;

      const totalAdded = file.addedHunks.reduce((s, h) => s + h.added.length, 0);
      if (totalAdded === 0) continue;

      const sf = ctx.sourceFile ? await ctx.sourceFile(file) : null;
      if (sf && !sf.ok) continue;

      const baseText = file.baseText ?? '';
      const gp = parserForPath(getParser, file.path);

      let effective: number;
      let commentRows: number[]; // 1-based

      const netResult = await netNewCommentRows(baseText, file.text, lang, file.addedHunks, gp);
      if (netResult.ok) {
        effective = netResult.rows.length;
        commentRows = netResult.rows;
      } else {
        const rowSet = new Set(file.addedHunks.flatMap(h => h.added.map(n => n - 1)));
        const dr = await density(file.text, lang, rowSet, gp);
        if (!dr.ok) continue;
        effective = dr.effective;
        commentRows = dr.commentRows.map(r => r + 1);
      }

      if (effective / totalAdded * 100 > CAP) {
        const ratio = (effective / totalAdded * 100).toFixed(1);
        const commentWord = effective === 1 ? 'comment' : 'comments';
        const lineWord = totalAdded === 1 ? 'added line' : 'added lines';
        const message = `${ratio}/100 (${effective} ${commentWord} in ${totalAdded} ${lineWord}; rows ${formatRowList(commentRows)})`;
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

  fix: commentDensityFix,
};

export default rule;
