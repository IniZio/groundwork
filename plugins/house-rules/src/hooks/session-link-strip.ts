/**
 * PreToolUse Bash hook: removes Claude Code session links and `Claude-Session:` trailers from
 * `gh pr create`, `gh pr edit` and `gh api` PR write bodies. An inline body is rewritten through
 * updatedInput; a body file is rewritten on disk before the command runs, and a heredoc the same
 * command writes into that file is rewritten in the command. A body inside a re-parsed
 * string such as `bash -c` and an `--input` payload are left alone.
 */

import { readFileSync, writeFileSync } from "node:fs";
import type { Node } from "./lib/tree-sitter.js";
import { getParser } from "./lib/tree-sitter-loader.js";
import { readHookInput, type HookInput } from "./lib/hook-input.js";
import { stripSessionAttribution } from "../cli/lint-commit-msg.mjs";
import type { HookResult } from "./commit-guard.js";
import path from "node:path";
import { findPrBodies } from "./lib/gh-pr-body.js";
import { expandHome, literal, type Parse } from "./lib/shell-calls.js";

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

/** `cat > body.md <<EOF` before `gh pr create --body-file body.md` writes the file after this hook reads it. */
function writerHeredocs(root: Node, cwd: string, file: string): Node[] {
  return root.descendantsOfType("redirected_statement").filter((s: Node | null): s is Node => s !== null).flatMap((s: Node) => {
    const redirects = s.childrenForFieldName("redirect").filter((r: Node | null): r is Node => r !== null);
    const writes = redirects.some((r: Node) => {
      const dest = r.type === "file_redirect" ? r.childForFieldName("destination") : null;
      const word = dest ? literal(dest) : undefined;
      return !!word && path.resolve(cwd, expandHome(word)) === file;
    });
    if (!writes) return [];
    return redirects.filter((r: Node) => r.type === "heredoc_redirect")
      .flatMap((r: Node) => r.namedChildren.filter((c: Node | null): c is Node => c?.type === "heredoc_body"));
  });
}

function findSplices(root: Node, source: string, cwd: string, parse: Parse): Splice[] {
  const splices: Array<Splice | null> = [];
  for (const ref of findPrBodies(root, source, cwd, parse)) {
    if (ref.kind === "file") {
      stripFile(ref.path);
      for (const b of writerHeredocs(root, ref.cwd, ref.path)) splices.push(splice(b.startIndex, b.text, stripSessionAttribution));
    }
    else if (ref.kind === "json-file" || ref.kind === "json-stdin" || ref.nested) continue;
    else if (ref.kind === "inline") splices.push(...valueSplices(ref.value, ref.start, ref.text));
    else splices.push(splice(ref.heredoc.startIndex, ref.heredoc.text, stripSessionAttribution));
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

    const splices = findSplices(tree.rootNode, command, inp.cwd ?? process.cwd(), (source) => parser.parser.parse(source)).sort((a, b) => b.start - a.start);
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
