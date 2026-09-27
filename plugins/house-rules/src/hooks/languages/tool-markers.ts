// Per-language lint-tool marker lists and classifier factory.
import type { CommentClassifier } from "./comments.js";
import {
  commentInnerText,
  defaultClassifyComments,
  isShebangComment,
  isJsDocBlock,
} from "./comments.js";

export const TYPESCRIPT_TOOL_MARKERS: readonly RegExp[] = [
  /^eslint-(?:disable|enable)/,
  /^prettier-ignore/,
  /^biome-ignore/,
  /^\/\s*<reference\b/,
];

export const PYTHON_TOOL_MARKERS: readonly RegExp[] = [
  /^noqa\b/,
  /^type:\s*ignore/,
  /^pylint:/,
  /^pragma:/i,
];

export const BASH_TOOL_MARKERS: readonly RegExp[] = [/^shellcheck\b/];

export const YAML_TOOL_MARKERS: readonly RegExp[] = [/^yaml-language-server:/];

export function withToolMarkers(
  markers: readonly RegExp[],
  base: CommentClassifier = defaultClassifyComments,
): CommentClassifier {
  return (raw, root, text) => {
    const classified = base(raw, root, text);
    return classified.map((c) => {
      if (c.label !== undefined) return c;
      if (isShebangComment(c)) return c;
      if (c.nodeType.includes("doc")) return c;
      if (isJsDocBlock(c.text)) return c;

      const innerLines = c.text.split("\n").map(commentInnerText).filter(Boolean);
      if (innerLines.length === 0) return c;

      const isBlock = c.text.trimStart().startsWith("/*");
      let matched = false;
      if (isBlock) {
        matched = innerLines.every((ln) => markers.some((re) => re.test(ln)));
      } else {
        matched = markers.some((re) => re.test(innerLines[0]));
      }

      if (!matched) return c;
      return { ...c, directive: true, label: innerLines[0].slice(0, 30) };
    });
  };
}
