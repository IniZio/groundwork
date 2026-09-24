/**
 * Family: Comment-density enforcement on session-added lines only.
 * Trigger: Stop + SubagentStop.
 * Blocks when any touched file exceeds 5 effective comment lines per 100 added lines.
 */
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { autoFix, detectLanguage, density, isPluginFixture, netNewCommentRows, type Lang, type RowChange } from "./lib/comment-density.js";
import { sessionBase, touchedFiles, addedHunks } from "./lib/work-scope.js";

export interface HookResult { stdout: string; stderr: string; exit: number }

export type FixStability = "preview" | "stable";
export type FixApplicability = "safe" | "unsafe";
export interface FixEntry { stability: FixStability; applicability: FixApplicability }

export const LANG_FIX_TABLE: Record<Lang, FixEntry> = {
  bash: { stability: "preview", applicability: "safe" },
  yaml: { stability: "preview", applicability: "safe" },
  typescript: { stability: "preview", applicability: "safe" },
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

const CAP = 5;

function gitTopLevel(filePath: string): string | null {
  const dir = path.dirname(filePath);
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
  rowSet: Set<number>;
  netNewRows: Set<number>;
  lang: Lang;
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
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
    /** Test-only: bypass the LANG_FIX_TABLE and force the write path. Never read in production. */
    testOnly_forceWrite?: boolean;
    /** Test-only: merge these entries over LANG_FIX_TABLE for this call only. */
    testOnly_fixTableOverride?: Partial<Record<string, FixEntry>>;
    /** Test-only: override os.tmpdir() for the shadow log. */
    testOnly_tmpDir?: string;
    afterTmpWrite?: (tmp: string, target: string) => void;
    /** Test-only: override ar.fixed after autoFix. Never read in production. */
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

    const files = touchedFiles({
      event: event as "Stop" | "SubagentStop",
      transcriptPath,
      sessionId,
      agentTranscriptPath,
    });

    const violations: ViolatingFile[] = [];

    for (const file of files) {
      if (!existsSync(file)) continue;
      if (isPluginFixture(file)) continue;

      const lang = detectLanguage(file);
      if (!lang) continue;

      const topLevel = gitTopLevel(file);
      if (!topLevel) continue;

      const base = sessionBase(relevantTranscriptPath, topLevel);

      const hunks = addedHunks(file, base, relevantTranscriptPath);
      if (!hunks || hunks.length === 0) continue;

      const totalAdded = hunks.reduce((s, h) => s + h.added.length, 0);
      if (totalAdded === 0) continue;

      const rowSet = new Set(hunks.flatMap(h => h.added.map(n => n - 1)));

      let fileText: string;
      try { fileText = readFileSync(file, "utf8"); } catch { continue; }

      const relPath = path.relative(topLevel, file);
      const baseShowResult = spawnSync("git", ["-C", topLevel, "show", `${base}:${relPath}`], { encoding: "utf8" });
      const baseText = baseShowResult.status === 0 ? baseShowResult.stdout : "";

      const netResult = await netNewCommentRows(baseText, fileText, lang, hunks);
      let effective: number;
      let commentRows: number[];
      let netNewRows: Set<number>;
      let fallback = false;
      if (netResult.ok) {
        effective = netResult.rows.length;
        commentRows = netResult.rows;
        netNewRows = new Set(netResult.rows.map(n => n - 1));
      } else {
        const dr = await density(fileText, lang, rowSet);
        effective = dr.effective;
        commentRows = dr.commentRows.map(r => r + 1);
        netNewRows = rowSet;
        fallback = dr.mode === "fallback";
      }
      if (effective / totalAdded * 100 > CAP) {
        violations.push({
          path: file,
          effective,
          total: totalAdded,
          commentRows,
          fallback,
          rowSet,
          netNewRows,
          lang,
        });
      }
    }

    if (violations.length === 0) return allow();

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
        // shadow mode: log what autoFix would do
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

      // write path (stable+safe or testOnly_forceWrite)
      const trailNl = txt.endsWith("\n");
      // arFixedNormalized: what autoFix produced with trailing-newline parity
      let arFixedNormalized = ar.fixed;
      if (trailNl && !arFixedNormalized.endsWith("\n")) arFixedNormalized += "\n";
      else if (!trailNl && arFixedNormalized.endsWith("\n")) arFixedNormalized = arFixedNormalized.slice(0, -1);
      // content: may differ if testOnly_overrideFixed is active
      const arFixed = opts?.testOnly_overrideFixed?.(txt, ar.fixed, v.rowSet) ?? ar.fixed;
      let content = arFixed;
      if (trailNl && !content.endsWith("\n")) content += "\n";
      else if (!trailNl && content.endsWith("\n")) content = content.slice(0, -1);
      const origHash = sha256(txt);

      let wrote = false;
      try {
        const mode = statSync(v.path).mode & 0o7777;
        const tmp = v.path + `.cdg-${process.pid}`;
        writeFileSync(tmp, content);
        chmodSync(tmp, mode);
        opts?.afterTmpWrite?.(tmp, v.path);

        const tmpContent = readFileSync(tmp, "utf8");
        if (tmpContent !== arFixedNormalized) {
          try { unlinkSync(tmp); } catch {}
          unfixable.push(v);
          continue;
        }

        // sha256 staleness check: last, synchronous, immediately before renameSync
        let currentContent: string;
        try {
          currentContent = readFileSync(v.path, "utf8");
        } catch {
          try { unlinkSync(tmp); } catch {}
          unfixable.push(v);
          continue;
        }
        if (sha256(currentContent) !== origHash) {
          try { unlinkSync(tmp); } catch {}
          unfixable.push(v);
          continue;
        }

        renameSync(tmp, v.path);
        wrote = true;
      } catch (e) {
        process.stderr.write(`comment-density-gate: write failed ${v.path}: ${e}\n`);
      }

      if (!wrote) { unfixable.push(v); continue; }
      fixedFiles.push({ path: v.path, removed: ar.removed, kept: ar.kept, total: ar.total, addedCount: v.rowSet.size });
    }

    if (unfixable.length === 0) {
      if (fixedFiles.length === 0) return allow();
      const N = fixedFiles.reduce((s, f) => s + f.removed, 0);
      const fLines = fixedFiles.map(f =>
        `  ${f.path}: removed ${f.removed} (kept ${f.kept} of ${f.total} added comments; ${f.addedCount} added lines)`
      );
      const ctx = [
        `groundwork comment-density: auto-removed ${N} comment(s) that this session added beyond the code convention (at most 5 comment lines per 100 added lines).`,
        `This is groundwork's automatic correction — not another session's edit, a merge, or a bug.`,
        ...fLines,
        `These files changed on disk after your last Read: Read them again before editing. If your work was already committed, review \`git diff\` and commit the cleanup.`,
      ].join("\n");
      return {
        stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: ctx.slice(0, 8000) } }) + "\n",
        stderr: "",
        exit: 0,
      };
    }

    const tmpBase = path.join(os.tmpdir(), "groundwork-comment-density");
    try { mkdirSync(tmpBase, { recursive: true }); } catch { /* ok */ }

    const cPath = counterPath(tmpBase, sessionId, agentKey);
    const state = readCounter(cPath);
    const currentSig = unfixable.map(v => v.path).sort().join(";");

    let newCount: number;
    if (state.sig !== currentSig) {
      newCount = 1;
    } else {
      newCount = state.count + 1;
    }
    writeCounter(cPath, { sig: currentSig, count: newCount });

    if (newCount >= 4) {
      const fileList = unfixable.map(v => `  ${v.path}`).join("\n");
      const stderr = `groundwork comment-density gate: 4th consecutive block — allowing; remove or move comments before continuing\n${fileList}\n`;
      return { stdout: "", stderr, exit: 0 };
    }

    const header =
      "groundwork comment-density gate: files changed in this session exceed the code convention (at most 5 comment lines per 100 added lines).\n" +
      "This is a convention check — not a bug, a merge, or another session's edit.";

    const fileLines = unfixable.map(v => {
      const ratio = (v.effective / v.total * 100).toFixed(1);
      const first5 = v.commentRows.slice(0, 5).join(", ");
      return `  ${v.path}: ${ratio}/100 (${v.effective} comments in ${v.total} added lines; rows ${first5})`;
    });

    const fallbackNotices = unfixable
      .filter(v => v.fallback)
      .map(v => `(${v.path}: tree-sitter unavailable — prefix count used)`);

    const fixedNote = fixedFiles.length > 0
      ? `auto-fixed in this run: ${fixedFiles.map(f => f.path).join(", ")}`
      : null;

    const footerBase = "Remove comments that restate the code; keep only one-line \"why\" comments, until each file is at or under 5/100. Deleting or rewording a comment that predates the session is not an acceptable fix. Then stop again.";
    const footer = event === "SubagentStop"
      ? footerBase + " Edits made after hand-back do not reach the caller."
      : footerBase;

    const parts = [header, ...fileLines];
    if (fallbackNotices.length > 0) parts.push(...fallbackNotices);
    if (fixedNote) parts.push(fixedNote);
    parts.push(footer);

    const reason = parts.join("\n");
    return block(reason.length > 2000 ? reason.slice(0, 1990) + "…" : reason);
  } catch (e) {
    process.stderr.write(`comment-density-gate error: ${e}\n`);
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
