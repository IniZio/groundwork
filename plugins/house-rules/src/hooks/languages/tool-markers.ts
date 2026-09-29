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
  /(?:^|#\s*)noqa\b/i,
  /(?:^|#\s*)type:/,
  /(?:^|#\s*)nosec\b/,
  /(?:^|#\s*)pragma:/i,
  /(?:^|#\s*)pylint:/,
  /(?:^|#\s*)pyright:/,
  /^fmt:\s*(?:off|on)\b/,
  /(?:^|#\s*)fmt:\s*skip\b/,
  /(?:^|#\s*)isort:\s*(?:skip(?:_file)?|off|on)\b/,
  /^mypy:/,
  /^flake8:\s*noqa\b/,
  /^ruff:\s*noqa\b/,
  /^pyre-(?:ignore|fixme|strict)\b/,
];

/**
 * PEP 263 encoding declaration pattern.
 * Only honoured by CPython on lines 1–2 of the file (rows 0–1, 0-indexed).
 * Kept separate from PYTHON_TOOL_MARKERS so it can be applied with a row guard.
 * https://peps.python.org/pep-0263/
 */
export const PEP263_CODING_RE = /coding[:=]\s*[-\w.]+/;

const _pythonBase = withToolMarkers(PYTHON_TOOL_MARKERS);

export const BASH_TOOL_MARKERS: readonly RegExp[] = [
  /^shellcheck\b/,
  /^(?:vim?|ex):/,
  /^-\*-.*-\*-$/,
];

export const YAML_TOOL_MARKERS: readonly RegExp[] = [/^yaml-language-server:/];

export const KOTLIN_TOOL_MARKERS: readonly RegExp[] = [
  /^noinspection\b/,
  /^<\/?editor-fold\b/,
  /^language=\S/,
  /^spotless:(?:off|on)\b/,
  /^ktlint-(?:disable|enable)\b/,
];

export const SWIFT_TOOL_MARKERS: readonly RegExp[] = [
  /^swift-tools-version\s*:/i,
  /^swiftlint:(?:disable|enable)\b/,
  /^swift-format-ignore(?:-file)?\b/,
  /^swiftformat:(?:disable|enable|options|sort)\b/,
  /^periphery:ignore\b/,
  /^sourcery:/,
  /^MARK:/,
];

export const JAVA_TOOL_MARKERS: readonly RegExp[] = [
  /^NOSONAR\b/,
  /^NOPMD\b/,
  /^CHECKSTYLE(?::(?:OFF|ON)\b|\.(?:OFF|ON):)/,
  /^@formatter:(?:off|on)\b/,
  /^noinspection\b/,
  /^\$NON-NLS-\d+\$/,
  /^spotless:(?:off|on)\b/,
  /^CPD-(?:OFF|ON)\b/,
  /^(?:file )?deepcode ignore\b/,
  /^nosemgrep\b/,
  /^falls?[ -]?thr(?:u|ough)\b/,
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

export const classifyPythonComments: CommentClassifier = (raw, root, text) => {
  const classified = _pythonBase(raw, root, text);
  return classified.map((c) => {
    if (c.directive) return c;
    if (c.startRow > 1) return c;
    const inner = commentInnerText(c.text.split("\n")[0]);
    if (PEP263_CODING_RE.test(inner)) {
      return { ...c, directive: true, label: inner.slice(0, 30) };
    }
    return c;
  });
};
