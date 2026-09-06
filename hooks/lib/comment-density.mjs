// check-comments-exempt — hook lib; comment-density metric
/**
 * comment-density.mjs — per-file and aggregate comment-density analysis.
 *
 * Divergences from the pilot script (check-comment-density.mjs):
 *   - Counts shebang lines (#!, line 1) as comment lines; pilot skips them
 *   - Counts // @ts- and //@ts- directives; pilot skips them
 *   - Counts inline trailing // after code; pilot does not detect inline comments
 *   - Counts Python docstrings and Ruby =begin/=end blocks; pilot ignores these languages
 *
 * Uses only Node.js built-ins (crypto, path). ESM exports only.
 */

import { createHash } from 'crypto';
import { basename, extname } from 'path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Per-file cap: 5 comment lines per 100 total lines. */
export const FILE_CAP = 5;

/** Aggregate cap: 2 comment lines per 100 total lines. */
export const AGGREGATE_CAP = 2;

// ---------------------------------------------------------------------------
// Language table
// ---------------------------------------------------------------------------

/**
 * Language configuration keyed by file extension.
 * @type {Record<string, {lineComment: string, blockOpen?: string, blockClose?: string, jsxBlock?: boolean, tripleQuote?: boolean, rubyBlock?: boolean}>}
 */
export const LANGUAGE_TABLE = {
  '.ts':   { lineComment: '//', blockOpen: '/*', blockClose: '*/', jsxBlock: true },
  '.tsx':  { lineComment: '//', blockOpen: '/*', blockClose: '*/', jsxBlock: true },
  '.js':   { lineComment: '//', blockOpen: '/*', blockClose: '*/', jsxBlock: false },
  '.mjs':  { lineComment: '//', blockOpen: '/*', blockClose: '*/', jsxBlock: false },
  '.go':   { lineComment: '//', blockOpen: '/*', blockClose: '*/' },
  '.rs':   { lineComment: '//', blockOpen: '/*', blockClose: '*/' },
  '.java': { lineComment: '//', blockOpen: '/*', blockClose: '*/' },
  '.py':   { lineComment: '#', tripleQuote: true },
  '.rb':   { lineComment: '#', rubyBlock: true },
  '.sh':   { lineComment: '#' },
  '.bash': { lineComment: '#' },
};

// ---------------------------------------------------------------------------
// SHA-1 cache
// ---------------------------------------------------------------------------

/** @type {Map<string, object>} */
const _cache = new Map();

/**
 * @param {string} content
 * @returns {string}
 */
function sha1(content) {
  return createHash('sha1').update(content).digest('hex');
}

// ---------------------------------------------------------------------------
// Gitattributes pattern matching (simple glob: only * wildcard)
// ---------------------------------------------------------------------------

/**
 * Match a file path against a gitattributes pattern.
 * Supports bare `*` glob and exact match (basename or full path).
 * @param {string} filePath
 * @param {string} pattern
 * @returns {boolean}
 */
function matchGitattributesPattern(filePath, pattern) {
  const base = basename(filePath);
  // Convert glob pattern to regex: only * is supported
  const toRegex = (p) => {
    const escaped = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`);
  };
  const re = toRegex(pattern);
  return re.test(filePath) || re.test(base);
}

// ---------------------------------------------------------------------------
// isExcluded
// ---------------------------------------------------------------------------

/** Lockfile basenames. */
const LOCKFILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'pnpm-lock.yml',
  'Cargo.lock', 'go.sum', 'Gemfile.lock', 'composer.lock',
]);

/** Data-file extensions. */
const DATA_EXTS = new Set(['.json', '.yaml', '.yml', '.toml']);

/**
 * Returns true if the file at `filePath` should be excluded from analysis.
 * Checks D-8 patterns and optionally parses gitattributesText for linguist-generated=true.
 *
 * @param {string} filePath
 * @param {{ gitattributesText?: string }} [opts]
 * @returns {boolean}
 */
export function isExcluded(filePath, opts = {}) {
  return !!_excludeReason(filePath, opts);
}

/**
 * Returns the exclusion reason string, or null if not excluded.
 * @param {string} filePath
 * @param {{ gitattributesText?: string }} [opts]
 * @returns {string|null}
 */
function _excludeReason(filePath, opts = {}) {
  if (filePath.includes('/node_modules/') || filePath.startsWith('node_modules/')) return 'node_modules';
  if (filePath.includes('/dist/')         || filePath.startsWith('dist/'))         return 'dist';
  if (filePath.includes('/build/')        || filePath.startsWith('build/'))        return 'build';
  if (filePath.includes('/vendor/')       || filePath.startsWith('vendor/'))       return 'vendor';
  if (filePath.includes('/migrations/')   || filePath.startsWith('migrations/'))   return 'migrations';

  const base = basename(filePath);
  if (base.endsWith('.pb.go'))             return 'generated';
  if (base.endsWith('.gen.ts'))            return 'generated';
  // .d.ts but NOT .d.mts
  if (base.endsWith('.d.ts') && !base.endsWith('.d.mts')) return 'generated';

  const ext = extname(filePath);
  if (DATA_EXTS.has(ext))                 return 'data-file';
  if (LOCKFILES.has(base))                return 'lockfile';

  if (opts.gitattributesText) {
    for (const raw of opts.gitattributesText.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const [pattern, ...attrs] = line.split(/\s+/);
      if (!pattern) continue;
      const attrStr = attrs.join(' ');
      const isLinguistGenerated =
        attrStr.includes('linguist-generated=true') ||
        /(?:^|\s)linguist-generated(?:\s|$)/.test(attrStr);
      if (isLinguistGenerated && matchGitattributesPattern(filePath, pattern)) {
        return 'linguist-generated';
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// String-aware inline comment scanner (C-family, used for trailing // and #)
// ---------------------------------------------------------------------------

/**
 * Returns true if a trailing `//` (or `#` for hash-comment langs) exists
 * outside of string literals on this line.
 *
 * @param {string} line
 * @param {string} marker  '//' or '#'
 * @returns {boolean}
 */
function hasInlineComment(line, marker) {
  const m0 = marker[0];
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false; // backtick

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const prev = i > 0 ? line[i - 1] : '';

    // Handle escape sequences inside strings
    if (prev === '\\' && (inSingle || inDouble || inTemplate)) continue;

    if (!inDouble && !inTemplate && ch === "'") { inSingle = !inSingle; continue; }
    if (!inSingle && !inTemplate && ch === '"') { inDouble = !inDouble; continue; }
    if (!inSingle && !inDouble && ch === '`')   { inTemplate = !inTemplate; continue; }

    if (inSingle || inDouble || inTemplate) continue;

    // Check for marker
    if (marker === '//' && ch === '/' && line[i + 1] === '/') return true;
    if (marker === '#'  && ch === '#') return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Per-language line classifiers
// ---------------------------------------------------------------------------

/**
 * Classify lines for C-family languages (TS, JS, Go, Rust, Java, etc.)
 * Returns array of booleans (true = comment line), 0-based.
 *
 * @param {string[]} lines
 * @param {boolean} jsxBlock
 * @returns {boolean[]}
 */
function classifyCFamily(lines, jsxBlock) {
  const result = new Array(lines.length).fill(false);
  let inBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (inBlock) {
      result[i] = true;
      if (trimmed.includes('*/')) inBlock = false;
      continue;
    }

    // Block comment open
    if (trimmed.startsWith('/*') || trimmed.startsWith('/**')) {
      result[i] = true;
      const afterOpen = trimmed.slice(2);
      if (!afterOpen.includes('*/')) inBlock = true;
      continue;
    }

    // JSX block comment {/* ... */}
    if (jsxBlock && trimmed.startsWith('{/*')) {
      result[i] = true;
      if (!trimmed.slice(3).includes('*/')) inBlock = true;
      continue;
    }

    // Line comment (covers ///, //!, //@ts-, // @ts-, etc.)
    if (trimmed.startsWith('//')) {
      result[i] = true;
      continue;
    }

    // Inline trailing //
    if (hasInlineComment(lines[i], '//')) {
      result[i] = true;
      continue;
    }
  }

  return result;
}

/**
 * Classify lines for Python.
 * @param {string[]} lines
 * @returns {boolean[]}
 */
function classifyPython(lines) {
  const result = new Array(lines.length).fill(false);
  let inTriple = false;
  let tripleChar = ''; // '"' or "'"

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (inTriple) {
      result[i] = true;
      // Detect close: look for the triple-quote that opened
      const closeMarker = tripleChar.repeat(3);
      if (trimmed.includes(closeMarker)) inTriple = false;
      continue;
    }

    // Detect triple-quote open on this line
    const dqIdx = trimmed.indexOf('"""');
    const sqIdx = trimmed.indexOf("'''");
    let tripleIdx = -1;
    let tChar = '';
    if (dqIdx !== -1 && (sqIdx === -1 || dqIdx <= sqIdx)) { tripleIdx = dqIdx; tChar = '"'; }
    else if (sqIdx !== -1) { tripleIdx = sqIdx; tChar = "'"; }

    if (tripleIdx !== -1) {
      result[i] = true;
      const closeMarker = tChar.repeat(3);
      const afterOpen = trimmed.slice(tripleIdx + 3);
      if (!afterOpen.includes(closeMarker)) {
        inTriple = true;
        tripleChar = tChar;
      }
      // single-line docstring: open and close on same line → stay false
      continue;
    }

    // Line comment
    if (trimmed.startsWith('#')) {
      result[i] = true;
      continue;
    }

    // Inline #
    if (hasInlineComment(lines[i], '#')) {
      result[i] = true;
    }
  }

  return result;
}

/**
 * Classify lines for Ruby.
 * @param {string[]} lines
 * @returns {boolean[]}
 */
function classifyRuby(lines) {
  const result = new Array(lines.length).fill(false);
  let inBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (trimmed === '=begin') { inBlock = true; result[i] = true; continue; }
    if (inBlock) {
      result[i] = true;
      if (trimmed === '=end') inBlock = false;
      continue;
    }

    if (trimmed.startsWith('#')) { result[i] = true; continue; }

    if (hasInlineComment(lines[i], '#')) { result[i] = true; }
  }

  return result;
}

/**
 * Classify lines for Shell.
 * @param {string[]} lines
 * @returns {boolean[]}
 */
function classifyShell(lines) {
  const result = new Array(lines.length).fill(false);

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (trimmed.startsWith('#')) { result[i] = true; continue; }

    if (hasInlineComment(lines[i], '#')) { result[i] = true; }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Core analysis
// ---------------------------------------------------------------------------

/**
 * Analyze a single file. Uses SHA-1 cache keyed on content.
 *
 * @param {string} filePath
 * @param {string} content
 * @param {{ gitattributesText?: string }} [opts]
 * @returns {{
 *   path: string,
 *   totalLines: number,
 *   commentLines: number,
 *   commentsPer100: number,
 *   lines: number[],
 *   excluded: boolean,
 *   excludedReason?: string,
 *   fromCache?: boolean,
 * }}
 */
export function analyzeFile(filePath, content, opts = {}) {
  const hash = sha1(content);
  if (_cache.has(hash)) {
    return { ..._cache.get(hash), fromCache: true };
  }

  const reason = _excludeReason(filePath, opts);
  if (reason) {
    const result = {
      path: filePath,
      totalLines: 0,
      commentLines: 0,
      commentsPer100: 0,
      lines: [],
      excluded: true,
      excludedReason: reason,
    };
    _cache.set(hash, result);
    return result;
  }

  const ext = extname(filePath);
  const lang = LANGUAGE_TABLE[ext];
  const rawLines = content.split('\n');
  const total = rawLines.length;

  let flags;
  if (!lang) {
    // Unknown language: no comment lines
    flags = new Array(total).fill(false);
  } else if (lang.tripleQuote) {
    flags = classifyPython(rawLines);
  } else if (lang.rubyBlock) {
    flags = classifyRuby(rawLines);
  } else if (lang.lineComment === '#') {
    flags = classifyShell(rawLines);
  } else {
    flags = classifyCFamily(rawLines, !!lang.jsxBlock);
  }

  const commentLineNums = [];
  for (let i = 0; i < flags.length; i++) {
    if (flags[i]) commentLineNums.push(i + 1); // 1-based
  }

  const commentCount = commentLineNums.length;
  const per100 = total === 0 ? 0 : (commentCount / total) * 100;

  const result = {
    path: filePath,
    totalLines: total,
    commentLines: commentCount,
    commentsPer100: per100,
    lines: commentLineNums,
    excluded: false,
  };

  _cache.set(hash, result);
  return result;
}

/**
 * Analyze multiple files.
 *
 * @param {Array<{path: string, content: string}>} entries
 * @param {{ gitattributesText?: string }} [opts]
 * @returns {{ files: object[], aggregatePer100: number }}
 */
export function analyzeFiles(entries, opts = {}) {
  const files = entries.map(({ path, content }) => analyzeFile(path, content, opts));

  let totalLines = 0;
  let totalComment = 0;
  for (const f of files) {
    if (!f.excluded) {
      totalLines += f.totalLines;
      totalComment += f.commentLines;
    }
  }

  const aggregatePer100 = totalLines === 0 ? 0 : (totalComment / totalLines) * 100;
  return { files, aggregatePer100 };
}
