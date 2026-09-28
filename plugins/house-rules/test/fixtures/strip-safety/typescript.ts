// @ts-nocheck
// strip-safety: removed=11
// source: plugins/house-rules/src/hooks/lib/comment-density.ts (HEAD) lines 1-100
/// <reference types="node" />

/* eslint-disable no-console */

import type { Node } from "../lib/tree-sitter.js";
import path from "node:path";

/**
 * Represents a single comment found in a source file.
 * Each comment carries its text, position, and classification metadata.
 */
export interface Comment {
  startIndex: number;
  endIndex: number;
  startRow: number;
  endRow: number;
  text: string;
  exempt: boolean;
}

// This function checks whether a node is a comment node.
// The check inspects the node type string for the word "comment".
function isCommentNode(node: Node): boolean {
  return node.type.includes("comment"); // node type check
}

// prettier-ignore
const DIVIDER_RE = /^(?:[─-╿━═]{2,}|[-=#*~_]{4,})$/u;

/**
 * Strips the leading marker characters from a comment line.
 * Works for both block and line comment styles.
 */
function stripMarkers(line: string): string {
  // Remove the comment delimiters, then trim whitespace.
  let t = line.trim();
  if (t.startsWith("/**")) t = t.slice(3);
  else if (t.startsWith("/*")) t = t.slice(2); // block comment start
  else if (t.startsWith("//")) t = t.slice(2); // line comment prefix
  if (t.endsWith("*/")) t = t.slice(0, -2); // strip block comment end
  return t.trim();
}

/*
 * This multi-line block describes the exemption logic used by the density gate.
 * A comment is exempt when it carries a directive, URL, annotation tag,
 * or when every inner line is itself recognized as exempt content.
 */
function isExemptInner(inner: string): boolean {
  // Check annotation tags first, since they begin with @.
  return inner.startsWith("@") || inner.startsWith("http");
}

// eslint-enable no-console

// biome-ignore lint/style/useConst: mutable for test purposes
let counter = 0;

/**
 * Increments the global counter and returns the new value.
 * Safe to call from multiple places; uses a module-level variable.
 */
function increment(): number {
  counter += 1; // bump counter by one
  return counter;
}

// Resolve the given path relative to the fixed project root directory.
function resolvePath(p: string): string {
  return path.resolve("/project", p);
}

// Format the result as a pretty-printed JSON string for downstream use.
function formatOutput(data: unknown): string {
  return JSON.stringify(data, null, 2);
}
