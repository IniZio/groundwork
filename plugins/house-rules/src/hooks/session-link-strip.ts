/**
 * PreToolUse Bash hook: removes Claude Code session links and `Claude-Session:` trailers from
 * `gh pr create` and `gh pr edit` bodies. An inline body is rewritten through updatedInput; a
 * --body-file is rewritten on disk before the command runs.
 */

import { readFileSync, writeFileSync } from "node:fs";
import type { Node } from "./lib/tree-sitter.js";
import { getParser } from "./lib/tree-sitter-loader.js";
import { readHookInput, type HookInput } from "./lib/hook-input.js";
import { stripSessionAttribution } from "../cli/lint-commit-msg.mjs";
import type { HookResult } from "./commit-guard.js";
import { findPrBodies } from "./lib/gh-pr-body.js";

interface Splice { start: number; end: number; text: string }

const allow = (): HookResult => ({ stdout: "", stderr: "", exit: 0 });

function stripQuoted(text: string): string {
  const q = text[0];
  if (text.length >= 2 && (q === `"` || q === "'") && text.endsWith(q)) {
    return q + stripSessionAttribution(text.slice(1, -1)) + q;
  }
  return stripSessionAttribution(text);
}

function splice(start: number, text: string, next: (t: string) => string): Splice | null {
  const out = next(text);
  return out === text ? null : { start, end: start + text.length, text: out };
}

/** A body built from a heredoc is stripped inside the heredoc, so its terminator line is not read as body text. */
function valueSplices(value: Node, start: number, text: string): Array<Splice | null> {
  const heredocs = value.descendantsOfType("heredoc_body").filter((b: Node | null): b is Node => b !== null);
  if (heredocs.length === 0) return [splice(start, text, stripQuoted)];
  return heredocs.map((b: Node) => splice(b.startIndex, b.text, stripSessionAttribution));
}

function stripFile(file: string): void {
  try {
    const text = readFileSync(file, "utf8");
    const out = stripSessionAttribution(text);
    if (out !== text) writeFileSync(file, out);
  } catch { /* gh reports a missing body file itself */ }
}

function findSplices(root: Node, cwd: string): Splice[] {
  const splices: Array<Splice | null> = [];
  for (const ref of findPrBodies(root, cwd)) {
    if (ref.kind === "inline") splices.push(...valueSplices(ref.value, ref.start, ref.text));
    else if (ref.kind === "stdin") splices.push(splice(ref.heredoc.startIndex, ref.heredoc.text, stripSessionAttribution));
    else stripFile(ref.path);
  }
  return splices.filter((s): s is Splice => s !== null);
}

export async function check(inp: HookInput): Promise<HookResult> {
  try {
    const command = inp.tool_input?.command;
    if (inp.tool_name !== "Bash" || command === undefined || !/\bgh\b/.test(command)) return allow();
    const parser = await getParser("bash");
    if (!parser.ok) return allow();
    const tree = parser.parser.parse(command);
    if (!tree) return allow();

    const splices = findSplices(tree.rootNode, inp.cwd ?? process.cwd()).sort((a, b) => b.start - a.start);
    if (splices.length === 0) return allow();
    let next = command;
    for (const s of splices) next = next.slice(0, s.start) + s.text + next.slice(s.end);
    const updatedInput = { ...inp.tool_input, command: next };
    return { stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput } }) + "\n", stderr: "", exit: 0 };
  } catch {
    return allow();
  }
}

if (import.meta.main) {
  const r = await check(readHookInput(await Bun.stdin.text()));
  process.stdout.write(r.stdout);
  process.exit(r.exit);
}
