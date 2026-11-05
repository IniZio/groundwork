/**
 * PreToolUse Bash hook: denies `gh pr create`, `gh pr edit` and a `gh api` PR write when the body
 * breaks the prose rules, in a repo whose .house-rules.json turns on the pr-body rule.
 */

import { readFileSync } from "node:fs";
import type { Node } from "./lib/tree-sitter.js";
import { getParser } from "./lib/tree-sitter-loader.js";
import { readHookInput, type HookInput } from "./lib/hook-input.js";
import { findPrBodies, findPrComments, type BodyRef } from "./lib/gh-pr-body.js";
import { prBodyEnabled } from "./lib/pr-body-enabled.js";
import { checkProse, formatFindings, markdownAvailable, NO_MARKDOWN_NOTICE, type MarkdownHost } from "../../rules/pr-body/prose.js";
import type { HookResult } from "./commit-guard.js";

const allow = (): HookResult => ({ stdout: "", stderr: "", exit: 0 });

const heredocText = (heredoc: Node) =>
  heredoc.namedChildren.filter((c: Node | null) => c?.type === "heredoc_content").map((c: Node | null) => c?.text ?? "").join("\n");

function payloadBody(payload: string): string | null {
  try {
    const body = (JSON.parse(payload) as { body?: unknown } | null)?.body;
    return body === undefined || body === null ? null : String(body);
  } catch {
    return null;
  }
}

function bodyText(ref: BodyRef): string | null {
  if (ref.kind === "file" || ref.kind === "json-file") {
    try {
      const text = readFileSync(ref.path, "utf8");
      return ref.kind === "file" ? text : payloadBody(text);
    } catch {
      return null;
    }
  }
  if (ref.kind === "json-stdin") return payloadBody(ref.heredoc.text);
  const heredoc = ref.kind === "stdin" ? ref.heredoc : ref.value.descendantsOfType("heredoc_body")[0];
  if (heredoc) return heredocText(heredoc);
  if (ref.kind === "stdin") return null;
  const q = ref.text[0];
  if (ref.text.length >= 2 && (q === `"` || q === "'") && ref.text.endsWith(q)) return ref.text.slice(1, -1);
  return /[$`]/.test(ref.text) ? null : ref.text;
}

function denyReason(findings: ReturnType<typeof checkProse>): string {
  return [
    "house-rules: this PR body breaks the pr-body prose rules:",
    ...formatFindings(findings),
    "Fix: split each long sentence into short ones with one fact each, replace `;` and mid-sentence `:` with a full stop, link files with a commit-sha URL, keep Why to 1-3 sentences and What changed to 1-3 bullets, keep the body within 200 words by moving proof into a <details> block, and use only the headings Why, What changed, Scope, Tradeoffs, Blast Radius, Verification, Review tier (Why and Scope are required).",
  ].join("\n");
}

const COMMENT_REASON =
  "house-rules: a top-level PR comment is denied because proof and updates belong in the PR body. Edit `## Verification` or `## Scope` with `gh pr edit <n> --body-file <file>`.";

interface PreToolUseOutput { hookEventName: string; permissionDecision?: "deny"; permissionDecisionReason?: string; additionalContext?: string }

const reply = (hookSpecificOutput: PreToolUseOutput): HookResult => ({ stdout: JSON.stringify({ hookSpecificOutput }) + "\n", stderr: "", exit: 0 });

/** `host` is a seam so a test can present a bun without Bun.markdown. */
export async function check(inp: HookInput, host: MarkdownHost = globalThis): Promise<HookResult> {
  try {
    const command = inp.tool_input?.command;
    if (inp.tool_name !== "Bash" || command === undefined || !/\bgh\b/.test(command) || !/\b(?:pr|api)\b/.test(command)) return allow();
    const parser = await getParser("bash");
    if (!parser.ok) return allow();
    const tree = parser.parser.parse(command);
    if (!tree) return allow();

    const cwd = inp.cwd ?? process.cwd();
    const parse = (source: string) => parser.parser.parse(source);
    let skipped = false;
    for (const ref of findPrBodies(tree.rootNode, command, cwd, parse)) {
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
    if (findPrComments(tree.rootNode, command, cwd, parse).some(prBodyEnabled)) {
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
