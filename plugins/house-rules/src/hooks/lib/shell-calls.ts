/** Finds every run of `gh` or `git` in a parsed Bash command, whatever wrapper launches it. */

import { homedir } from "node:os";
import path from "node:path";
import type { Node } from "./tree-sitter.js";

export type Parse = (source: string) => { rootNode: Node } | null;

/** `nodes[0]` is the program. `nested` means the nodes index a re-parsed string, not the hook's command text. */
export interface ProgramCall { cmd: Node; nodes: Node[]; cwd: string; source: string; nested: boolean }

export function literal(node: Node): string | null {
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

export function expandHome(p: string): string {
  return p === "~" || p.startsWith("~/") ? path.join(homedir(), p.slice(1)) : p;
}

/** The flag that hands each program a command as one string. */
const STRING_FLAG = new Map([["bash", "c"], ["sh", "c"], ["zsh", "c"], ["dash", "c"], ["ksh", "c"], ["su", "c"], ["script", "c"], ["flock", "c"], ["env", "S"]]);
const STRING_FLAG_PATTERN = (flag: string) => new RegExp(`^-[a-zA-Z]*${flag}$`);

// Any other command before the program counts as a wrapper, so a new wrapper cannot reopen the guard. A wrong guess here only checks a body that would not have been sent.
const TREATS_ARGS_AS_DATA = new Set([":", "echo", "printf", "grep", "egrep", "fgrep", "rg", "ag", "ack", "cat", "ls", "man", "which", "whereis", "type"]);

function shellText(node: Node): string {
  if (node.type === "raw_string") return node.text.slice(1, -1);
  if (node.type === "string") return node.text.slice(1, -1).replace(/\\([$`"\\\n])/g, "$1");
  return literal(node) ?? node.text;
}

const programName = (w: string | null) => (w === null || w.startsWith("-") || /^\w+=/.test(w) ? null : path.basename(w));

function stringArgument(nodes: Node[], from: number, flag: string): Node | null {
  const pattern = STRING_FLAG_PATTERN(flag);
  for (let i = from; i < nodes.length; i++) {
    const w = literal(nodes[i] as Node);
    const name = programName(w);
    if (name === "gh" || name === "git") return null;
    if (w !== null && pattern.test(w)) return nodes[i + 1] ?? null;
  }
  return null;
}

export function programCalls(program: "gh" | "git", root: Node, source: string, startCwd: string, parse: Parse): ProgramCall[] {
  const calls: ProgramCall[] = [];

  const walk = (tree: Node, text: string, startAt: string, nested: boolean): string => {
    let cwd = startAt;
    const reparse = (inner: string, innerCwd: string): string => {
      const parsed = parse(inner);
      return parsed ? walk(parsed.rootNode, inner, innerCwd, true) : innerCwd;
    };
    for (const cmd of tree.descendantsOfType("command")) {
      if (!cmd) continue;
      const nodes = [cmd.childForFieldName("name"), ...cmd.childrenForFieldName("argument")].filter((n): n is Node => n !== null);
      const word = (i: number) => (nodes[i] ? literal(nodes[i] as Node) : null);
      const cdAt = word(0) === "command" || word(0) === "builtin" ? 1 : 0;
      const cdTarget = word(cdAt + 1);
      if (word(cdAt) === "cd" && cdTarget) cwd = path.resolve(cwd, expandHome(cdTarget));

      for (let i = 0; i < nodes.length; i++) {
        const name = programName(word(i));
        if (name === null) continue;
        if (name === "eval") {
          cwd = reparse(nodes.slice(i + 1).map(shellText).join(" "), cwd);
          break;
        }
        if (name === "gh" || name === "git") {
          if (name === program) calls.push({ cmd, nodes: nodes.slice(i), cwd, source: text, nested });
          break;
        }
        if (TREATS_ARGS_AS_DATA.has(name)) break;
        const flag = STRING_FLAG.get(name);
        const inner = flag ? stringArgument(nodes, i + 1, flag) : null;
        if (inner) {
          reparse(shellText(inner), cwd);
          break;
        }
      }
    }
    return cwd;
  };

  walk(root, source, startCwd, false);
  return calls;
}
