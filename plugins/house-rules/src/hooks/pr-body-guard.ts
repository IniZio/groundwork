/**
 * PreToolUse Bash hook: denies `gh pr create` and `gh pr edit` when the body breaks the prose
 * rules, in a repo whose .house-rules.json turns on the pr-body rule.
 */

import { readFileSync } from "node:fs";
import type { Node } from "./lib/tree-sitter.js";
import { getParser } from "./lib/tree-sitter-loader.js";
import { readHookInput, type HookInput } from "./lib/hook-input.js";
import { findPrBodies, findPrComments, type BodyRef } from "./lib/gh-pr-body.js";
import { prBodyEnabled } from "./lib/pr-body-enabled.js";
import { checkProse, formatFindings, markdownAvailable, NO_MARKDOWN_NOTICE } from "../../rules/pr-body/prose.js";
import type { HookResult } from "./commit-guard.js";

const allow = (): HookResult => ({ stdout: "", stderr: "", exit: 0 });

function bodyText(ref: BodyRef): string | null {
  if (ref.kind === "file") {
    try { return readFileSync(ref.path, "utf8"); } catch { return null; }
  }
  const heredoc = ref.kind === "stdin" ? ref.heredoc : ref.value.descendantsOfType("heredoc_body")[0];
  if (heredoc) {
    return heredoc.namedChildren.filter((c: Node | null) => c?.type === "heredoc_content").map((c: Node | null) => c?.text ?? "").join("\n");
  }
  if (ref.kind === "stdin") return null;
  const q = ref.text[0];
  if (ref.text.length >= 2 && (q === `"` || q === "'") && ref.text.endsWith(q)) return ref.text.slice(1, -1);
  return /[$`]/.test(ref.text) ? null : ref.text;
}

function denyReason(findings: ReturnType<typeof checkProse>): string {
  return [
    "house-rules: this PR body breaks the pr-body prose rules:",
    ...formatFindings(findings),
    "Fix: split each long sentence into short ones with one fact each, replace `;` and mid-sentence `:` with a full stop, link files with a commit-sha URL, and use only the headings Why, What changed, Scope, Tradeoffs, Blast Radius, Verification, Review tier (Why and Scope are required).",
  ].join("\n");
}

const COMMENT_REASON =
  "house-rules: a top-level PR comment is denied because proof and updates belong in the PR body. Edit `## Verification` or `## Scope` with `gh pr edit <n> --body-file <file>`.";

const reply = (hookSpecificOutput: object): HookResult => ({ stdout: JSON.stringify({ hookSpecificOutput }) + "\n", stderr: "", exit: 0 });

/** `host` is a seam so a test can present a bun without Bun.markdown. */
export async function check(inp: HookInput, host: object = globalThis): Promise<HookResult> {
  try {
    const command = inp.tool_input?.command;
    if (inp.tool_name !== "Bash" || command === undefined || !/\bgh\b/.test(command) || !/\b(?:pr|api)\b/.test(command)) return allow();
    const parser = await getParser("bash");
    if (!parser.ok) return allow();
    const tree = parser.parser.parse(command);
    if (!tree) return allow();

    const cwd = inp.cwd ?? process.cwd();
    let skipped = false;
    for (const ref of findPrBodies(tree.rootNode, cwd)) {
      if (!prBodyEnabled(ref.cwd)) continue;
      const text = bodyText(ref);
      if (text === null) continue;
      if (!markdownAvailable(host)) {
        skipped = true;
        continue;
      }
      const findings = checkProse(text, { pr: true });
      if (findings.length === 0) continue;
      return reply({ hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: denyReason(findings) });
    }
    if (findPrComments(tree.rootNode, cwd).some(prBodyEnabled)) {
      return reply({ hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: COMMENT_REASON });
    }
    return skipped ? reply({ hookEventName: "PreToolUse", additionalContext: NO_MARKDOWN_NOTICE }) : allow();
  } catch {
    return allow();
  }
}

if (import.meta.main) {
  const r = await check(readHookInput(await Bun.stdin.text()));
  process.stdout.write(r.stdout);
  process.exit(r.exit);
}
