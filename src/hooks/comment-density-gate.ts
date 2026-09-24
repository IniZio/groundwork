/**
 * Family: Comment-density enforcement on session-added lines only.
 * Trigger: Stop + SubagentStop.
 * Blocks when any touched file exceeds 5 effective comment lines per 100 added lines.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { autoFix, detectLanguage, density, isPluginFixture, type Lang } from "./lib/comment-density.js";
import { sessionBase, touchedFiles, addedRanges } from "./lib/work-scope.js";

export interface HookResult { stdout: string; stderr: string; exit: number }

function allow(): HookResult { return { stdout: JSON.stringify({ continue: true }) + "\n", stderr: "", exit: 0 }; }
function silentAllow(): HookResult { return { stdout: "", stderr: "", exit: 0 }; }
function block(reason: string): HookResult {
  return { stdout: JSON.stringify({ decision: "block", reason }) + "\n", stderr: "", exit: 0 };
}

const CAP = 5;
const AUTO_FIX_ENABLED = false;

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
  lang: Lang;
}

export async function run(
  input: unknown,
  env: Record<string, string | undefined>,
  opts?: { autoFixEnabled?: boolean; afterTmpWrite?: (tmp: string, target: string) => void },
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

      const rowArr = addedRanges(file, base, relevantTranscriptPath);
      if (!rowArr || rowArr.length === 0) continue;

      // addedRanges returns 1-indexed; density uses 0-indexed rows internally
      const rowSet = new Set(rowArr.map(n => n - 1));

      let fileText: string;
      try { fileText = readFileSync(file, "utf8"); } catch { continue; }

      const result = await density(fileText, lang, rowSet);

      if (result.total > 0 && result.effective / result.total * 100 > CAP) {
        violations.push({
          path: file,
          effective: result.effective,
          total: result.total,
          commentRows: result.commentRows.map(r => r + 1),
          fallback: result.mode === "fallback",
          rowSet,
          lang,
        });
      }
    }

    if (violations.length === 0) return allow();

    interface FixResult { path: string; removed: number; kept: number; total: number; addedCount: number }
    const fixedFiles: FixResult[] = [];
    const unfixable: ViolatingFile[] = [];
    const autoFixEnabled = opts?.autoFixEnabled ?? AUTO_FIX_ENABLED;

    for (const v of violations) {
      if (!autoFixEnabled) { unfixable.push(v); continue; }
      if (v.fallback) { unfixable.push(v); continue; }
      let txt: string;
      let txtStat: import("node:fs").Stats;
      try {
        txtStat = statSync(v.path);
        txt = readFileSync(v.path, "utf8");
      } catch { unfixable.push(v); continue; }
      const ar = await autoFix(txt, v.lang, v.rowSet);
      if (!ar.ok || ar.removed === 0) { unfixable.push(v); continue; }
      const trailNl = txt.endsWith("\n");
      let content = ar.fixed;
      if (trailNl && !content.endsWith("\n")) content += "\n";
      else if (!trailNl && content.endsWith("\n")) content = content.slice(0, -1);
      let wrote = false;
      try {
        const mode = txtStat.mode & 0o7777;
        const tmp = v.path + `.cdg-${process.pid}`;
        writeFileSync(tmp, content, { encoding: "utf8" });
        chmodSync(tmp, mode);
        opts?.afterTmpWrite?.(tmp, v.path);
        try {
          const nowStat = statSync(v.path);
          if (nowStat.mtimeMs !== txtStat.mtimeMs || nowStat.size !== txtStat.size) {
            try { unlinkSync(tmp); } catch {}
            unfixable.push(v);
            continue;
          }
        } catch {
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

    const footer = "Remove comments that restate the code; keep only one-line \"why\" comments, until each file is at or under 5/100. Then stop again.";

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
