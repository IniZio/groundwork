#!/usr/bin/env node
/**
 * scripts/eval/baselines.mjs
 * Compute evaluation baselines for the obsidian-native-groundwork motive.
 *
 * Signals:
 *   1. LINT_DRIFT events per session (from .groundwork/journal/*.jsonl)
 *   2. Struggle signals on doc/specs paths (from .groundwork/struggle-signals.jsonl)
 *   3. AC_RETRACTION / AC_COVERAGE ratio per motive (from journal shards)
 *
 * Usage:
 *   node scripts/eval/baselines.mjs [--signal lint-drift|struggle|ac-ratio]
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const JOURNAL_DIR = join(REPO_ROOT, '.groundwork', 'journal');
const STRUGGLE_FILE = join(REPO_ROOT, '.groundwork', 'struggle-signals.jsonl');

// Parse CLI args
const args = process.argv.slice(2);
const signalIdx = args.indexOf('--signal');
const signalFilter = signalIdx !== -1 ? args[signalIdx + 1] : null;

function parseJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

function extractSessionId(filename) {
  // filename: YYYY-MM-DD-<uuid>.jsonl or date-<slug>.jsonl
  // session id = everything after the date prefix (YYYY-MM-DD-)
  const m = filename.match(/^\d{4}-\d{2}-\d{2}-(.+)\.jsonl$/);
  return m ? m[1] : filename.replace(/\.jsonl$/, '');
}

function loadAllJournalEventsWithFiles() {
  if (!existsSync(JOURNAL_DIR)) return { events: [], files: [] };
  const files = readdirSync(JOURNAL_DIR).filter(f => f.endsWith('.jsonl'));
  const events = [];
  for (const file of files) {
    const sessionId = extractSessionId(file);
    const lines = parseJsonl(join(JOURNAL_DIR, file));
    for (const ev of lines) {
      events.push({ ...ev, _fileSession: sessionId, _file: file });
    }
  }
  return { events, files };
}

function computeSignal1(events, files) {
  // Group LINT_DRIFT events by file-derived session id
  const bySession = new Map();
  for (const ev of events) {
    if (ev.type !== 'LINT_DRIFT') continue;
    const sid = ev._fileSession ?? ev.session ?? 'unknown';
    bySession.set(sid, (bySession.get(sid) ?? 0) + 1);
  }

  // Count unique session IDs from filenames (all journal files)
  const allSessions = new Set((files ?? []).map(f => extractSessionId(f)));

  const totalEvents = [...bySession.values()].reduce((a, b) => a + b, 0);
  const sessionsWithEvents = bySession.size;
  const totalSessions = allSessions.size;
  const avg = sessionsWithEvents > 0 ? (totalEvents / sessionsWithEvents) : 0;

  return { totalEvents, sessionsWithEvents, totalSessions, avg, bySession };
}

function computeSignal2() {
  const entries = parseJsonl(STRUGGLE_FILE);
  const bySession = new Map();
  for (const ev of entries) {
    const detail = JSON.stringify(ev.detail ?? '');
    if (!detail.includes('doc/specs')) continue;
    const sid = ev.session_id ?? 'unknown';
    bySession.set(sid, (bySession.get(sid) ?? 0) + 1);
  }
  const totalEvents = [...bySession.values()].reduce((a, b) => a + b, 0);
  const sessionsWithEvents = bySession.size;
  const avg = sessionsWithEvents > 0 ? (totalEvents / sessionsWithEvents) : 0;
  return { totalEvents, sessionsWithEvents, avg, bySession };
}

function computeSignal3(events) {
  // Count AC_COVERAGE and AC_RETRACTION per motive
  const motives = new Map();
  for (const ev of events) {
    if (ev.type !== 'AC_COVERAGE' && ev.type !== 'AC_RETRACTION') continue;
    const m = ev.motive ?? 'unknown';
    if (!motives.has(m)) motives.set(m, { coverage: 0, retraction: 0 });
    if (ev.type === 'AC_COVERAGE') motives.get(m).coverage++;
    else motives.get(m).retraction++;
  }
  return motives;
}

function pad(str, len) {
  str = String(str);
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

function rpad(str, len) {
  str = String(str);
  return str.length >= len ? str : ' '.repeat(len - str.length) + str;
}

function printSignal1(s1) {
  console.log('\n=== Signal 1: LINT_DRIFT events per session ===');
  console.log(pad('Total LINT_DRIFT events', 35) + ': ' + s1.totalEvents);
  console.log(pad('Sessions with ≥1 event', 35) + ': ' + s1.sessionsWithEvents);
  console.log(pad('Total unique sessions', 35) + ': ' + s1.totalSessions);
  console.log(pad('Avg LINT_DRIFT/session (w/ events)', 35) + ': ' + s1.avg.toFixed(2));

  if (s1.bySession.size > 0) {
    console.log('\n  Top sessions by LINT_DRIFT count:');
    const sorted = [...s1.bySession.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    for (const [sid, count] of sorted) {
      console.log('    ' + pad(sid.slice(0, 36), 38) + rpad(count, 4));
    }
  }
}

function printSignal2(s2) {
  console.log('\n=== Signal 2: Struggle signals on doc/specs paths ===');
  console.log(pad('Total matching entries', 35) + ': ' + s2.totalEvents);
  console.log(pad('Sessions affected', 35) + ': ' + s2.sessionsWithEvents);
  console.log(pad('Avg per affected session', 35) + ': ' + s2.avg.toFixed(2));
}

function printSignal3(motives) {
  console.log('\n=== Signal 3: AC_RETRACTION / AC_COVERAGE ratio per motive ===');
  if (motives.size === 0) {
    console.log('  (no AC_COVERAGE or AC_RETRACTION events found)');
    return;
  }
  const header = pad('Motive', 42) + rpad('Coverage', 10) + rpad('Retraction', 12) + rpad('Ratio %', 9);
  console.log('  ' + header);
  console.log('  ' + '-'.repeat(header.length));
  for (const [motive, counts] of [...motives.entries()].sort((a, b) => b[1].coverage - a[1].coverage)) {
    const ratio = counts.coverage > 0 ? ((counts.retraction / counts.coverage) * 100).toFixed(1) : '0.0';
    console.log('  ' + pad(motive, 42) + rpad(counts.coverage, 10) + rpad(counts.retraction, 12) + rpad(ratio + '%', 9));
  }
}

// Main
const { events: allEvents, files: journalFiles } = loadAllJournalEventsWithFiles();

const runAll = !signalFilter;
const runS1 = runAll || signalFilter === 'lint-drift';
const runS2 = runAll || signalFilter === 'struggle';
const runS3 = runAll || signalFilter === 'ac-ratio';

if (runS1) {
  const s1 = computeSignal1(allEvents, journalFiles);
  printSignal1(s1);
}

if (runS2) {
  const s2 = computeSignal2();
  printSignal2(s2);
}

if (runS3) {
  const s3 = computeSignal3(allEvents);
  printSignal3(s3);
}

console.log('');
