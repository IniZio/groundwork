import type { Tree } from "../hooks/lib/tree-sitter.js";
import { getParser } from "../hooks/lib/tree-sitter-loader.js";
import type { Language } from "../hooks/languages/registry.js";
import { grammarVariantForPath } from "../hooks/languages/registry.js";
import type { ClassifiedComment } from "../hooks/languages/comments.js";
import {
  parseText,
  classifyComments,
  type ParserFactory,
} from "../hooks/languages/parse.js";

export const FAIL_GRAMMARS_ENV = "HOUSE_RULES_TEST_FAIL_GRAMMARS";

/**
 * Test seam used by by-path CLI/gate tests.
 *
 * If env[FAIL_GRAMMARS_ENV] is unset/empty, returns `base` itself (identity,
 * so behaviour is byte-identical to passing `base` directly).
 * Otherwise the value is treated as a comma-separated list of Language ids;
 * the returned factory resolves `{ ok: false, reason: "forced by HOUSE_RULES_TEST_FAIL_GRAMMARS" }`
 * for listed languages and delegates to `base` for all others.
 */
export function envParserFactory(
  env: Record<string, string | undefined> = process.env,
  base: ParserFactory = getParser,
): ParserFactory {
  const raw = env[FAIL_GRAMMARS_ENV];
  if (!raw) return base;
  const forced = new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
  return async (lang, variant) => {
    if (forced.has(lang)) {
      return { ok: false, reason: "forced by HOUSE_RULES_TEST_FAIL_GRAMMARS" };
    }
    return base(lang, variant);
  };
}

export interface SourceFile {
  language: Language;
  text: string;
  tree: Tree;
  comments: ClassifiedComment[];
  errorRows: Set<number>;
}

export type SourceFileResult =
  | { ok: true; source: SourceFile }
  | { ok: false; reason: string };

export interface SourceFiles {
  get(lang: Language, text: string, filePath?: string): Promise<SourceFileResult>;
  dispose(): void;
}

export function createSourceFiles(factory: ParserFactory = envParserFactory()): SourceFiles {
  const cache = new Map<string, Promise<SourceFileResult>>();

  return {
    get(lang: Language, text: string, filePath?: string): Promise<SourceFileResult> {
      const variant = filePath ? grammarVariantForPath(lang, filePath) : undefined;
      const key = `${lang}\u0000${variant ?? ""}\u0000${text}`;
      const existing = cache.get(key);
      if (existing) return existing;

      const promise = parseText(text, lang, (l) => factory(l, variant)).then(
        (result): SourceFileResult => {
          if (!result.ok) return { ok: false, reason: result.reason };
          const comments = classifyComments(result.tree.rootNode, text, lang);
          const source: SourceFile = {
            language: lang,
            text,
            tree: result.tree,
            comments,
            errorRows: result.errorRows,
          };
          return { ok: true, source };
        },
      );

      cache.set(key, promise);
      return promise;
    },

    dispose(): void {
      for (const promise of cache.values()) {
        promise.then(
          (result) => { if (result.ok) result.source.tree.delete(); },
          () => {},
        );
      }
      cache.clear();
    },
  };
}
