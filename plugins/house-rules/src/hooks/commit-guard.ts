/**
 * PreToolUse Bash guard: denies a `git commit` whose message fails the repo's commit-message rule.
 * A commit with no message source opens an editor; the commit-msg git hook covers that and any
 * message built from shell expansion.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { Node } from "./lib/tree-sitter.js";
import { getParser } from "./lib/tree-sitter-loader.js";
import { checkCommitMessage } from "../cli/lint-commit-msg.mjs";

export interface HookResult { stdout: string; stderr: string; exit: number }

type MessageSource =
  | { kind: "text"; text: string }
  | { kind: "file"; path: string }
  | { kind: "none" };

interface CommitCall { cwd: string; source: MessageSource }

const allow = (): HookResult => ({ stdout: "", stderr: "", exit: 0 });

function deny(reason: string): HookResult {
  const hookSpecificOutput = { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason };
  return { stdout: JSON.stringify({ hookSpecificOutput }) + "\n", stderr: "", exit: 0 };
}

function literal(node: Node): string | null {
  switch (node.type) {
    case "word":
    case "number":
      return node.text.replace(/\\(.)/gs, "$1");
    case "raw_string":
      return node.text.slice(1, -1);
    case "string":
      if (node.namedChildren.some((c: Node | null) => c?.type !== "string_content")) return null;
      return node.text.slice(1, -1).replace(/\\([$`"\\\n])/g, "$1");
    case "concatenation":
    case "command_name": {
      const parts = node.namedChildren.map((c: Node | null) => (c ? literal(c) : null));
      return parts.includes(null) ? null : parts.join("");
    }
    default:
      return null;
  }
}

const LAUNCHERS = new Set(["command", "builtin", "exec", "nohup", "env", "sudo"]);
const GIT_OPTS_WITH_VALUE = new Set(["-c", "--git-dir", "--work-tree", "--namespace", "--config-env"]);
const COMMIT_LONG_WITH_VALUE = new Set([
  "author", "date", "template", "reuse-message", "reedit-message", "fixup", "squash", "cleanup", "trailer",
  "pathspec-from-file",
]);

function stdinOf(cmd: Node, cwd: string): MessageSource | null {
  const parent = cmd.parent;
  const redirects = [
    ...cmd.childrenForFieldName("redirect"),
    ...(parent?.type === "redirected_statement" ? parent.childrenForFieldName("redirect") : []),
  ];
  for (const r of redirects) {
    if (!r) continue;
    if (r.type === "heredoc_redirect") {
      const body = r.namedChildren.find((c: Node | null) => c?.type === "heredoc_body");
      const quoted = /['"\\]/.test(r.namedChildren.find((c: Node | null) => c?.type === "heredoc_start")?.text ?? "");
      if (!body || (!quoted && body.namedChildren.some((c: Node | null) => c?.type !== "heredoc_content"))) return null;
      const text = r.text.startsWith("<<-") ? body.text.replace(/^\t+/gm, "") : body.text;
      return { kind: "text", text };
    }
    if (r.type === "herestring_redirect") {
      const value = r.namedChildren[0] ? literal(r.namedChildren[0]) : null;
      return value === null ? null : { kind: "text", text: value + "\n" };
    }
    if (r.type === "file_redirect" && r.children[0]?.type === "<") {
      const dest = r.childForFieldName("destination");
      const file = dest ? literal(dest) : null;
      return file === null ? null : { kind: "file", path: path.resolve(cwd, file) };
    }
  }
  return null;
}

/** Returns null when the message cannot be known before the command runs. */
function commitSource(args: Array<string | null>, cmd: Node, cwd: string): MessageSource | null {
  const messages: string[] = [];
  let file: string | null = null;
  const take = (i: number, attached: string): [string | null, number] =>
    attached !== "" ? [attached, i] : [args[i + 1] ?? null, i + 1];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === null || a === "--") break;
    let value: string | null | undefined;
    let flag: "m" | "F" | undefined;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const name = a.slice(2, eq === -1 ? undefined : eq);
      const attached = eq === -1 ? "" : a.slice(eq + 1);
      if (name === "message" || name === "file") {
        flag = name === "message" ? "m" : "F";
        [value, i] = take(i, attached);
      } else if (COMMIT_LONG_WITH_VALUE.has(name) && eq === -1) i++;
    } else if (a.startsWith("-")) {
      for (let j = 1; j < a.length; j++) {
        const c = a[j];
        if (c === "m" || c === "F") {
          flag = c;
          [value, i] = take(i, a.slice(j + 1));
          break;
        }
        if (c === "c" || c === "C" || c === "t") {
          if (j + 1 === a.length) i++;
          break;
        }
        if (c === "S" || c === "u") break;
      }
    }
    if (flag === undefined) continue;
    if (value === null || value === undefined) return null;
    if (flag === "m") messages.push(value);
    else file = value;
  }
  if (messages.length > 0) return { kind: "text", text: messages.join("\n\n") };
  if (file === "-") return stdinOf(cmd, cwd);
  if (file !== null) return { kind: "file", path: path.resolve(cwd, file) };
  return { kind: "none" };
}

function expandHome(p: string): string {
  return p === "~" || p.startsWith("~/") ? path.join(homedir(), p.slice(1)) : p;
}

// tree-sitter-bash drops a lone `-` written just before a heredoc, so `-F - <<EOF` parses as `-F <<EOF`.
function droppedDash(cmd: Node, source: string): boolean {
  const next = cmd.nextSibling;
  return cmd.parent?.type === "redirected_statement" && next !== null && source.slice(cmd.endIndex, next.startIndex).trim() === "-";
}

function findCommits(root: Node, source: string, startCwd: string): CommitCall[] {
  const calls: CommitCall[] = [];
  let cwd = startCwd;
  for (const cmd of root.descendantsOfType("command")) {
    if (!cmd) continue;
    const name = cmd.childForFieldName("name");
    let words = [name, ...cmd.childrenForFieldName("argument")].map(n => (n ? literal(n) : null));
    if (droppedDash(cmd, source)) words.push("-");
    while (words[0] !== null && words[0] !== undefined && LAUNCHERS.has(words[0])) {
      words = words.slice(1);
      while (words[0]?.startsWith("-") || /^\w+=/.test(words[0] ?? "")) words = words.slice(1);
    }
    const [head, ...args] = words;
    if (head === "cd" && args[0]) cwd = path.resolve(cwd, expandHome(args[0]));
    if (head === null || head === undefined || path.basename(head) !== "git") continue;

    let gitCwd: string | null = cwd;
    let i = 0;
    for (; i < args.length && args[i]?.startsWith("-"); i++) {
      const opt = args[i] as string;
      if (opt === "-C") {
        const dir = args[++i];
        gitCwd = dir && gitCwd ? path.resolve(gitCwd, expandHome(dir)) : null;
      } else if (GIT_OPTS_WITH_VALUE.has(opt)) i++;
    }
    if (args[i] !== "commit" || gitCwd === null) continue;
    const msg = commitSource(args.slice(i + 1), cmd, gitCwd);
    if (msg !== null) calls.push({ cwd: gitCwd, source: msg });
  }
  return calls;
}

function messageOf(source: MessageSource): string | null {
  if (source.kind === "text") return source.text;
  if (source.kind === "none") return null;
  try { return readFileSync(source.path, "utf8"); } catch { return null; }
}

export async function check(input: unknown): Promise<HookResult> {
  try {
    const inp = (input ?? {}) as Record<string, unknown>;
    if (inp.tool_name !== "Bash") return allow();
    const command = (inp.tool_input as Record<string, unknown> | undefined)?.command;
    if (typeof command !== "string" || !/\bgit\b/.test(command) || !command.includes("commit")) return allow();
    const cwd = typeof inp.cwd === "string" ? inp.cwd : process.cwd();

    const parser = await getParser("bash");
    if (!parser.ok) return allow();
    const tree = parser.parser.parse(command);
    if (!tree) return allow();

    for (const call of findCommits(tree.rootNode, command, cwd)) {
      const message = messageOf(call.source);
      if (message === null) continue;
      const report = checkCommitMessage(call.cwd, message, { editorUsed: false });
      if (report !== null) return deny(`house-rules: this commit message fails the repo's commit-message rule:\n${report}`);
    }
    return allow();
  } catch {
    return allow();
  }
}

if (import.meta.main) {
  let input: unknown = {};
  try { input = JSON.parse(await Bun.stdin.text()); } catch { /* fail-open */ }
  const r = await check(input);
  process.stdout.write(r.stdout);
  process.exit(r.exit);
}
