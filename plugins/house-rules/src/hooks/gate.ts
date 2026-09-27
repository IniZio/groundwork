/**
 * Generic autofix gate: Stop/SubagentStop hook.
 * Autofixes findings where the rule has `fix` and policy.autofix is true.
 * Blocks when unfixed errors remain.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildContext } from '../engine/context.js';
import { loadRules } from '../engine/registry.js';
import { runRules, coverageReport, formatCoverage, grammarWarnings, type FindingWithSeverity } from '../engine/run.js';
import type { ParserFactory } from '../hooks/languages/parse.js';
import { readBaseline, subtractBaseline } from '../engine/baseline.js';
import { BUILTIN_POLICY, DEFAULT_IGNORE, type PolicyEntry } from '../engine/policy.js';
import { touchedFiles, runningAgentIds } from './lib/work-scope.js';
import { formatBlock, buildFull, formatShortReason, type RuleSummary } from './lib/block-format.js';
import type { Rule, ScopedFile } from '../engine/types.js';


export interface HookResult { stdout: string; stderr: string; exit: number }

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

interface FixedFile { path: string; removed: number; kept: number; total: number; addedCount: number }
interface UnfixableEntry { path: string; ruleId: string; message: string; reason?: string; notice?: string }

export async function run(
  input: unknown,
  env: Record<string, string | undefined>,
  opts?: {
    testOnly_tmpDir?: string;
    testOnly_rules?: Rule[];
    testOnly_policy?: Record<string, PolicyEntry>;
    testOnly_parserFactory?: ParserFactory;
    [testHook: string]: unknown;
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
    const running = event === "Stop" ? runningAgentIds(inp.background_tasks) : [];
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
        runningAgentIds: running,
      });
      for (const f of tf) {
        const r = gitTopLevel(f);
        if (r) { repoRoot = r; break; }
      }
    }
    if (!repoRoot) return silentAllow();

    const rulesDir = path.resolve(import.meta.dir, '../../rules');
    const rules = opts?.testOnly_rules ?? await loadRules(rulesDir);
    const policy: Record<string, PolicyEntry> = { ...BUILTIN_POLICY, ...(opts?.testOnly_policy ?? {}) };
    const ctx = buildContext({
      repoRoot,
      mode: 'gate',
      transcriptPath: relevantTranscriptPath,
      sessionId,
      event: event as 'Stop' | 'SubagentStop',
      runningAgentIds: running,
      parserFactory: opts?.testOnly_parserFactory,
    });

    const allFindings = await runRules(rules, ctx, policy, DEFAULT_IGNORE);
    const repoRootPrefix = repoRoot + path.sep;
    const inRepo = (p: string) => p === repoRoot || p.startsWith(repoRootPrefix);
    const cov = await coverageReport(rules, ctx);
    const absCov = {
      notChecked: cov.notChecked.map(p => path.resolve(repoRoot, p)).filter(inRepo),
      partiallyChecked: cov.partiallyChecked
        .map(e => ({ ...e, path: path.resolve(repoRoot, e.path) }))
        .filter(e => inRepo(e.path)),
      failed: cov.failed
        .map(e => ({ ...e, path: path.resolve(repoRoot, e.path) }))
        .filter(e => inRepo(e.path)),
    };
    const coverageText = formatCoverage(absCov, "house-rules coverage:", "  ").join("\n");
    const warnings = grammarWarnings(absCov);
    const baselinePath = path.join(repoRoot, '.house-rules', 'baseline.json');
    const baseline = await readBaseline(baselinePath);
    const unbaselined = subtractBaseline(allFindings, baseline);

    const fixableFindings = unbaselined.filter(f =>
      f.severity === 'error' &&
      rules.find(r => r.id === f.ruleId)?.fix != null &&
      policy[f.ruleId]?.autofix === true
    );
    const strayErrors = unbaselined.filter(f => f.ruleId === 'stray-artifacts' && f.severity === 'error');

    if (fixableFindings.length === 0 && strayErrors.length === 0) {
      if (warnings.length > 0) {
        return { stdout: JSON.stringify({ continue: true, systemMessage: warnings.join("\n") }) + "\n", stderr: "", exit: 0 };
      }
      return allow();
    }

    const fileByRelPath = new Map((ctx.files ?? []).map(f => [f.path, f]));
    const fixableFindingMap = new Map<string, FindingWithSeverity>();
    for (const f of fixableFindings) {
      fixableFindingMap.set(`${f.ruleId}::${f.path}`, f);
    }

    // Every opts key the gate does not consume is a rule's test hook; forward it unread.
    const { testOnly_tmpDir, testOnly_rules, testOnly_policy, testOnly_parserFactory, ...testOnly } = opts ?? {};
    const testOnlyArg = Object.keys(testOnly).length > 0
      ? testOnly as Record<string, unknown>
      : undefined;

    const fixedFiles: FixedFile[] = [];
    const unfixable: UnfixableEntry[] = [];

    for (const rule of rules) {
      if (!rule.fix) continue;
      const ruleFindings = fixableFindings.filter(f => f.ruleId === rule.id);
      if (ruleFindings.length === 0) continue;

      const seenPaths = new Set<string>();
      const fixFiles: ScopedFile[] = [];
      for (const finding of ruleFindings) {
        if (!seenPaths.has(finding.path)) {
          seenPaths.add(finding.path);
          const sf = fileByRelPath.get(finding.path);
          if (sf) fixFiles.push(sf);
        }
      }

      const result = await rule.fix!(
        { ...ctx, files: fixFiles },
        {
          caller: {
            source: 'gate',
            sessionId,
            event: event as 'Stop' | 'SubagentStop',
            ledgerDir: opts?.testOnly_tmpDir
              ? path.join(opts.testOnly_tmpDir, 'autofix-ledger')
              : undefined,
            shadowDir: opts?.testOnly_tmpDir ?? os.tmpdir(),
          },
          testOnly: testOnlyArg,
        },
      );

      for (const r of result.files) {
        const abs = path.join(repoRoot, r.path);
        const finding = fixableFindingMap.get(`${rule.id}::${r.path}`);
        if (r.status === 'fixed') {
          fixedFiles.push({
            path: abs,
            removed: r.removed ?? 0,
            kept: r.kept ?? 0,
            total: r.total ?? 0,
            addedCount: r.addedLines ?? 0,
          });
        } else {
          unfixable.push({
            path: abs,
            ruleId: rule.id,
            message: finding?.message ?? '',
            reason: r.reason,
            notice: r.notice,
          });
        }
      }
    }

    if (unfixable.length === 0 && strayErrors.length === 0) {
      if (fixedFiles.length === 0) {
        if (warnings.length > 0) {
          return { stdout: JSON.stringify({ continue: true, systemMessage: warnings.join("\n") }) + "\n", stderr: "", exit: 0 };
        }
        return allow();
      }
      const N = fixedFiles.reduce((s, f) => s + f.removed, 0);
      const fLines = fixedFiles.map(f =>
        `  ${f.path}: removed ${f.removed} (kept ${f.kept} of ${f.total} added comments; ${f.addedCount} added lines)`
      );
      const ctx2Lines = [
        `house-rules comment-density: auto-removed ${N} comment(s) that this session added beyond the code convention (at most 5 comment lines per 100 added lines).`,
        `This is house-rules automatic correction — not another session's edit, a merge, or a bug.`,
        ...fLines,
        `These files changed on disk after your last Read: Read them again before editing. If your work was already committed, review \`git diff\` and commit the cleanup.`,
      ];
      const ctx2 = ctx2Lines.join("\n");
      const autofixOut: Record<string, unknown> = { hookSpecificOutput: { hookEventName: event, additionalContext: ctx2.slice(0, 8000) } };
      if (warnings.length > 0) autofixOut.systemMessage = warnings.join("\n");
      return {
        stdout: JSON.stringify(autofixOut) + "\n",
        stderr: "",
        exit: 0,
      };
    }

    const tmpBase = path.join(os.tmpdir(), "house-rules-comment-density");
    try { mkdirSync(tmpBase, { recursive: true }); } catch { /* ok */ }

    const cPath = counterPath(tmpBase, sessionId, agentKey);
    const state = readCounter(cPath);
    const currentSig = [
      ...unfixable.map(u => u.path),
      ...strayErrors.map(f => path.join(repoRoot, f.path)),
    ].sort().join(";");

    let newCount: number;
    if (state.sig !== currentSig) {
      newCount = 1;
    } else {
      newCount = state.count + 1;
    }
    writeCounter(cPath, { sig: currentSig, count: newCount });

    const ruleNamesFromUnfixable = [...new Set(unfixable.map(u => u.ruleId))];

    if (newCount >= 4) {
      const ruleNames = [
        ...(unfixable.length > 0 ? ruleNamesFromUnfixable : []),
        ...(strayErrors.length > 0 ? ["stray-artifacts"] : []),
      ].join(" + ");
      const action4 = unfixable.length > 0 && strayErrors.length === 0
        ? "remove or move comments before continuing"
        : strayErrors.length > 0 && unfixable.length === 0
          ? "merge or delete stray files before continuing"
          : "remove or move comments and merge or delete stray files before continuing";
      const fileList = [
        ...unfixable.map(u => `  ${u.path}`),
        ...strayErrors.map(f => `  ${path.join(repoRoot, f.path)}`),
      ].join("\n");
      const stderrBase = `house-rules ${ruleNames} gate: 4th consecutive block — allowing; ${action4}\n${fileList}\n`;
      const warningsText = warnings.length > 0 ? warnings.join("\n") + "\n" : "";
      const stderr = coverageText
        ? stderrBase + coverageText + "\n" + warningsText
        : warningsText ? stderrBase + warningsText : stderrBase;
      return { stdout: "", stderr, exit: 0 };
    }

    const hasDensity = unfixable.length > 0;
    const hasStray = strayErrors.length > 0;
    const isSubagent = event === "SubagentStop";
    const handback = " Edits made after hand-back do not reach the caller.";

    const fileLines = unfixable.map(u => {
      const reason = u.reason;
      return `  ${u.path}: ${u.message}${reason ? ` — ${reason}` : ""}`;
    });

    const strayLines = strayErrors.map(f => `  ${path.join(repoRoot, f.path)}: ${f.message}`);

    const notices = unfixable
      .filter(u => u.notice != null)
      .map(u => u.notice!);

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
    if (hasDensity) {
      for (const ruleId of ruleNamesFromUnfixable) {
        ruleSummaries.push({ name: ruleId, paths: unfixable.filter(u => u.ruleId === ruleId).map(u => u.path) });
      }
    }
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
    const fullReport = buildFull(reportHeader, sects, notices, fixedPaths);
    const warningsSuffix = warnings.length > 0 ? "\n" + warnings.join("\n") : "";
    const fullReportWithCoverage = coverageText
      ? fullReport + "\n" + coverageText + warningsSuffix
      : warningsSuffix ? fullReport + warningsSuffix : fullReport;

    const tmpBase2 = opts?.testOnly_tmpDir ?? os.tmpdir();
    const safeSessionId = /^[A-Za-z0-9_-]+$/.test(sessionId) ? sessionId : "unknown";
    const blockFilePath = path.join(tmpBase2, "house-rules", safeSessionId, "stop-block.txt");
    let writeOk = false;
    try {
      mkdirSync(path.dirname(blockFilePath), { recursive: true });
      writeFileSync(blockFilePath, fullReportWithCoverage + "\n");
      writeOk = true;
    } catch { }

    let reason: string;
    if (writeOk) {
      reason = formatShortReason(ruleSummaries, blockFilePath, sfx);
      if (coverageText) reason = reason + "\n" + coverageText;
      if (warnings.length > 0) reason = reason + "\n" + warnings.join("\n");
    } else {
      if (hasDensity && !hasStray) {
        reason = formatBlock({
          header: DHEADER,
          sections: [{ lines: fileLines, footer: DFOOTERBASE }],
          notices,
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
          notices,
          fixedFiles: fixedPaths,
          suffix: sfx,
        });
      }
      if (coverageText) reason = reason + "\n" + coverageText;
      if (warnings.length > 0) reason = reason + "\n" + warnings.join("\n");
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
