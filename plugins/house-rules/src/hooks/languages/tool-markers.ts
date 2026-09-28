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
  /^@ts-(?:ignore|expect-error|nocheck|check)\b/,
  /^[#@]__(?:PURE|NO_SIDE_EFFECTS)__/,
  /^@(?:license|preserve)\b/,
  /^(?:istanbul|c8) ignore\b/,
  /^webpack(?:ChunkName|Prefetch|Preload|Mode|Ignore|Exports)\b/,
  /^@vite-ignore\b/,
  /^[#@] source(?:Mapping)?URL=/,
];

export const PYTHON_TOOL_MARKERS: readonly RegExp[] = [
  /^noqa\b/,
  /^type:\s*ignore/,
  /^pylint:/,
  /^pragma:/i,
];

export const BASH_TOOL_MARKERS: readonly RegExp[] = [/^shellcheck\b/];

export const YAML_TOOL_MARKERS: readonly RegExp[] = [/^yaml-language-server:/];

export const SWIFT_TOOL_MARKERS: readonly RegExp[] = [
  /^swift-tools-version\s*:/i,
  /^swiftlint:(?:disable|enable)\b/,
  /^swift-format-ignore(?:-file)?\b/,
  /^swiftformat:(?:disable|enable|options|sort)\b/,
  /^periphery:ignore\b/,
  /^sourcery:/,
  /^MARK:/,
];

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

      const rawTrimmed = c.text.trimStart();
      if (rawTrimmed.startsWith("/*!")) {
        return { ...c, directive: true, label: "license-banner" };
      }

      if (rawTrimmed.startsWith("/*")) {
        const LICENSE_RE = /^@(?:license|preserve)\b/;
        if (innerLines.some((ln) => LICENSE_RE.test(ln))) {
          return { ...c, directive: true, label: innerLines[0].slice(0, 30) };
        }
        // Every inner line must match a marker for the block to be directive.
        const matched = innerLines.every((ln) => markers.some((re) => re.test(ln)));
        if (!matched) return c;
        return { ...c, directive: true, label: innerLines[0].slice(0, 30) };
      }

      const matched = markers.some((re) => re.test(innerLines[0]));
      if (!matched) return c;
      return { ...c, directive: true, label: innerLines[0].slice(0, 30) };
    });
  };
}
