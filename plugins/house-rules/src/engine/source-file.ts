import type { Tree } from "../hooks/lib/tree-sitter.js";
import { getParser } from "../hooks/lib/tree-sitter-loader.js";
import type { Language } from "../hooks/languages/registry.js";
import {
  parseText,
  collectRawComments,
  type ParserFactory,
  type RawComment,
} from "../hooks/languages/parse.js";

export interface SourceFile {
  language: Language;
  text: string;
  tree: Tree;
  comments: RawComment[];
  errorRows: Set<number>;
}

export type SourceFileResult =
  | { ok: true; source: SourceFile }
  | { ok: false; reason: string };

export interface SourceFiles {
  get(lang: Language, text: string): Promise<SourceFileResult>;
  dispose(): void;
}

export function createSourceFiles(factory: ParserFactory = getParser): SourceFiles {
  const cache = new Map<string, Promise<SourceFileResult>>();

  return {
    get(lang: Language, text: string): Promise<SourceFileResult> {
      const key = `${lang}\u0000${text}`;
      const existing = cache.get(key);
      if (existing) return existing;

      const promise = parseText(text, lang, factory).then(
        (result): SourceFileResult => {
          if (!result.ok) return { ok: false, reason: result.reason };
          const comments = collectRawComments(result.tree.rootNode, text, lang);
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
        promise.then((result) => {
          if (result.ok) result.source.tree.delete();
        });
      }
      cache.clear();
    },
  };
}
