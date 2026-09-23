/**
 * Family: Comment-density advisory guard.
 * Trigger: PreToolUse (Edit, Write, MultiEdit).
 * Scope: changed lines only — new_string for Edit/MultiEdit, content for Write.
 * Warns when changed lines exceed 5 effective comment lines per 100 lines.
 * Advisory only — edit always proceeds (no permissionDecision emitted).
 *
 * Whitelisted (exempt from effective count):
 *   JSDoc /** blocks, @-tagged annotations (@ts-expect-error, @ts-ignore, eslint-disable,
 *   #region/#endregion), URL-only lines, section dividers, TODO(owner) markers.
 */

export interface HookResult { stdout: string; stderr: string; exit: number }

function allow(): HookResult { return { stdout: "", stderr: "", exit: 0 }; }
function warn(reason: string): HookResult {
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: reason },
    }) + "\n",
    stderr: "",
    exit: 0,
  };
}

const FILE_CAP = 5;
const MIN_ADDED_LINES = 20;

const RULE_TEXT =
  "Comments per 100 lines must stay ≤5 (effective) in the lines you add. " +
  "JSDoc /** blocks, @-tagged annotations (@ts-expect-error, @ts-ignore, eslint-disable, " +
  "#region), URL-only lines, section dividers, and TODO(owner) markers are exempt. " +
  "Do not add comments that merely restate adjacent code. " +
  "Applies to every Edit, Write, and MultiEdit call.";

// --- Whitelist patterns (comment lines exempt from effective count) ---
const ANNOT_TAG_RE = /^\s*\/\/\s*@\w/;
const URL_LINE_RE = /^\s*\/\/\s*https?:\/\//;
const SECTION_DIV_RE = /^\s*\/\/[ \t]*(?:[─-╿]{2,}|[-=]{4,})/u;
const ESLINT_RE = /^\s*\/\/\s*eslint-(?:disable|enable)/;
const REGION_RE = /^\s*\/\/\s*#(?:region|endregion)/;
const TODO_OWNER_RE = /^\s*\/\/\s*TODO\([^)]+\)/;

function isExempt(raw: string): boolean {
  return (
    ANNOT_TAG_RE.test(raw) ||
    URL_LINE_RE.test(raw) ||
    SECTION_DIV_RE.test(raw) ||
    ESLINT_RE.test(raw) ||
    REGION_RE.test(raw) ||
    TODO_OWNER_RE.test(raw)
  );
}

/** Count effective (non-exempt) comment lines in added text. */
function countEffective(text: string): { total: number; effective: number; lines: number[] } {
  const rows = text.split("\n");
  let effective = 0;
  const lines: number[] = [];
  let inJsDoc = false;
  let inBlock = false;

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const trimmed = raw.trim();

    if (inJsDoc) {
      if (trimmed.includes("*/")) inJsDoc = false;
      continue;
    }

    if (inBlock) {
      effective++;
      lines.push(i + 1);
      if (trimmed.includes("*/")) inBlock = false;
      continue;
    }

    if (trimmed.startsWith("/**")) {
      if (!trimmed.slice(3).includes("*/")) inJsDoc = true;
      continue;
    }

    if (trimmed.startsWith("/*")) {
      effective++;
      lines.push(i + 1);
      if (!trimmed.slice(2).includes("*/")) inBlock = true;
      continue;
    }

    if (trimmed.startsWith("//")) {
      if (!isExempt(raw)) {
        effective++;
        lines.push(i + 1);
      }
      continue;
    }
  }

  return { total: rows.length, effective, lines };
}

const WRITE_TOOLS = new Set(["edit", "write", "multiedit"]);

function normalTool(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const lower = raw.toLowerCase();
  return lower.startsWith("fast_") ? lower.slice(5) : lower;
}

/** Collect the added text from the tool input. */
function addedText(tool: string, ti: Record<string, unknown>): string | null {
  if (tool === "write") {
    return typeof ti.content === "string" ? ti.content : null;
  }
  if (tool === "edit") {
    return typeof ti.new_string === "string" ? ti.new_string : null;
  }
  if (tool === "multiedit") {
    const edits = ti.edits;
    if (!Array.isArray(edits)) return null;
    const parts: string[] = [];
    for (const e of edits) {
      if (e && typeof e === "object" && typeof (e as Record<string, unknown>).new_string === "string") {
        parts.push((e as Record<string, unknown>).new_string as string);
      }
    }
    return parts.join("\n") || null;
  }
  return null;
}

export function check(input: unknown): HookResult {
  try {
    if (process.env.GROUNDWORK_COMMENT_DENSITY === "0") return allow();

    if (!input || typeof input !== "object" || Array.isArray(input)) return allow();
    const inp = input as Record<string, unknown>;

    const tool = normalTool(inp.tool_name);
    if (!WRITE_TOOLS.has(tool)) return allow();

    const ti = (inp.tool_input && typeof inp.tool_input === "object" && !Array.isArray(inp.tool_input))
      ? inp.tool_input as Record<string, unknown>
      : {};

    const filePath = typeof ti.file_path === "string" ? ti.file_path : "";

    const text = addedText(tool, ti);
    if (text === null) return allow();

    const { total, effective, lines } = countEffective(text);
    if (total < MIN_ADDED_LINES) return allow();

    const per100 = (effective / total) * 100;
    if (per100 <= FILE_CAP) return allow();

    const location = filePath ? `${filePath} ` : "";
    const violation =
      `${location}added lines [${lines.join(",")}]: over-cap ${per100.toFixed(1)}/100 > ${FILE_CAP}/100`;

    return warn(
      "⚠️  groundwork comment-density-guard:\n" + violation + "\n\n" + RULE_TEXT,
    );
  } catch {
    return allow();
  }
}

if (import.meta.main) {
  const raw = await Bun.stdin.text();
  let input: unknown = {};
  try { input = JSON.parse(raw); } catch { /* fail-open */ }
  const result = check(input);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.exit);
}
