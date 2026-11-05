/** Finds the body of every `gh pr create|edit` call and `gh api` PR write in a parsed Bash command. */

import path from "node:path";
import type { Node } from "./tree-sitter.js";
import { expandHome, literal, programCalls, type Parse, type ProgramCall } from "./shell-calls.js";

/** `nested` means the nodes index a re-parsed string, so their offsets do not map onto the hook's command text. A `json-*` ref holds a request payload whose `body` key is the PR body. */
export type BodyRef =
  | { kind: "inline"; cwd: string; value: Node; start: number; text: string; nested: boolean }
  | { kind: "stdin"; cwd: string; heredoc: Node; nested: boolean }
  | { kind: "file"; cwd: string; path: string }
  | { kind: "json-stdin"; cwd: string; heredoc: Node }
  | { kind: "json-file"; cwd: string; path: string };

export function stdinHeredoc(cmd: Node): Node | null {
  const parent = cmd.parent;
  const redirects = parent?.type === "redirected_statement" ? parent.childrenForFieldName("redirect") : [];
  for (const r of [...cmd.childrenForFieldName("redirect"), ...redirects]) {
    if (r?.type !== "heredoc_redirect") continue;
    return r.namedChildren.find((c: Node | null) => c?.type === "heredoc_body") ?? null;
  }
  return null;
}

function fileOrStdin({ cmd, cwd, nested }: ProgramCall, value: string | undefined): BodyRef | null {
  if (value === undefined || value === "-") {
    const heredoc = stdinHeredoc(cmd);
    return heredoc ? { kind: "stdin", cwd, heredoc, nested } : null;
  }
  return { kind: "file", cwd, path: path.resolve(cwd, expandHome(value)) };
}

function callBodies(call: ProgramCall, args: Node[]): BodyRef[] {
  const { cwd, nested } = call;
  const refs: Array<BodyRef | null> = [];
  for (let i = 0; i < args.length; i++) {
    const node = args[i] as Node;
    const word = literal(node);
    if (word === "--body" || word === "-b") {
      const value = args[++i];
      if (value) refs.push({ kind: "inline", cwd, value, start: value.startIndex, text: value.text, nested });
    } else if (node.text.startsWith("--body=")) {
      refs.push({ kind: "inline", cwd, value: node, start: node.startIndex + 7, text: node.text.slice(7), nested });
    } else if (word === "--body-file" || word === "-F") {
      const value = args[++i];
      const file = value ? literal(value) : undefined;
      if (file !== null) refs.push(fileOrStdin(call, file));
    } else if (word?.startsWith("--body-file=")) {
      refs.push(fileOrStdin(call, word.slice("--body-file=".length)));
    }
  }
  return refs.filter((r): r is BodyRef => r !== null);
}

const VALUE_FLAGS = new Set(["-X", "--method", "-f", "-F", "--field", "--raw-field", "--input", "-H", "--header", "-q", "--jq", "-t", "--template", "--hostname", "--cache", "-p", "--preview"]);
const FIELD_FLAGS = new Set(["-f", "-F", "--field", "--raw-field"]);
const READS_FILES = new Set(["-F", "--field"]);

interface ApiField { node: Node; readsFiles: boolean }
/** `input` is the `--input` value, `-` when tree-sitter dropped it before a heredoc, and null when absent or built from an expansion. */
interface ApiCall { endpoint: string | null; method: string; fields: ApiField[]; input: string | null; hasInput: boolean }

function parseApi(args: Node[]): ApiCall {
  let endpoint: string | null = null;
  let method: string | null = null;
  let input: string | null = null;
  let hasInput = false;
  const fields: ApiField[] = [];
  for (let i = 0; i < args.length; i++) {
    const node = args[i] as Node;
    const w = literal(node) ?? node.text;
    const eq = w.startsWith("--") ? w.indexOf("=") : -1;
    const flag = eq > 0 ? w.slice(0, eq) : w;
    if (/^-X./.test(w)) method = w.slice(2);
    else if (/^-[fF]./.test(w)) fields.push({ node, readsFiles: w[1] === "F" });
    else if (VALUE_FLAGS.has(flag)) {
      const valueNode = eq > 0 ? node : args[++i];
      const value = eq > 0 ? w.slice(eq + 1) : valueNode ? literal(valueNode) ?? valueNode.text : "";
      if (flag === "-X" || flag === "--method") method = value;
      if (FIELD_FLAGS.has(flag) && valueNode) fields.push({ node: valueNode, readsFiles: READS_FILES.has(flag) });
      if (flag === "--input") {
        hasInput = true;
        input = valueNode ? (eq > 0 ? value : literal(valueNode)) : "-";
      }
    } else if (!w.startsWith("-") && endpoint === null) endpoint = w;
  }
  const implied = fields.length > 0 || hasInput ? "POST" : "GET";
  return { endpoint, method: (method ?? implied).toUpperCase(), fields, input, hasInput };
}

const PULL_WRITE_ENDPOINT = /^\/?repos\/[^/]+\/[^/]+\/pulls(?:\/[^/?]+)?\/?(?:\?.*)?$/;
const BODY_FIELD = /^(["']?)(?:--(?:raw-)?field=|-[fF])?(["']?)body=/;

function apiBodies(call: ProgramCall, args: Node[]): BodyRef[] {
  const { cmd, cwd, nested } = call;
  const api = parseApi(args);
  if (api.endpoint === null || !PULL_WRITE_ENDPOINT.test(api.endpoint) || (api.method !== "PATCH" && api.method !== "POST")) return [];
  const refs: Array<BodyRef | null> = [];
  for (const { node, readsFiles } of api.fields) {
    const m = BODY_FIELD.exec(node.text);
    if (!m) continue;
    const start = m[0].length;
    const text = node.text.slice(start, m[1] || m[2] ? -1 : undefined);
    if (readsFiles && text.startsWith("@")) {
      const value = literal(node)?.slice(m[0].replace(/["']/g, "").length + 1);
      if (value !== undefined) refs.push(fileOrStdin(call, value));
    } else refs.push({ kind: "inline", cwd, value: node, start: node.startIndex + start, text, nested });
  }
  if (api.input === "-") {
    const heredoc = stdinHeredoc(cmd);
    if (heredoc) refs.push({ kind: "json-stdin", cwd, heredoc });
  } else if (api.input !== null) refs.push({ kind: "json-file", cwd, path: path.resolve(cwd, expandHome(api.input)) });
  return refs.filter((r): r is BodyRef => r !== null);
}

export function findPrBodies(root: Node, source: string, startCwd: string, parse: Parse): BodyRef[] {
  const refs: BodyRef[] = [];
  for (const call of programCalls("gh", root, source, startCwd, parse)) {
    const word = (i: number) => (call.nodes[i] ? literal(call.nodes[i] as Node) : null);
    if (word(1) === "pr" && (word(2) === "create" || word(2) === "edit")) refs.push(...callBodies(call, call.nodes.slice(3)));
    else if (word(1) === "api") refs.push(...apiBodies(call, call.nodes.slice(2)));
  }
  return refs;
}

const ISSUE_COMMENTS = /^\/?repos\/[^/]+\/[^/]+\/issues\/[^/]+\/comments\/?(?:\?.*)?$/;

/** Whether a `gh api` call POSTs to `repos/<o>/<r>/issues/<n>/comments`, which is how gh posts a top-level PR comment. */
function postsIssueComment(args: Node[]): boolean {
  const { endpoint, method } = parseApi(args);
  return endpoint !== null && ISSUE_COMMENTS.test(endpoint) && method === "POST";
}

/** The cwd of every top-level PR comment: `gh pr comment`, or a `gh api` POST to an issue's comments. */
export function findPrComments(root: Node, source: string, startCwd: string, parse: Parse): string[] {
  const cwds: string[] = [];
  for (const { nodes, cwd } of programCalls("gh", root, source, startCwd, parse)) {
    const word = (i: number) => (nodes[i] ? literal(nodes[i] as Node) : null);
    if ((word(1) === "pr" && word(2) === "comment") || (word(1) === "api" && postsIssueComment(nodes.slice(2)))) cwds.push(cwd);
  }
  return cwds;
}
