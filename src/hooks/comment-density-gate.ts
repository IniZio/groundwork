/**
 * Family: Comment-density enforcement on session-added lines only.
 * Trigger: Stop + SubagentStop.
 * Blocks when any touched file exceeds 5 effective comment lines per 100 added lines.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { detectLanguage, density, isPluginFixture } from "./lib/comment-density.js";
import { sessionBase, touchedFiles, addedRanges } from "./lib/work-scope.js";

export interface HookResult { stdout: string; stderr: string; exit: number }

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
}

export async function run(input: unknown, env: Record<string, string | undefined>): Promise<HookResult> {
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

      const rowArr = addedRanges(file, base);
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
          // convert back to 1-indexed for display
          commentRows: result.commentRows.map(r => r + 1),
          fallback: result.mode === "fallback",
        });
      }
    }

    if (violations.length === 0) return allow();

    const tmpBase = path.join(os.tmpdir(), "groundwork-comment-density");
    try { mkdirSync(tmpBase, { recursive: true }); } catch { /* ok */ }

    const cPath = counterPath(tmpBase, sessionId, agentKey);
    const state = readCounter(cPath);
    const currentSig = violations.map(v => v.path).sort().join(";");

    let newCount: number;
    if (state.sig !== currentSig) {
      newCount = 1;
    } else {
      newCount = state.count + 1;
    }
    writeCounter(cPath, { sig: currentSig, count: newCount });

    if (newCount >= 4) {
      const fileList = violations.map(v => `  ${v.path}`).join("\n");
      const stderr = `groundwork comment-density gate: 4th consecutive block — allowing; remove or move comments before continuing\n${fileList}\n`;
      return { stdout: "", stderr, exit: 0 };
    }

    const header =
      "groundwork comment-density gate: files changed in this session exceed the code convention (at most 5 comment lines per 100 added lines).\n" +
      "This is a convention check — not a bug, a merge, or another session's edit.";

    const fileLines = violations.map(v => {
      const ratio = (v.effective / v.total * 100).toFixed(1);
      const first5 = v.commentRows.slice(0, 5).join(", ");
      return `  ${v.path}: ${ratio}/100 (${v.effective} comments in ${v.total} added lines; rows ${first5})`;
    });

    const fallbackNotices = violations
      .filter(v => v.fallback)
      .map(v => `(${v.path}: tree-sitter unavailable — prefix count used)`);

    const footer = "Remove comments that restate the code; keep only one-line \"why\" comments, until each file is at or under 5/100. Then stop again.";

    const parts = [header, ...fileLines];
    if (fallbackNotices.length > 0) parts.push(...fallbackNotices);
    parts.push(footer);

    return block(parts.join("\n"));
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
