import type { Node } from "../lib/tree-sitter.js";
import type { RawComment } from "./parse.js";
import {
  type ClassifiedComment,
  type CommentClassifier,
  commentInnerText,
  defaultClassifyComments,
} from "./comments.js";

/**
 * Matches TOML schema directives used by taplo / Even Better TOML:
 * `#:schema <url>` tells the language server which JSON schema applies.
 * Any comment line whose inner text begins with `:schema` is treated as a
 * directive, preserving the comment from density-rule removal.
 */
const TOML_SCHEMA_RE = /^:schema\b/;

export const classifyTomlComments: CommentClassifier = (
  raw: readonly RawComment[],
  root: Node,
  text: string,
): ClassifiedComment[] =>
  defaultClassifyComments(raw, root, text).map((c) =>
    c.text.split("\n").some((l) => TOML_SCHEMA_RE.test(commentInnerText(l)))
      ? { ...c, directive: true }
      : c,
  );
