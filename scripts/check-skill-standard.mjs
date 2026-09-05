#!/usr/bin/env node
// scripts/check-skill-standard.mjs
// Audits skills/groundwork/ against the authoring standard's mechanical targets.
// Usage: node scripts/check-skill-standard.mjs [skillsDir] [options]
//   --max-median N        word-count threshold (default 700)
//   --verbose             print per-skill word counts
//   --audit <skill> <f>   audit-completeness mode: checks removed sentences appear in audit table
//   --baseline-file <p>   override path to check-skill-standard.baseline.json

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(__filename);
const REPO_ROOT = path.dirname(SCRIPT_DIR);

// ── Editable: imperative verbs accepted as description starters ─────────────
const IMPERATIVE_VERBS = [
  'Add', 'Allow', 'Analyze', 'Apply', 'Assert', 'Audit', 'Author',
  'Block', 'Bootstrap', 'Build', 'Bundle',
  'Cache', 'Capture', 'Check', 'Classify', 'Clear', 'Collect', 'Combine',
  'Compare', 'Compile', 'Configure', 'Convert', 'Create',
  'Debug', 'Decompose', 'Delete', 'Delegate', 'Deploy', 'Describe', 'Detect',
  'Disable', 'Dispatch', 'Document',
  'Enable', 'Enforce', 'Ensure', 'Execute', 'Extend', 'Extract',
  'Fetch', 'Filter', 'Find', 'Flag', 'Format',
  'Generate', 'Gather',
  'Identify', 'Initialize', 'Install', 'Instrument',
  'Join',
  'Load', 'Locate', 'Log',
  'Manage', 'Map', 'Mark', 'Measure', 'Merge', 'Monitor',
  'Observe', 'Output', 'Override',
  'Parse', 'Pause', 'Plan', 'Poll', 'Print', 'Probe', 'Profile', 'Publish',
  'Record', 'Redirect', 'Register', 'Remove', 'Report', 'Reset', 'Restart',
  'Restrict', 'Resume', 'Return', 'Review', 'Route', 'Run',
  'Scaffold', 'Schedule', 'Scan', 'Search', 'Send', 'Set', 'Show', 'Signal',
  'Sort', 'Split', 'Start', 'Stop', 'Subscribe',
  'Tag', 'Test', 'Track', 'Transform', 'Trace',
  'Update', 'Use',
  'Validate', 'Verify',
  'Watch', 'Write',
];

// ── Utilities ────────────────────────────────────────────────────────────────

function findGitRoot(startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    if (existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function getSkillDirs(skillsDir) {
  try {
    return readdirSync(skillsDir).filter(name => {
      const p = path.join(skillsDir, name);
      try { return statSync(p).isDirectory() && existsSync(path.join(p, 'SKILL.md')); }
      catch { return false; }
    });
  } catch { return []; }
}

function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function stripYamlQuotes(s) {
  s = s.trim();
  if ((s.startsWith('"') && s.endsWith('"')) ||
      (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1).trim();
  return s;
}

function normalizeWS(s) {
  return s.replace(/\s+/g, ' ').trim();
}

function stripMarkdownBoilerplate(text) {
  // Remove YAML frontmatter block
  text = text.replace(/^---\n[\s\S]*?\n---\n?/, '');
  // Remove code fences (``` ... ```)
  text = text.replace(/```[\s\S]*?```/g, '');
  // Remove markdown headings
  text = text.replace(/^#{1,6}\s+.+$/gm, '');
  // Remove table rows (including separator rows)
  text = text.replace(/^\|.+$/gm, '');
  return text;
}

function splitSentences(text) {
  return normalizeWS(stripMarkdownBoilerplate(text))
    .split(/(?<=\.)\s+/)
    .map(s => s.trim())
    .filter(s => s.length >= 10);
}

function countHooks(hooksFile) {
  const data = JSON.parse(readFileSync(hooksFile, 'utf8'));
  const hooks = data.hooks ?? {};
  let total = 0;
  for (const arr of Object.values(hooks)) {
    if (Array.isArray(arr)) total += arr.length;
  }
  return total;
}

// ── Detectors ────────────────────────────────────────────────────────────────

function detectMedianWords(skillsDir, maxMedian, verbose) {
  const dirs = getSkillDirs(skillsDir);
  const counts = dirs.map(name => ({
    name,
    words: wordCount(readFileSync(path.join(skillsDir, name, 'SKILL.md'), 'utf8')),
  }));
  const med = median(counts.map(c => c.words));
  const pass = med <= maxMedian;
  const lines = [];
  if (verbose) {
    for (const c of [...counts].sort((a, b) => a.words - b.words)) {
      lines.push(`  ${c.words} ${c.name}`);
    }
  }
  lines.push(`${pass ? 'PASS' : 'FAIL'} median-words median=${med} threshold=${maxMedian}`);
  return { pass, lines };
}

function detectHelpDuplication(skillsDir) {
  const binLedger = path.join(REPO_ROOT, 'bin', 'ledger');
  const binJournal = path.join(REPO_ROOT, 'bin', 'journal');

  if (!existsSync(binLedger) || !existsSync(binJournal)) {
    return { pass: true, lines: ['WARN help-duplication CLI unavailable skipped'] };
  }

  const helpLines = [];
  for (const bin of [binLedger, binJournal]) {
    const r = spawnSync(bin, ['help'], { encoding: 'utf8', cwd: REPO_ROOT });
    const out = r.stdout ?? '';
    if (!out && (r.status ?? 0) !== 0) {
      return { pass: true, lines: ['WARN help-duplication CLI unavailable skipped'] };
    }
    helpLines.push(...out.split('\n').map(l => l.trimEnd()));
  }

  const helpSet = new Set(helpLines.filter(Boolean));
  const dirs = getSkillDirs(skillsDir);
  const violations = [];

  for (const name of dirs) {
    const skillLines = readFileSync(path.join(skillsDir, name, 'SKILL.md'), 'utf8')
      .split('\n').map(l => l.trimEnd());
    let run = 0;
    let runStart = -1;
    for (let i = 0; i < skillLines.length; i++) {
      const line = skillLines[i];
      if (line && helpSet.has(line)) {
        if (run === 0) runStart = i;
        run++;
        if (run >= 3) {
          violations.push(`${name}:${runStart + 1}`);
          break;
        }
      } else {
        run = 0;
      }
    }
  }

  const pass = violations.length === 0;
  const detail = violations.length ? ` ${violations.join(' ')}` : '';
  return { pass, lines: [`${pass ? 'PASS' : 'FAIL'} help-duplication${detail}`] };
}

function detectVerbFirst(skillsDir) {
  const dirs = getSkillDirs(skillsDir);
  const failures = [];
  for (const name of dirs) {
    const content = readFileSync(path.join(skillsDir, name, 'SKILL.md'), 'utf8');
    const m = content.match(/^description:\s*(.+)$/m);
    if (!m) continue;
    const desc = stripYamlQuotes(m[1]);
    const firstToken = desc.split(/\s+/)[0];
    if (!IMPERATIVE_VERBS.includes(firstToken)) {
      failures.push(`${name}("${firstToken}")`);
    }
  }
  const pass = failures.length === 0;
  const detail = failures.length ? ` ${failures.join(' ')}` : '';
  return { pass, lines: [`${pass ? 'PASS' : 'FAIL'} verb-first${detail}`] };
}

function detectOrphans(skillsDir) {
  const routerFile = path.join(skillsDir, 'SKILL.md');
  if (!existsSync(routerFile)) {
    return { pass: true, lines: ['WARN orphans no router SKILL.md found skipped'] };
  }
  const routerContent = readFileSync(routerFile, 'utf8');
  const dirs = getSkillDirs(skillsDir);
  const orphans = dirs.filter(name => {
    // Match backtick-delimited form or groundwork: prefix — avoid substring false positives
    const re = new RegExp('`(?:groundwork:)?' + name.replace(/[-]/g, '\\-') + '`|groundwork:' + name.replace(/[-]/g, '\\-') + '(?=[\\s`\\n,.]|$)');
    return !re.test(routerContent);
  });
  const pass = orphans.length === 0;
  const detail = orphans.length ? ` ${orphans.join(', ')}` : '';
  return { pass, lines: [`${pass ? 'PASS' : 'FAIL'} orphans${detail}`] };
}

function detectHooksBaseline(baselineFile) {
  const hooksFile = path.join(REPO_ROOT, 'hooks', 'hooks.json');
  if (!existsSync(baselineFile)) {
    return { pass: false, lines: [`FAIL hooks-baseline baseline file not found: ${baselineFile}`] };
  }
  if (!existsSync(hooksFile)) {
    return { pass: false, lines: ['FAIL hooks-baseline hooks/hooks.json not found'] };
  }
  const baseline = JSON.parse(readFileSync(baselineFile, 'utf8'));
  const expected = baseline.hooks_baseline;
  const actual = countHooks(hooksFile);
  const pass = actual === expected;
  return {
    pass,
    lines: [`${pass ? 'PASS' : 'FAIL'} hooks-baseline actual=${actual} expected=${expected}`],
  };
}

function detectAuditCompleteness(skill, auditFile, skillsDir) {
  const gitRoot = findGitRoot(skillsDir) ?? REPO_ROOT;
  const relPath = path.relative(gitRoot, path.join(skillsDir, skill, 'SKILL.md'));

  const r = spawnSync('git', ['show', `HEAD:${relPath}`], { encoding: 'utf8', cwd: gitRoot });
  if ((r.status ?? 1) !== 0) {
    return { pass: false, lines: [`FAIL audit-completeness git show failed: ${(r.stderr ?? '').trim()}`] };
  }
  const headContent = r.stdout;

  const wcPath = path.join(skillsDir, skill, 'SKILL.md');
  if (!existsSync(wcPath)) {
    return { pass: false, lines: [`FAIL audit-completeness working copy not found: ${wcPath}`] };
  }
  if (!existsSync(auditFile)) {
    return { pass: false, lines: [`FAIL audit-completeness audit file not found: ${auditFile}`] };
  }

  const wcContent = readFileSync(wcPath, 'utf8');
  const auditNorm = normalizeWS(readFileSync(auditFile, 'utf8'));

  const headSentences = splitSentences(headContent);
  const wcSentences = new Set(splitSentences(wcContent));

  const missing = headSentences.filter(s => !wcSentences.has(s) && !auditNorm.includes(normalizeWS(s)));

  const pass = missing.length === 0;
  const detailLines = missing.slice(0, 5).map(s => `  missing: "${s.substring(0, 80)}"`);
  detailLines.push(`${pass ? 'PASS' : 'FAIL'} audit-completeness${pass ? '' : ` ${missing.length} sentence(s) not covered`}`);
  return { pass, lines: detailLines };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    skillsDir: null,
    maxMedian: 700,
    verbose: false,
    audit: null,
    baselineFile: path.join(SCRIPT_DIR, 'check-skill-standard.baseline.json'),
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--max-median') opts.maxMedian = Number(args[++i]);
    else if (args[i] === '--verbose') opts.verbose = true;
    else if (args[i] === '--audit') { opts.audit = { skill: args[++i], file: args[++i] }; }
    else if (args[i] === '--baseline-file') opts.baselineFile = args[++i];
    else if (!args[i].startsWith('--')) opts.skillsDir = path.resolve(args[i]);
  }
  if (!opts.skillsDir) opts.skillsDir = path.join(REPO_ROOT, 'skills', 'groundwork');
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv);
  const results = [];

  if (opts.audit) {
    results.push(detectAuditCompleteness(opts.audit.skill, opts.audit.file, opts.skillsDir));
  } else {
    results.push(detectMedianWords(opts.skillsDir, opts.maxMedian, opts.verbose));
    results.push(detectHelpDuplication(opts.skillsDir));
    results.push(detectVerbFirst(opts.skillsDir));
    results.push(detectOrphans(opts.skillsDir));
    results.push(detectHooksBaseline(opts.baselineFile));
  }

  for (const r of results) {
    for (const line of r.lines) console.log(line);
  }
  process.exit(results.some(r => !r.pass) ? 1 : 0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
