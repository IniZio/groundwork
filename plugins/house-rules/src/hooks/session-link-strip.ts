/**
 * PreToolUse Bash hook: removes Claude Code session links and `Claude-Session:` trailers from
 * `gh pr create` and `gh pr edit` bodies. An inline body is rewritten through updatedInput; a
 * --body-file is rewritten on disk before the command runs.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Node } from "./lib/tree-sitter.js";
import { getParser } from "./lib/tree-sitter-loader.js";
import { hookInput, parseJson, type HookInput } from "./lib/hook-input.js";
import { stripSessionAttribution } from "../cli/lint-commit-msg.mjs";
import { literal, LAUNCHERS, expandHome, type HookResult } from "./commit-guard.js";

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

function stdinHeredoc(cmd: Node): Node | null {
  const parent = cmd.parent;
  const redirects = parent?.type === "redirected_statement" ? parent.childrenForFieldName("redirect") : [];
  for (const r of [...cmd.childrenForFieldName("redirect"), ...redirects]) {
    if (r?.type !== "heredoc_redirect") continue;
    return r.namedChildren.find((c: Node | null) => c?.type === "heredoc_body") ?? null;
  }
  return null;
}

function stripFile(file: string): void {
  try {
    const text = readFileSync(file, "utf8");
    const out = stripSessionAttribution(text);
    if (out !== text) writeFileSync(file, out);
  } catch { /* gh reports a missing body file itself */ }
}

/** Collects the splices for one `gh pr create|edit` call and strips its --body-file on disk. */
function bodySplices(cmd: Node, args: Node[], cwd: string): Splice[] {
  const splices: Array<Splice | null> = [];
  const bodyFile = (value: string | null | undefined) => {
    if (value === undefined || value === "-") {
      const body = stdinHeredoc(cmd);
      if (body) splices.push(splice(body.startIndex, body.text, stripSessionAttribution));
    } else if (value !== null) stripFile(path.resolve(cwd, expandHome(value)));
  };
  for (let i = 0; i < args.length; i++) {
    const node = args[i] as Node;
    const word = literal(node);
    if (word === "--body" || word === "-b") {
      const value = args[++i];
      if (value) splices.push(...valueSplices(value, value.startIndex, value.text));
    } else if (node.text.startsWith("--body=")) {
      splices.push(...valueSplices(node, node.startIndex + 7, node.text.slice(7)));
    } else if (word === "--body-file" || word === "-F") {
      const value = args[++i];
      bodyFile(value ? literal(value) : undefined);
    } else if (word?.startsWith("--body-file=")) {
      bodyFile(word.slice("--body-file=".length));
    }
  }
  return splices.filter((s): s is Splice => s !== null);
}

function findSplices(root: Node, startCwd: string): Splice[] {
  const splices: Splice[] = [];
  let cwd = startCwd;
  for (const cmd of root.descendantsOfType("command")) {
    if (!cmd) continue;
    let nodes = [cmd.childForFieldName("name"), ...cmd.childrenForFieldName("argument")].filter((n): n is Node => n !== null);
    const word = (i: number) => (nodes[i] ? literal(nodes[i] as Node) : null);
    while (nodes.length > 0 && LAUNCHERS.has(word(0) ?? "")) {
      nodes = nodes.slice(1);
      while (/^-|^\w+=/.test(word(0) ?? "")) nodes = nodes.slice(1);
    }
    const head = word(0);
    if (head === "cd" && word(1)) cwd = path.resolve(cwd, expandHome(word(1) as string));
    if (head === null || path.basename(head) !== "gh" || word(1) !== "pr") continue;
    if (word(2) !== "create" && word(2) !== "edit") continue;
    splices.push(...bodySplices(cmd, nodes.slice(3), cwd));
  }
  return splices;
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
  const r = await check(hookInput(parseJson(await Bun.stdin.text())));
  process.stdout.write(r.stdout);
  process.exit(r.exit);
}
