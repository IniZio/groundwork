// check-comments-exempt
import { createHash } from 'crypto';
import { basename, extname } from 'path';

/** Per-file cap: 5 comment lines per 100 total lines. */
export const FILE_CAP = 5;

/** Aggregate cap: 2 comment lines per 100 total lines. */
export const AGGREGATE_CAP = 2;

/** Language configuration keyed by file extension. */
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

const _cache = new Map();

function sha1(content) {
  return createHash('sha1').update(content).digest('hex');
}

function matchGitattributesPattern(filePath, pattern) {
  const base = basename(filePath);
  const toRegex = (p) => {
    const escaped = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`);
  };
  const re = toRegex(pattern);
  return re.test(filePath) || re.test(base);
}

const LOCKFILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'pnpm-lock.yml',
  'Cargo.lock', 'go.sum', 'Gemfile.lock', 'composer.lock',
]);

const DATA_EXTS = new Set(['.json', '.yaml', '.yml', '.toml']);

/** Returns true if the file should be excluded from analysis. */
export function isExcluded(filePath, opts = {}) {
  return !!_excludeReason(filePath, opts);
}

function _excludeReason(filePath, opts = {}) {
  if (filePath.includes('/node_modules/') || filePath.startsWith('node_modules/')) return 'node_modules';
  if (filePath.includes('/dist/')         || filePath.startsWith('dist/'))         return 'dist';
  if (filePath.includes('/build/')        || filePath.startsWith('build/'))        return 'build';
  if (filePath.includes('/vendor/')       || filePath.startsWith('vendor/'))       return 'vendor';
  if (filePath.includes('/migrations/')   || filePath.startsWith('migrations/'))   return 'migrations';
  if (filePath.includes('/test/fixtures/') || filePath.startsWith('test/fixtures/')) return 'fixture-corpus';
  if (filePath.includes('/__fixtures__/')  || filePath.startsWith('__fixtures__/'))  return 'fixture-corpus';

  const base = basename(filePath);
  if (base.endsWith('.pb.go'))             return 'generated';
  if (base.endsWith('.gen.ts'))            return 'generated';
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

function hasInlineComment(line, marker) {
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false; // backtick

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const prev = i > 0 ? line[i - 1] : '';

    if (prev === '\\' && (inSingle || inDouble || inTemplate)) continue;

    if (!inDouble && !inTemplate && ch === "'") { inSingle = !inSingle; continue; }
    if (!inSingle && !inTemplate && ch === '"') { inDouble = !inDouble; continue; }
    if (!inSingle && !inDouble && ch === '`')   { inTemplate = !inTemplate; continue; }

    if (inSingle || inDouble || inTemplate) continue;

    if (marker === '//' && ch === '/' && line[i + 1] === '/') return true;
    if (marker === '#'  && ch === '#') return true;
  }
  return false;
}

function _advanceTemplateState(line, inTemplateLit, templateDepth) {
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const prev = i > 0 ? line[i - 1] : '';

    if (prev === '\\' && (inSingle || inDouble || (inTemplateLit && templateDepth === 0))) continue;

    if (inSingle) { if (ch === "'") inSingle = false; continue; }
    if (inDouble) { if (ch === '"') inDouble = false; continue; }

    if (inTemplateLit && templateDepth === 0) {
      // Inside template literal body
      if (ch === '`') { inTemplateLit = false; continue; }
      if (ch === '$' && line[i + 1] === '{') { templateDepth++; i++; continue; }
      continue;
    }

    // Regular code or inside ${…} interpolation
    if (ch === "'") { inSingle = true; continue; }
    if (ch === '"') { inDouble = true; continue; }
    if (ch === '`') { inTemplateLit = true; continue; }

    if (inTemplateLit && templateDepth > 0) {
      if (ch === '}') { templateDepth = Math.max(0, templateDepth - 1); continue; }
      if (ch === '{') { templateDepth++; continue; }
    }

    // Rest of line is a comment — no template state can change after //
    if (ch === '/' && i + 1 < line.length && line[i + 1] === '/') break;
  }

  return { inTemplateLit, templateDepth };
}

function classifyCFamily(lines, jsxBlock) {
  const result = new Array(lines.length).fill(false);
  let inBlock = false;
  let inTemplateLit = false;
  let templateDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (inBlock) {
      result[i] = true;
      if (trimmed.includes('*/')) inBlock = false;
      continue;
    }

    if (inTemplateLit && templateDepth === 0) {
      ({ inTemplateLit, templateDepth } = _advanceTemplateState(lines[i], inTemplateLit, templateDepth));
      continue;
    }

    if (trimmed.startsWith('/*') || trimmed.startsWith('/**')) {
      result[i] = true;
      const afterOpen = trimmed.slice(2);
      if (!afterOpen.includes('*/')) inBlock = true;
      continue;
    }

    if (jsxBlock && trimmed.startsWith('{/*')) {
      result[i] = true;
      if (!trimmed.slice(3).includes('*/')) inBlock = true;
      continue;
    }

    if (trimmed.startsWith('//')) {
      result[i] = true;
      continue;
    }

    if (hasInlineComment(lines[i], '//')) {
      result[i] = true;
    }

    ({ inTemplateLit, templateDepth } = _advanceTemplateState(lines[i], inTemplateLit, templateDepth));
  }

  return result;
}

function classifyPython(lines) {
  const result = new Array(lines.length).fill(false);
  let inDocstring = false;
  let inStringLit = false;
  let tripleChar = '';

  // Triple-quote is a docstring only at statement start (def/class body)
  let afterDefOrClass = true;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (inDocstring) {
      result[i] = true;
      const closeMarker = tripleChar.repeat(3);
      if (trimmed.includes(closeMarker)) { inDocstring = false; afterDefOrClass = false; }
      continue;
    }

    if (inStringLit) {
      const closeMarker = tripleChar.repeat(3);
      if (trimmed.includes(closeMarker)) { inStringLit = false; afterDefOrClass = false; }
      continue;
    }

    const dqIdx = trimmed.indexOf('"""');
    const sqIdx = trimmed.indexOf("'''");
    let tripleIdx = -1;
    let tChar = '';
    if (dqIdx !== -1 && (sqIdx === -1 || dqIdx <= sqIdx)) { tripleIdx = dqIdx; tChar = '"'; }
    else if (sqIdx !== -1) { tripleIdx = sqIdx; tChar = "'"; }

    if (tripleIdx !== -1) {
      const closeMarker = tChar.repeat(3);
      const afterOpen = trimmed.slice(tripleIdx + 3);
      const closesOnSameLine = afterOpen.includes(closeMarker);

      if (afterDefOrClass) {
        result[i] = true;
        if (!closesOnSameLine) {
          inDocstring = true;
          tripleChar = tChar;
        } else {
          afterDefOrClass = false;
        }
      } else {
        if (!closesOnSameLine) {
          inStringLit = true;
          tripleChar = tChar;
        }
        afterDefOrClass = false;
      }
      continue;
    }

    if (trimmed.startsWith('#')) {
      result[i] = true;
      continue;
    }

    if (hasInlineComment(lines[i], '#')) {
      result[i] = true;
    }

    if (trimmed !== '') {
      afterDefOrClass = /^(?:async\s+)?def\s+\w|^class\s+\w/.test(trimmed);
    }
  }

  return result;
}

function classifyRuby(lines) {
  const result = new Array(lines.length).fill(false);
  let inBlock = false;
  let inHeredoc = false;
  let heredocTerminator = '';

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (inHeredoc) {
      if (trimmed === heredocTerminator) inHeredoc = false;
      continue;
    }

    if (trimmed === '=begin') { inBlock = true; result[i] = true; continue; }
    if (inBlock) {
      result[i] = true;
      if (trimmed === '=end') inBlock = false;
      continue;
    }

    const heredocMatch = lines[i].match(/<<[~-]?(\w+)/);
    if (heredocMatch) {
      heredocTerminator = heredocMatch[1];
      inHeredoc = true;
    }

    if (trimmed.startsWith('#')) { result[i] = true; continue; }

    if (hasInlineComment(lines[i], '#')) { result[i] = true; }
  }

  return result;
}

function classifyShell(lines) {
  const result = new Array(lines.length).fill(false);

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (trimmed.startsWith('#')) { result[i] = true; continue; }

    if (hasInlineComment(lines[i], '#')) { result[i] = true; }
  }

  return result;
}

/** Analyze a single file. Uses SHA-1 cache keyed on content. */
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

/** Analyze multiple files. */
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
