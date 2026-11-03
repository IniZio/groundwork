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

interface GhCall { cmd: Node; nodes: Node[]; cwd: string }

/** Every `gh <sub> ...` command in the tree, with launchers stripped and `cd` tracked. `nodes[0]` is `gh`. */
function ghCalls(root: Node, startCwd: string): GhCall[] {
  const calls: GhCall[] = [];
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
    if (head !== null && path.basename(head) === "gh") calls.push({ cmd, nodes, cwd });
  }
  return calls;
}

export function findPrBodies(root: Node, startCwd: string): BodyRef[] {
  const refs: BodyRef[] = [];
  for (const { cmd, nodes, cwd } of ghCalls(root, startCwd)) {
    const word = (i: number) => (nodes[i] ? literal(nodes[i] as Node) : null);
    if (word(1) !== "pr" || (word(2) !== "create" && word(2) !== "edit")) continue;
    refs.push(...callBodies(cmd, nodes.slice(3), cwd));
  }
  return refs;
}

const ISSUE_COMMENTS = /^\/?repos\/[^/]+\/[^/]+\/issues\/[^/]+\/comments\/?(?:\?.*)?$/;
const VALUE_FLAGS = new Set(["-X", "--method", "-f", "-F", "--field", "--raw-field", "--input", "-H", "--header", "-q", "--jq", "-t", "--template", "--hostname", "--cache", "-p", "--preview"]);
const BODY_FLAGS = new Set(["-f", "-F", "--field", "--raw-field", "--input"]);

/** Whether a `gh api` call POSTs to `repos/<o>/<r>/issues/<n>/comments`, which is how gh posts a top-level PR comment. */
function postsIssueComment(args: Node[]): boolean {
  let endpoint: string | null = null;
  let method: string | null = null;
  let implied = false;
  for (let i = 0; i < args.length; i++) {
    const w = literal(args[i] as Node) ?? (args[i] as Node).text;
    const eq = w.startsWith("--") ? w.indexOf("=") : -1;
    const flag = eq > 0 ? w.slice(0, eq) : w;
    const attached = eq > 0 ? w.slice(eq + 1) : undefined;
    if (/^-X./.test(w)) method = w.slice(2);
    else if (VALUE_FLAGS.has(flag)) {
      const value = attached ?? (args[++i] ? literal(args[i] as Node) ?? (args[i] as Node).text : "");
      if (flag === "-X" || flag === "--method") method = value;
      if (BODY_FLAGS.has(flag)) implied = true;
    } else if (!w.startsWith("-") && endpoint === null) endpoint = w;
  }
  if (endpoint === null || !ISSUE_COMMENTS.test(endpoint)) return false;
  return (method ?? (implied ? "POST" : "GET")).toUpperCase() === "POST";
}

/** The cwd of every top-level PR comment: `gh pr comment`, or a `gh api` POST to an issue's comments. */
export function findPrComments(root: Node, startCwd: string): string[] {
  const cwds: string[] = [];
  for (const { nodes, cwd } of ghCalls(root, startCwd)) {
    const word = (i: number) => (nodes[i] ? literal(nodes[i] as Node) : null);
    if ((word(1) === "pr" && word(2) === "comment") || (word(1) === "api" && postsIssueComment(nodes.slice(2)))) cwds.push(cwd);
  }
  return cwds;
}
