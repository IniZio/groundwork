/**
 * PreToolUse edit guard — runs each rule's editCheck in rule-id order.
 * Trigger: Edit | Write | MultiEdit.
 * Runs every rule's editCheck generically; imports nothing from comment-density
 * or the house-rules gate.
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { reconstructPostEdit, type EditInput } from "./lib/pending-edit.js";
import { languageForPath } from "./languages/registry.js";
import { sessionBase, addedRanges, diffTextToHunks } from "./lib/work-scope.js";
import { loadRules } from "../engine/registry.js";
import { BUILTIN_POLICY, DEFAULT_IGNORE } from "../engine/policy.js";
import { createSourceFiles, getDefaultParserFactory } from "../engine/source-file.js";
import { grammarFailureWarning } from "../engine/run.js";
import type { Rule, PendingEdit, EditCheckEnv, SessionBaseInfo, Finding } from "../engine/types.js";
import { parserForPath, type ParserFactory } from "./languages/parse.js";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export interface HookResult { stdout: string; stderr: string; exit: number }

function allow(): HookResult { return { stdout: "", stderr: "", exit: 0 }; }

function rewrite(updatedInput: Record<string, unknown>, ctx: string): HookResult {
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput, additionalContext: ctx },
    }) + "\n",
    stderr: "",
    exit: 0,
  };
}

function advisory(ctx: string, stderrLine?: string): HookResult {
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: ctx },
    }) + "\n",
    stderr: stderrLine ? stderrLine + "\n" : "",
    exit: 0,
  };
}

function deny(reason: string): HookResult {
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", additionalContext: reason },
    }) + "\n",
    stderr: "",
    exit: 0,
  };
}

function isIgnoredByDefault(filePath: string, cwd: string | null): boolean {
  let dir = cwd ?? path.dirname(filePath);
  // Walk up to the nearest existing directory (the target path may not exist yet)
  while (dir !== path.dirname(dir) && !existsSync(dir)) {
    dir = path.dirname(dir);
  }
  const r = spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (r.status !== 0) return false;
  const repoRoot = r.stdout.trim();
  const relPath = path.relative(repoRoot, filePath);
  return DEFAULT_IGNORE.some((pattern) => new Bun.Glob(pattern).match(relPath));
}

const WRITE_TOOLS = new Set(["edit", "write", "multiedit"]);

function normalTool(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const lower = raw.toLowerCase();
  return lower.startsWith("fast_") ? lower.slice(5) : lower;
}

type EditEntry = { old_string: string; new_string: string; replace_all?: boolean };

function getBaseText(filePath: string, base: string): string | null {
  if (!base || base === EMPTY_TREE) return null;
  const dir = path.dirname(filePath);
  const rootResult = spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (rootResult.status !== 0) return null;
  const repoRoot = rootResult.stdout.trim();
  const relPath = path.relative(repoRoot, filePath);
  const showResult = spawnSync("git", ["-C", repoRoot, "show", `${base}:${relPath}`], { encoding: "utf8" });
  if (showResult.status !== 0) return null;
  return showResult.stdout;
}

function mapEditToInput(
  ti: Record<string, unknown>,
  pre: string,
  post: string,
  stripped_post: string,
): Record<string, unknown> | null {
  const old_string = typeof ti.old_string === "string" ? ti.old_string : "";
  const new_string = typeof ti.new_string === "string" ? ti.new_string : "";
  const replace_all = !!ti.replace_all;

  if (!replace_all) {
    const idx = pre.indexOf(old_string);
    if (idx === -1) return null;

    // Derive the actual changed span by comparing post vs stripped_post.
    let sfx = 0;
    const maxSfx = Math.min(post.length, stripped_post.length);
    while (sfx < maxSfx && post[post.length - 1 - sfx] === stripped_post[stripped_post.length - 1 - sfx]) sfx++;

    let pfx = 0;
    const maxPfx = Math.min(post.length - sfx, stripped_post.length - sfx);
    while (pfx < maxPfx && post[pfx] === stripped_post[pfx]) pfx++;

    const changeStart = pfx;
    const changeEnd = post.length - sfx;
    const editStart = idx;
    const editEnd = idx + new_string.length;

    // Change must be within [editStart-1, editEnd] (allow 1 char before for whole-line \n removal)
    if (changeStart < editStart - 1 || changeEnd > editEnd) return null;

    const new_sn = sfx > 0 ? stripped_post.slice(pfx, stripped_post.length - sfx) : stripped_post.slice(pfx);

    if (changeStart >= editStart) {
      // Change is entirely within the edit span
      const pre_in_new = changeStart - editStart;
      const post_in_new = editEnd - changeEnd;
      const unchanged_prefix = new_string.slice(0, pre_in_new);
      const unchanged_suffix = post_in_new > 0 ? new_string.slice(new_string.length - post_in_new) : "";
      return { ...ti, new_string: unchanged_prefix + new_sn + unchanged_suffix };
    } else {
      // changeStart == editStart - 1: a char before the edit (e.g. preceding \n) was also removed
      const extra = pre.slice(changeStart, editStart);
      const post_in_new = editEnd - changeEnd;
      const unchanged_suffix = post_in_new > 0 ? new_string.slice(new_string.length - post_in_new) : "";
      return { ...ti, old_string: extra + old_string, new_string: new_sn + unchanged_suffix };
    }
  }

  const occs: number[] = [];
  let s = 0;
  while (true) {
    const idx = pre.indexOf(old_string, s);
    if (idx === -1) break;
    occs.push(idx);
    s = idx + old_string.length;
  }
  if (occs.length === 0) return null;

  const delta = new_string.length - old_string.length;
  const post_len = pre.length + occs.length * delta;
  const sns = occs.map((idx, i) => {
    const start = idx + i * delta;
    const end = start + new_string.length;
    const suf = post_len - end;
    return suf > 0 ? stripped_post.slice(start, stripped_post.length - suf) : stripped_post.slice(start);
  });

  const first = sns[0];
  if (!sns.every(sn => sn === first)) return null;
  return { ...ti, new_string: first };
}

function mapMultiEditToInput(
  ti: Record<string, unknown>,
  pre: string,
  _post: string,
  stripped_post: string,
): Record<string, unknown> | null {
  const edits = Array.isArray(ti.edits) ? ti.edits as EditEntry[] : [];
  if (edits.length === 0) return null;

  let text = pre;
  let cumDelta = 0;
  const ranges: Array<{ start: number; end: number }> = [];

  for (const e of edits) {
    if (e.replace_all) return null;
    const idx = text.indexOf(e.old_string);
    if (idx === -1) return null;
    const start = idx + cumDelta;
    const end = start + e.new_string.length;
    ranges.push({ start, end });
    cumDelta += e.new_string.length - e.old_string.length;
    text = text.slice(0, idx) + e.new_string + text.slice(idx + e.old_string.length);
  }

  const post_len = text.length;
  const new_edits = edits.map((e, i) => {
    const { start, end } = ranges[i];
    const suf = post_len - end;
    const sn = suf > 0
      ? stripped_post.slice(start, stripped_post.length - suf)
      : stripped_post.slice(start);
    return { ...e, new_string: sn };
  });

  return { ...ti, edits: new_edits };
}

function mapToInput(
  tool: string,
  ti: Record<string, unknown>,
  pre: string,
  post: string,
  stripped_post: string,
): Record<string, unknown> | null {
  if (tool === "write") return { ...ti, content: stripped_post };
  if (tool === "edit") return mapEditToInput(ti, pre, post, stripped_post);
  if (tool === "multiedit") return mapMultiEditToInput(ti, pre, post, stripped_post);
  return null;
}

export interface CheckOpts {
  getParser?: ParserFactory;
  readFile?: (p: string) => string | null;
  ledgerDir?: string;
  rules?: Rule[];
  testOnly?: Record<string, unknown>;
}

export async function check(input: unknown, opts: CheckOpts = {}): Promise<HookResult> {
  const factory = opts.getParser ?? getDefaultParserFactory();
  const sourceFiles = createSourceFiles(factory);
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) return allow();
    const inp = input as Record<string, unknown>;

    const tool = normalTool(inp.tool_name);
    if (!WRITE_TOOLS.has(tool)) return allow();

    const ti = (inp.tool_input && typeof inp.tool_input === "object" && !Array.isArray(inp.tool_input))
      ? inp.tool_input as Record<string, unknown>
      : {};

    const filePath = typeof ti.file_path === "string" ? ti.file_path : "";
    if (!filePath) return allow();
    const transcriptPath = typeof inp.transcript_path === "string" ? inp.transcript_path : null;
    const cwd = typeof inp.cwd === "string" ? inp.cwd : null;
    if (isIgnoredByDefault(filePath, cwd)) return allow();

    const readFile = opts.readFile ?? ((p: string) => { try { return readFileSync(p, "utf8"); } catch { return null; } });
    const pre = readFile(filePath);

    const firstLine = tool === "write" && typeof ti.content === "string"
      ? ti.content.split("\n")[0]
      : tool !== "write" ? pre?.split("\n")[0] : undefined;
    const lang = languageForPath(filePath, firstLine);

    const recon = reconstructPostEdit(tool, ti as EditInput, pre);
    if (!recon) return allow();
    const { post: originalPost, changedRows } = recon;

    // Resolve repoRoot
    const repoRoot: string | null = (() => {
      let dir = cwd ?? path.dirname(filePath);
      while (dir !== path.dirname(dir) && !existsSync(dir)) dir = path.dirname(dir);
      const r = spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
      return r.status === 0 ? r.stdout.trim() : null;
    })();

    // Build session base info (shared; postHunks recomputed per rule below)
    type SessionBase_ = {
      commit: string;
      addedRows: number[] | null;
      baseText: string | null;
      preHunks: SessionBaseInfo["preHunks"];
    };
    let sessionBase_: SessionBase_ | null = null;
    if (transcriptPath && pre !== null) {
      const repo = cwd ?? path.dirname(filePath);
      const commit = sessionBase(transcriptPath, repo);
      const addedRowsVal = addedRanges(filePath, commit);
      const baseText = getBaseText(filePath, commit);
      const preHunks = baseText !== null ? diffTextToHunks(baseText, pre) : null;
      sessionBase_ = { commit, addedRows: addedRowsVal, baseText, preHunks };
    }

    // Load and filter rules: keep those with editCheck, non-off severity, matching language
    const rulesDir = path.join(import.meta.dir, "../../rules");
    const allRules = opts.rules ?? await loadRules(rulesDir);
    let activeRules = allRules.filter(r => {
      if (!r.editCheck) return false;
      const severity = BUILTIN_POLICY[r.id]?.severity ?? "warn";
      if (severity === "off") return false;
      if (r.languages && r.languages.length > 0) {
        if (lang === null || !r.languages.includes(lang)) return false;
      }
      return true;
    }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

    let text = originalPost;
    // Each item tracks normal context text and advisory text (for mapping-failure advisory).
    const contextItems: Array<{ normal: string; advisory: string }> = [];
    const stderrLines: string[] = [];
    let blockingFinding: Finding | null = null;

    if (lang !== null && activeRules.some(r => r.languages && r.languages.length > 0)) {
      const sf = await sourceFiles.get(lang, originalPost, filePath);
      if (!sf.ok) {
        const W = grammarFailureWarning(filePath, lang, sf.reason);
        contextItems.push({ normal: W, advisory: W });
        stderrLines.push(W);
        activeRules = activeRules.filter(r => !(r.languages && r.languages.length > 0));
      }
    }

    for (const rule of activeRules) {
      // Recompute postHunks for this rule's current text
      let session: SessionBaseInfo | null = null;
      if (sessionBase_ !== null) {
        const postHunks = sessionBase_.baseText !== null ? diffTextToHunks(sessionBase_.baseText, text) : null;
        session = {
          commit: sessionBase_.commit,
          addedRows: sessionBase_.addedRows,
          baseText: sessionBase_.baseText,
          preHunks: sessionBase_.preHunks,
          postHunks,
        };
      }

      const pendingEdit: PendingEdit = {
        path: filePath,
        tool: tool as "write" | "edit" | "multiedit",
        lang,
        pre,
        post: text,
        changedRows,
        session,
        repoRoot,
        cwd,
      };

      let result: import("../engine/types.js").EditCheckResult;
      try {
        const capturedText = text;
        const env: EditCheckEnv = {
          sourceFile: () => lang !== null ? sourceFiles.get(lang, capturedText, filePath) : Promise.resolve(null),
          parserFactory: parserForPath(factory, filePath),
          ledgerDir: opts.ledgerDir,
          testOnly: opts.testOnly,
        };
        result = await rule.editCheck!(pendingEdit, env);
      } catch {
        continue;
      }

      // Drop findings for ignored paths
      const findings = result.findings.filter(f =>
        !DEFAULT_IGNORE.some(pattern => new Bun.Glob(pattern).match(f.path)),
      );

      const severity = BUILTIN_POLICY[rule.id]?.severity ?? "warn";
      const isErrorSeverity = severity === "error";

      if (isErrorSeverity && findings.length > 0) {
        blockingFinding = findings[0];
        break;
      }

      // Handle edits
      let editsApplied = false;
      let editsRefused = false;
      let refusalLine: string | undefined;

      if (result.edits && result.edits.length > 0) {
        const sortedEdits = [...result.edits].sort((a, b) => a.start - b.start);
        let valid = true;
        let cursor = 0;
        for (const e of sortedEdits) {
          if (e.start < cursor || e.end < e.start || e.end > text.length) { valid = false; break; }
          cursor = e.end;
        }

        if (!valid) {
          editsRefused = true;
          refusalLine = `house-rules edit guard: ${rule.id} rewrite refused — the rewritten file does not parse; the edit passes through as written.`;
        } else {
          // Apply edits to build candidate text
          let newText = "";
          let pos = 0;
          for (const e of sortedEdits) {
            newText += text.slice(pos, e.start) + e.text;
            pos = e.end;
          }
          newText += text.slice(pos);

          // Parse-safety check
          let refuse = false;
          if (lang !== null) {
            const oldParse = await sourceFiles.get(lang, text, filePath);
            const newParse = await sourceFiles.get(lang, newText, filePath);
            if (!newParse.ok) {
              refuse = true;
            } else if (oldParse.ok && newParse.ok && newParse.source.errorRows.size > oldParse.source.errorRows.size) {
              refuse = true;
            }
          }

          if (refuse) {
            editsRefused = true;
            refusalLine = `house-rules edit guard: ${rule.id} rewrite refused — the rewritten file does not parse; the edit passes through as written.`;
          } else if (newText !== text) {
            text = newText;
            editsApplied = true;
          }
        }
      }

      if (editsApplied) {
        if (result.notice !== undefined) {
          contextItems.push({
            normal: result.notice,
            advisory: result.refusedNotice ?? result.notice,
          });
        } else if (result.refusedNotice !== undefined) {
          contextItems.push({ normal: "", advisory: result.refusedNotice });
        }
      } else if (editsRefused) {
        const noticeText = result.refusedNotice ?? result.notice;
        if (noticeText !== undefined) {
          contextItems.push({ normal: noticeText, advisory: noticeText });
        }
        if (refusalLine) {
          contextItems.push({ normal: refusalLine, advisory: refusalLine });
        }
      } else {
        if (result.notice !== undefined) {
          contextItems.push({ normal: result.notice, advisory: result.notice });
        }
      }

      if (!isErrorSeverity) {
        for (const f of findings) {
          const line = `house-rules ${f.ruleId}: ${f.message}`;
          contextItems.push({ normal: line, advisory: line });
        }
      }

      if (result.stderr !== undefined) stderrLines.push(result.stderr);
    }

    if (blockingFinding !== null) {
      return deny(blockingFinding.message);
    }

    if (text !== originalPost) {
      const updatedTi = mapToInput(tool, ti, pre ?? "", originalPost, text);
      if (updatedTi !== null) {
        const verified = reconstructPostEdit(tool, updatedTi as EditInput, pre);
        if (verified && verified.post === text) {
          const ctxStr = contextItems.map(c => c.normal).filter(s => s.length > 0).join("\n");
          return rewrite(updatedTi, ctxStr);
        }
      }
      // Mapping/verification failed — fallback advisory
      const ctxStr = contextItems.map(c => c.advisory).filter(s => s.length > 0).join("\n");
      if (ctxStr) {
        return advisory(ctxStr, stderrLines.length > 0 ? stderrLines.join("\n") : undefined);
      }
      return allow();
    }

    const ctxStr = contextItems.map(c => c.normal).filter(s => s.length > 0).join("\n");
    if (ctxStr) {
      return advisory(ctxStr, stderrLines.length > 0 ? stderrLines.join("\n") : undefined);
    }

    return allow();
  } catch {
    return allow();
  } finally {
    sourceFiles.dispose();
  }
}

if (import.meta.main) {
  const raw = await Bun.stdin.text();
  let input: unknown = {};
  try { input = JSON.parse(raw); } catch { /* fail-open */ }
  const result = await check(input);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.exit);
}
