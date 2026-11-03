/** Finds the body of every `gh pr create|edit` call in a parsed Bash command. */

import path from "node:path";
import type { Node } from "./tree-sitter.js";
import { literal, LAUNCHERS, expandHome } from "../commit-guard.js";

export type BodyRef =
  | { kind: "inline"; cwd: string; value: Node; start: number; text: string }
  | { kind: "stdin"; cwd: string; heredoc: Node }
  | { kind: "file"; cwd: string; path: string };

export function stdinHeredoc(cmd: Node): Node | null {
  const parent = cmd.parent;
  const redirects = parent?.type === "redirected_statement" ? parent.childrenForFieldName("redirect") : [];
  for (const r of [...cmd.childrenForFieldName("redirect"), ...redirects]) {
    if (r?.type !== "heredoc_redirect") continue;
    return r.namedChildren.find((c: Node | null) => c?.type === "heredoc_body") ?? null;
  }
  return null;
}

function callBodies(cmd: Node, args: Node[], cwd: string): BodyRef[] {
  const refs: BodyRef[] = [];
  const bodyFile = (value: string | null | undefined) => {
    if (value === undefined || value === "-") {
      const heredoc = stdinHeredoc(cmd);
      if (heredoc) refs.push({ kind: "stdin", cwd, heredoc });
    } else if (value !== null) refs.push({ kind: "file", cwd, path: path.resolve(cwd, expandHome(value)) });
  };
  for (let i = 0; i < args.length; i++) {
    const node = args[i] as Node;
    const word = literal(node);
    if (word === "--body" || word === "-b") {
      const value = args[++i];
      if (value) refs.push({ kind: "inline", cwd, value, start: value.startIndex, text: value.text });
    } else if (node.text.startsWith("--body=")) {
      refs.push({ kind: "inline", cwd, value: node, start: node.startIndex + 7, text: node.text.slice(7) });
    } else if (word === "--body-file" || word === "-F") {
      const value = args[++i];
      bodyFile(value ? literal(value) : undefined);
    } else if (word?.startsWith("--body-file=")) {
      bodyFile(word.slice("--body-file=".length));
    }
  }
  return refs;
}

export function findPrBodies(root: Node, startCwd: string): BodyRef[] {
  const refs: BodyRef[] = [];
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
    refs.push(...callBodies(cmd, nodes.slice(3), cwd));
  }
  return refs;
}
