/**
 * PostToolUse Write|Edit|MultiEdit hook: tells the agent which sentences it just wrote in a doc
 * page break the prose rules. Advisory only; it never blocks.
 */

import path from "node:path";
import { readHookInput, type HookInput } from "./lib/hook-input.js";
import { prBodyEnabled } from "./lib/pr-body-enabled.js";
import { checkProse, formatFindings } from "../../rules/pr-body/prose.js";

const DOC_PATH = /(^|\/)(docs?\/.+\.md|README\.md)$/;

function writtenText(inp: HookInput): string {
  const t = inp.tool_input;
  if (!t) return "";
  return [t.content, t.new_string, ...(t.edits ?? []).map((e) => e.new_string)].filter(Boolean).join("\n\n");
}

export function advise(inp: HookInput): string {
  try {
    const file = inp.tool_input?.file_path;
    if (!file || !["Write", "Edit", "MultiEdit"].includes(inp.tool_name ?? "")) return "";
    const abs = path.resolve(inp.cwd ?? process.cwd(), file);
    if (!DOC_PATH.test(abs) || !prBodyEnabled(path.dirname(abs))) return "";
    const findings = checkProse(writtenText(inp), { pr: false });
    if (findings.length === 0) return "";
    const additionalContext = [
      `house-rules: ${file} has prose that is hard for a human to read. Rewrite these sentences:`,
      ...formatFindings(findings),
    ].join("\n");
    return JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext } }) + "\n";
  } catch {
    return "";
  }
}

if (import.meta.main) {
  process.stdout.write(advise(readHookInput(await Bun.stdin.text())));
}
