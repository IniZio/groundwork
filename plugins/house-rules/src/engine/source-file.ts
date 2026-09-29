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

let defaultFactory: ParserFactory = getParser;

export function setDefaultParserFactory(f: ParserFactory): void {
  defaultFactory = f;
}

export function getDefaultParserFactory(): ParserFactory {
  return defaultFactory;
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

export function createSourceFiles(factoryArg?: ParserFactory): SourceFiles {
  const factory = factoryArg ?? defaultFactory;
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
