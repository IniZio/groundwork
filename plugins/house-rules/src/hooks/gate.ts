/**
 * Family: Comment-density enforcement on session-added lines only.
 * Trigger: Stop + SubagentStop.
 * Blocks when any touched file exceeds 5 effective comment lines per 100 added lines.
 */
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { autoFix, detectLanguage, density, netNewCommentRows, type Lang, type RowChange } from "./lib/comment-density.js";
import { atomicWrite, normalizeTrailingNewline, sha256 } from "./lib/atomic-write.js";
import { buildContext } from '../engine/context.js';
import { loadRules } from '../engine/registry.js';
import { runRules } from '../engine/run.js';
import { readBaseline, subtractBaseline } from '../engine/baseline.js';
import { BUILTIN_POLICY, DEFAULT_IGNORE } from '../engine/policy.js';
import { touchedFiles } from './lib/work-scope.js';
import { formatBlock, buildFull, formatShortReason, type RuleSummary } from './lib/block-format.js';


export interface HookResult { stdout: string; stderr: string; exit: number }

export type FixStability = "preview" | "stable";
export type FixApplicability = "safe" | "unsafe";
export interface FixEntry { stability: FixStability; applicability: FixApplicability }

export const LANG_FIX_TABLE: Record<Lang, FixEntry> = {
  bash: { stability: "preview", applicability: "safe" },
  yaml: { stability: "preview", applicability: "safe" },
  typescript: { stability: "stable", applicability: "safe" },
  tsx: { stability: "preview", applicability: "safe" },
  python: { stability: "preview", applicability: "safe" },
  dockerfile: { stability: "preview", applicability: "safe" },
  go: { stability: "preview", applicability: "safe" },
  rust: { stability: "preview", applicability: "safe" },
  sql: { stability: "preview", applicability: "safe" },
  make: { stability: "preview", applicability: "safe" },
  toml: { stability: "preview", applicability: "safe" },
};

function allow(): HookResult { return { stdout: JSON.stringify({ continue: true }) + "\n", stderr: "", exit: 0 }; }
function silentAllow(): HookResult { return { stdout: "", stderr: "", exit: 0 }; }
function block(reason: string): HookResult {
  return { stdout: JSON.stringify({ decision: "block", reason }) + "\n", stderr: "", exit: 0 };
}

function gitTopLevel(fileOrDir: string): string | null {
  const stat = (() => { try { return statSync(fileOrDir); } catch { return null; } })();
  const dir = (stat?.isDirectory() === true) ? fileOrDir : path.dirname(fileOrDir);
  const r = spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return r.stdout.trim();
}

interface CounterState { sig: string; count: number }

function counterPath(tmpBase: string, sessionId: string, agentKey: string): string {
  return path.join(tmpBase, `${sessionId}-${agentKey}.json`);
}

function readCounter(p: string): CounterState {
  try { return JSON.parse(readFileSync(p, "utf8")) as CounterState; } catch { return { sig: "", count: 0 }; }
}

function writeCounter(p: string, state: CounterState): void {
  try { writeFileSync(p, JSON.stringify(state)); } catch { /* fail-open */ }
}

interface ViolatingFile {
  path: string;
  effective: number;
  total: number;
  commentRows: number[];
  fallback: boolean;
  firstErrorRow?: number;
  rowSet: Set<number>;
  netNewRows: Set<number>;
  lang: Lang;
}


interface ShadowLogRecord {
  file: string;
  lang: string;
  removedLines: Array<{ lineNum: number; text: string; preExisting: boolean; kind: "deleted" | "modified"; fixedText?: string }>;
  densityBefore: number;
  densityAfter: number;
}

function writeShadowLog(tmpBase: string, sessionId: string, record: ShadowLogRecord): void {
  try {
    const dir = path.join(tmpBase, "groundwork-autofix-shadow");
    mkdirSync(dir, { recursive: true });
    appendFileSync(path.join(dir, `${sessionId}.jsonl`), JSON.stringify(record) + "\n");
  } catch { /* fail-open */ }
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

// Unreachable while autoFix's all-rows-added candidate filter holds (comment-density.ts:697); the autoFix property test enforces it.
export function refusesPreExistingRemoval(removedLines: Array<{ preExisting: boolean }>): boolean {
  return removedLines.some(r => r.preExisting);
}

export async function run(
  input: unknown,
  env: Record<string, string | undefined>,
  opts?: {
    testOnly_forceWrite?: boolean;
    testOnly_fixTableOverride?: Partial<Record<string, FixEntry>>;
    testOnly_tmpDir?: string;
    afterTmpWrite?: (tmp: string, target: string) => void;
    testOnly_overrideFixed?: (txt: string, fixed: string, rowSet: Set<number>) => string;
  },
): Promise<HookResult> {
  try {
    if (env.CLAUDE_CODE_ENTRYPOINT === "sdk-py" || env.CLAUDE_CODE_ENTRYPOINT === "sdk-js") return silentAllow();

    const inp = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;

    const event = typeof inp.hook_event_name === "string" ? inp.hook_event_name
      : typeof inp.event === "string" ? inp.event : "";
    if (event !== "Stop" && event !== "SubagentStop") return silentAllow();

    const transcriptPath = typeof inp.transcript_path === "string" ? inp.transcript_path : null;
    if (!transcriptPath) return silentAllow();

    const sessionId = typeof inp.session_id === "string" ? inp.session_id : "unknown";
    const agentId = typeof inp.agent_id === "string" ? inp.agent_id : null;
    const agentTranscriptPath = typeof inp.agent_transcript_path === "string" ? inp.agent_transcript_path : undefined;

    const agentKey = event === "SubagentStop" && agentId ? agentId : "main";
    const relevantTranscriptPath = event === "SubagentStop"
      ? (agentTranscriptPath ?? transcriptPath)
      : transcriptPath;

    const cwdRaw = typeof inp.cwd === "string" ? inp.cwd : null;
    const tpDir = path.dirname(transcriptPath);
    let repoRoot: string | null =
      (cwdRaw ? gitTopLevel(cwdRaw) : null) ??
      gitTopLevel(tpDir);

    if (!repoRoot) {
      const tf = touchedFiles({
        event: event as 'Stop' | 'SubagentStop',
        transcriptPath: relevantTranscriptPath,
        sessionId,
        agentTranscriptPath,
      });
      for (const f of tf) {
        const r = gitTopLevel(f);
        if (r) { repoRoot = r; break; }
      }
    }
    if (!repoRoot) return silentAllow();

    const rulesDir = path.resolve(import.meta.dir, '../../rules');
    const rules = await loadRules(rulesDir);
    const ctx = buildContext({
      repoRoot,
      mode: 'gate',
      transcriptPath: relevantTranscriptPath,
      sessionId,
      event: event as 'Stop' | 'SubagentStop',
    });

    const allFindings = await runRules(rules, ctx, BUILTIN_POLICY, DEFAULT_IGNORE);
    const baselinePath = path.join(repoRoot, '.house-rules', 'baseline.json');
    const baseline = await readBaseline(baselinePath);
    const unbaselined = subtractBaseline(allFindings, baseline);

    const densityErrors = unbaselined.filter(f => f.ruleId === 'comment-density' && f.severity === 'error');
    const strayErrors = unbaselined.filter(f => f.ruleId === 'stray-artifacts' && f.severity === 'error');

    const fileByRelPath = new Map((ctx.files ?? []).map(f => [f.path, f]));

    const violations: ViolatingFile[] = [];

    for (const finding of densityErrors) {
      const sf = fileByRelPath.get(finding.path);
      if (!sf || !sf.text || !sf.addedHunks || sf.addedHunks.length === 0) continue;

      const lang = detectLanguage(finding.path) as Lang | null;
      if (!lang) continue;

      const totalAdded = sf.addedHunks.reduce((s, h) => s + h.added.length, 0);
      if (totalAdded === 0) continue;

      const rowSet = new Set(sf.addedHunks.flatMap(h => h.added.map(n => n - 1)));

      const baseText = sf.baseText ?? '';
      const netResult = await netNewCommentRows(baseText, sf.text, lang, sf.addedHunks);
      let effective: number;
      let commentRows: number[];
      let netNewRows: Set<number>;
      let fallback = false;
      let firstErrorRow: number | undefined;
      if (netResult.ok) {
        effective = netResult.rows.length;
        commentRows = netResult.rows;
        netNewRows = new Set(netResult.rows.map(n => n - 1));
      } else {
        const dr = await density(sf.text, lang, rowSet);
        effective = dr.effective;
        commentRows = dr.commentRows.map(r => r + 1);
        netNewRows = rowSet;
        fallback = dr.mode === 'fallback';
        if (fallback && dr.errorRows.size > 0) {
          firstErrorRow = Math.min(...dr.errorRows) + 1;
        }
      }

      violations.push({
        path: path.join(repoRoot, finding.path),
        effective,
        total: totalAdded,
        commentRows,
        fallback,
        firstErrorRow,
        rowSet,
        netNewRows,
        lang,
      });
    }

    if (violations.length === 0 && strayErrors.length === 0) return allow();

    interface FixResult { path: string; removed: number; kept: number; total: number; addedCount: number }
    const fixedFiles: FixResult[] = [];
    const unfixable: ViolatingFile[] = [];

    for (const v of violations) {
      const tableEntry = LANG_FIX_TABLE[v.lang];
      const override = opts?.testOnly_fixTableOverride?.[v.lang];
      const entry: FixEntry = override ? { ...tableEntry, ...override } : tableEntry;
      const shouldWrite = opts?.testOnly_forceWrite === true || (entry.stability === "stable" && entry.applicability === "safe");

      if (v.fallback) { unfixable.push(v); continue; }

      let txt: string;
      try {
        txt = readFileSync(v.path, "utf8");
      } catch { unfixable.push(v); continue; }

      const ar = await autoFix(txt, v.lang, v.rowSet, undefined, v.netNewRows);
      if (!ar.ok || ar.removed === 0) { unfixable.push(v); continue; }

      const removedLines = buildRemovedLines(ar.rowChanges, v.rowSet);

      if (!shouldWrite) {
        const densityBefore = v.effective / v.total * 100;
        const remappedAfter = buildRemappedRows(ar.rowChanges, v.rowSet);
        const d2 = await density(ar.fixed, v.lang, remappedAfter);
        const densityAfter = d2.total > 0 ? d2.effective / d2.total * 100 : 0;
        const tmpBase = opts?.testOnly_tmpDir ?? os.tmpdir();
        writeShadowLog(tmpBase, sessionId, { file: v.path, lang: v.lang, removedLines, densityBefore, densityAfter });
        unfixable.push(v);
        continue;
      }

      if (refusesPreExistingRemoval(removedLines)) {
        unfixable.push(v);
        continue;
      }

      const trailNl = txt.endsWith("\n");
      const arFixedNormalized = normalizeTrailingNewline(ar.fixed, trailNl);
      const arFixed = opts?.testOnly_overrideFixed?.(txt, ar.fixed, v.rowSet) ?? ar.fixed;
      const content = normalizeTrailingNewline(arFixed, trailNl);
      const origHash = sha256(txt);

      const wr = atomicWrite(v.path, content, origHash, {
        afterTmpWrite: opts?.afterTmpWrite,
        verifyContent: arFixedNormalized,
      });
      if (!wr.ok) {
        process.stderr.write(`gate: ${wr.reason}\n`);
        unfixable.push(v);
        continue;
      }
      fixedFiles.push({ path: v.path, removed: ar.removed, kept: ar.kept, total: ar.total, addedCount: v.rowSet.size });
    }

    if (unfixable.length === 0 && strayErrors.length === 0) {
      if (fixedFiles.length === 0) return allow();
      const N = fixedFiles.reduce((s, f) => s + f.removed, 0);
      const fLines = fixedFiles.map(f =>
        `  ${f.path}: removed ${f.removed} (kept ${f.kept} of ${f.total} added comments; ${f.addedCount} added lines)`
      );
      const ctx2 = [
        `house-rules comment-density: auto-removed ${N} comment(s) that this session added beyond the code convention (at most 5 comment lines per 100 added lines).`,
        `This is house-rules automatic correction — not another session's edit, a merge, or a bug.`,
        ...fLines,
        `These files changed on disk after your last Read: Read them again before editing. If your work was already committed, review \`git diff\` and commit the cleanup.`,
      ].join("\n");
      return {
        stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: ctx2.slice(0, 8000) } }) + "\n",
        stderr: "",
        exit: 0,
      };
    }

    const tmpBase = path.join(os.tmpdir(), "house-rules-comment-density");
    try { mkdirSync(tmpBase, { recursive: true }); } catch { /* ok */ }

    const cPath = counterPath(tmpBase, sessionId, agentKey);
    const state = readCounter(cPath);
    const currentSig = [
      ...unfixable.map(v => v.path),
      ...strayErrors.map(f => path.join(repoRoot, f.path)),
    ].sort().join(";");

    let newCount: number;
    if (state.sig !== currentSig) {
      newCount = 1;
    } else {
      newCount = state.count + 1;
    }
    writeCounter(cPath, { sig: currentSig, count: newCount });

    if (newCount >= 4) {
      const ruleNames = [
        ...(unfixable.length > 0 ? ["comment-density"] : []),
        ...(strayErrors.length > 0 ? ["stray-artifacts"] : []),
      ].join(" + ");
      const action4 = unfixable.length > 0 && strayErrors.length === 0
        ? "remove or move comments before continuing"
        : strayErrors.length > 0 && unfixable.length === 0
          ? "merge or delete stray files before continuing"
          : "remove or move comments and merge or delete stray files before continuing";
      const fileList = [
        ...unfixable.map(v => `  ${v.path}`),
        ...strayErrors.map(f => `  ${path.join(repoRoot, f.path)}`),
      ].join("\n");
      const stderr = `house-rules ${ruleNames} gate: 4th consecutive block — allowing; ${action4}\n${fileList}\n`;
      return { stdout: "", stderr, exit: 0 };
    }

    const hasDensity = unfixable.length > 0;
    const hasStray = strayErrors.length > 0;
    const isSubagent = event === "SubagentStop";
    const handback = " Edits made after hand-back do not reach the caller.";

    const fileLines = unfixable.map(v => {
      const ratio = (v.effective / v.total * 100).toFixed(1);
      const first5 = v.commentRows.slice(0, 5).join(", ");
      return `  ${v.path}: ${ratio}/100 (${v.effective} comments in ${v.total} added lines; rows ${first5})`;
    });

    const strayLines = strayErrors.map(f => `  ${path.join(repoRoot, f.path)}: ${f.message}`);

    const fallbackNotices = unfixable
      .filter(v => v.fallback)
      .map(v => {
        const loc = v.firstErrorRow !== undefined ? `:${v.firstErrorRow}` : '';
        return `(${v.path}${loc}: parse error — prefix count used)`;
      });

    const DHEADER =
      "house-rules comment-density gate: files changed in this session exceed the code convention (at most 5 comment lines per 100 added lines).\n" +
      "This is a convention check — not a bug, a merge, or another session's edit.";
    const DFOOTERBASE = "Remove comments that restate the code; keep only one-line \"why\" comments, until each file is at or under 5/100. Deleting or rewording a comment that predates the session is not an acceptable fix. Then stop again.";
    const DFOOTER_DENSITY_BOTH = DFOOTERBASE.slice(0, -" Then stop again.".length);
    const SFOOTERBASE = "Merge the coexisting directories or move/delete the scratch file. Then stop again.";
    const sfx = isSubagent ? handback : null;
    const fixedPaths = fixedFiles.map(f => f.path);

    // Build the rule summary for the short reason
    const ruleSummaries: RuleSummary[] = [];
    if (hasDensity) ruleSummaries.push({ name: "comment-density", paths: unfixable.map(v => v.path) });
    if (hasStray) ruleSummaries.push({ name: "stray-artifacts", paths: strayErrors.map(f => path.join(repoRoot, f.path)) });

    // Build the full untrimmed report
    const sects = (() => {
      if (hasDensity && !hasStray) {
        return [{ lines: fileLines, footer: DFOOTERBASE + (sfx ?? "") }];
      } else if (hasStray && !hasDensity) {
        return [{ lines: strayLines, footer: SFOOTERBASE + (sfx ?? "") }];
      } else {
        return [
          { label: "comment-density:", lines: fileLines, footer: DFOOTER_DENSITY_BOTH },
          { label: "stray-artifacts:", lines: strayLines, footer: SFOOTERBASE + (sfx ?? "") },
        ];
      }
    })();
    const reportHeader = hasDensity && !hasStray ? DHEADER
      : hasStray && !hasDensity ? "house-rules gate:"
      : "house-rules gate: files changed in this session violate one or more code conventions.";
    const fullReport = buildFull(reportHeader, sects, fallbackNotices, fixedPaths);

    const tmpBase2 = opts?.testOnly_tmpDir ?? os.tmpdir();
    const safeSessionId = /^[A-Za-z0-9_-]+$/.test(sessionId) ? sessionId : "unknown";
    const blockFilePath = path.join(tmpBase2, "house-rules", safeSessionId, "stop-block.txt");
    let writeOk = false;
    try {
      mkdirSync(path.dirname(blockFilePath), { recursive: true });
      writeFileSync(blockFilePath, fullReport + "\n");
      writeOk = true;
    } catch { }

    let reason: string;
    if (writeOk) {
      reason = formatShortReason(ruleSummaries, blockFilePath, sfx);
    } else {
      if (hasDensity && !hasStray) {
        reason = formatBlock({
          header: DHEADER,
          sections: [{ lines: fileLines, footer: DFOOTERBASE }],
          notices: fallbackNotices,
          fixedFiles: fixedPaths,
          suffix: sfx,
        });
      } else if (hasStray && !hasDensity) {
        reason = formatBlock({
          header: "house-rules gate:",
          sections: [{ lines: strayLines, footer: SFOOTERBASE }],
          notices: [],
          fixedFiles: fixedPaths,
          suffix: sfx,
        });
      } else {
        reason = formatBlock({
          header: "house-rules gate: files changed in this session violate one or more code conventions.",
          sections: [
            { label: "comment-density:", lines: fileLines, footer: DFOOTER_DENSITY_BOTH },
            { label: "stray-artifacts:", lines: strayLines, footer: SFOOTERBASE },
          ],
          notices: fallbackNotices,
          fixedFiles: fixedPaths,
          suffix: sfx,
        });
      }
    }
    return block(reason);
  } catch (e) {
    process.stderr.write(`gate error: ${e}\n`);
    return silentAllow();
  }
}

if (import.meta.main) {
  const raw = await Bun.stdin.text();
  let input: unknown = {};
  try { input = JSON.parse(raw); } catch { /* fail-open */ }
  const result = await run(input, process.env as Record<string, string | undefined>);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.exit);
}
