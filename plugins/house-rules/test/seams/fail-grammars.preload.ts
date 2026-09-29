import { getDefaultParserFactory, setDefaultParserFactory } from '../../src/engine/source-file.js';
import type { ParserFactory } from '../../src/hooks/languages/parse.js';

const forced = new Set(
  (process.env.HOUSE_RULES_TEST_FAIL_GRAMMARS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

if (forced.size > 0) {
  const previous = getDefaultParserFactory();
  const wrapped: ParserFactory = async (lang, variant) =>
    forced.has(lang)
      ? { ok: false, reason: 'forced by HOUSE_RULES_TEST_FAIL_GRAMMARS' }
      : previous(lang, variant);
  setDefaultParserFactory(wrapped);
}
