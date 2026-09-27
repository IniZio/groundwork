/**
 * comment-density rule — fix implementation.
 *
 * Exported so index.ts is thin and gate.ts calls via rule.fix().
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RuleContext, FixResult, FixFileResult, FixOptions } from '../../src/engine/types.js';
import type { FixEntry } from './languages.js';
import { fixEntryFor } from './languages.js';
import { languageForPath } from '../../src/hooks/languages/registry.js';
import { autoFix, density, netNewCommentRows, type RowChange } from '../../src/hooks/lib/comment-density.js';
import { atomicWrite, normalizeTrailingNewline, sha256 } from '../../src/hooks/lib/atomic-write.js';
import { appendFix } from '../../src/hooks/lib/autofix-ledger.js';

// Unreachable while autoFix's all-rows-added candidate filter holds (comment-density.ts:697); the autoFix property test enforces it.
export function refusesPreExistingRemoval(removedLines: Array<{ preExisting: boolean }>): boolean {
  return removedLines.some(r => r.preExisting);
}

function buildRemovedLines(
  rowChanges: RowChange[],
  rowSet: Set<number>,
): Array<{ lineNum: number; text: string; preExisting: boolean; kind: "deleted" | "modified"; fixedText?: string }> {
  return rowChanges.map(rc => ({
    lineNum: rc.origRow + 1,
    text: rc.origText,
    preExisting: !rowSet.has(rc.origRow),
    kind: rc.kind,
    fixedText: rc.fixedText,
  }));
}

function buildRemappedRows(rowChanges: RowChange[], origRowSet: Set<number>): Set<number> {
  const deletedRows = new Set(rowChanges.filter(rc => rc.kind === "deleted").map(rc => rc.origRow));
  const remapped = new Set<number>();
  for (const origRow of origRowSet) {
    if (deletedRows.has(origRow)) continue;
    let shift = 0;
    for (const dr of deletedRows) {
      if (dr < origRow) shift++;
    }
    remapped.add(origRow - shift);
  }
  return remapped;
}

/** Shared canFixPath logic — stable + safe entries only. */
export function canFixPathHelper(filePath: string): boolean {
  const lang = languageForPath(filePath);
  if (!lang) return false;
  const entry = fixEntryFor(lang);
  return entry.stability === 'stable' && entry.applicability === 'safe';
}

export async function commentDensityFix(ctx: RuleContext, opts?: FixOptions): Promise<FixResult> {
  if (opts?.caller?.source === 'gate') {
    return gateFix(ctx, opts);
  }
  return housekeepFix(ctx, opts);
}

async function housekeepFix(ctx: RuleContext, opts?: FixOptions): Promise<FixResult> {
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

    const sfHK = ctx.sourceFile ? await ctx.sourceFile(file) : null;
    if (sfHK && !sfHK.ok) continue;

    if (!canFixPathHelper(file.path)) {
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
}

async function gateFix(ctx: RuleContext, opts: FixOptions): Promise<FixResult> {
  let fixed = 0;
  let skipped = 0;
  const files: FixFileResult[] = [];
  const caller = opts.caller!;
  const sessionId = caller.sessionId ?? 'unknown';
  const event = caller.event;

  for (const file of ctx.files ?? []) {
    if (!file.text || !file.addedHunks || file.addedHunks.length === 0) continue;

    const lang = languageForPath(file.path);
    if (!lang) continue;

    const sfGF = ctx.sourceFile ? await ctx.sourceFile(file) : null;
    if (sfGF && !sfGF.ok) continue;

    const totalAdded = file.addedHunks.reduce((s, h) => s + h.added.length, 0);
    if (totalAdded === 0) continue;

    const rowSet = new Set(file.addedHunks.flatMap(h => h.added.map(n => n - 1)));
    const baseText = file.baseText ?? '';

    const absPath = path.join(ctx.repoRoot, file.path);

    const tableEntry = fixEntryFor(lang);
    const override = (opts.testOnly?.testOnly_fixTableOverride as Partial<Record<string, FixEntry>> | undefined)?.[lang];
    const entry: FixEntry = override ? { ...tableEntry, ...override } : tableEntry;
    const stability = entry.stability;
    const applicability = entry.applicability;
    const shouldWrite = (opts.testOnly?.testOnly_forceWrite as boolean | undefined) === true || (stability === 'stable' && applicability === 'safe');

    const netResult = await netNewCommentRows(baseText, file.text, lang, file.addedHunks);
    let effective: number;
    let netNewRows: Set<number>;
    if (netResult.ok) {
      effective = netResult.rows.length;
      netNewRows = new Set(netResult.rows.map(n => n - 1));
    } else {
      const dr = await density(file.text, lang, rowSet);
      if (!dr.ok) {
        files.push({ path: file.path, status: 'declined', reason: `grammar did not load: ${dr.reason}`, stability, applicability });
        skipped++;
        continue;
      }
      effective = dr.effective;
      netNewRows = rowSet;
    }

    let txt: string;
    try {
      txt = readFileSync(absPath, 'utf8');
    } catch {
      files.push({ path: file.path, status: 'declined', reason: 'file read error', stability, applicability });
      skipped++;
      continue;
    }

    const ar = await autoFix(txt, lang, rowSet, undefined, netNewRows);
    if (!ar.ok) {
      files.push({ path: file.path, status: 'declined', reason: `autofix failed: ${ar.reason}`, stability, applicability });
      skipped++;
      continue;
    }
    if (ar.removed === 0) {
      files.push({ path: file.path, status: 'declined', reason: 'no removable comments', stability, applicability });
      skipped++;
      continue;
    }

    const removedLines = buildRemovedLines(ar.rowChanges, rowSet);

    if (!shouldWrite) {
      const densityBefore = effective / totalAdded * 100;
      const remappedAfter = buildRemappedRows(ar.rowChanges, rowSet);
      const d2 = await density(ar.fixed, lang, remappedAfter);
      const densityAfter = d2.ok && d2.total > 0 ? d2.effective / d2.total * 100 : 0;
      const shadowBase = caller.shadowDir ?? os.tmpdir();
      try {
        const dir = path.join(shadowBase, 'groundwork-autofix-shadow');
        mkdirSync(dir, { recursive: true });
        appendFileSync(path.join(dir, `${sessionId}.jsonl`), JSON.stringify({ file: absPath, lang, removedLines, densityBefore, densityAfter }) + '\n');
      } catch { /* fail-open */ }
      const notWrittenReason = stability !== 'stable'
        ? `preview language (${lang})`
        : `unsafe fix (${lang})`;
      files.push({ path: file.path, status: 'declined', reason: notWrittenReason, stability, applicability });
      skipped++;
      continue;
    }

    if (refusesPreExistingRemoval(removedLines)) {
      files.push({ path: file.path, status: 'declined', reason: 'fix would remove pre-existing comments', stability, applicability });
      skipped++;
      continue;
    }

    const trailNl = txt.endsWith('\n');
    const verifyContent = normalizeTrailingNewline(ar.fixed, trailNl);
    const overrideFixed = opts.testOnly?.testOnly_overrideFixed as ((txt: string, fixed: string, rowSet: Set<number>) => string) | undefined;
    const arFixed = overrideFixed?.(txt, ar.fixed, rowSet) ?? ar.fixed;
    const content = normalizeTrailingNewline(arFixed, trailNl);

    const wr = atomicWrite(absPath, content, sha256(txt), {
      afterTmpWrite: opts.testOnly?.afterTmpWrite as ((tmp: string, target: string) => void) | undefined,
      verifyContent,
    });
    if (!wr.ok) {
      process.stderr.write(`gate: ${wr.reason}\n`);
      files.push({ path: file.path, status: 'declined', reason: `write failed: ${wr.reason}`, stability, applicability });
      skipped++;
      continue;
    }

    appendFix({
      file: absPath,
      fixedContent: content,
      removed: ar.removedTexts,
      reason: `comment-density over budget at ${event}: removed ${ar.removed} comment(s)`,
      source: 'gate',
    }, caller.ledgerDir ? { dir: caller.ledgerDir } : undefined);

    files.push({
      path: file.path,
      status: 'fixed',
      before: txt,
      after: content,
      removed: ar.removed,
      kept: ar.kept,
      total: ar.total,
      addedLines: rowSet.size,
      stability,
      applicability,
    });
    fixed++;
  }

  return { fixed, skipped, files };
}
