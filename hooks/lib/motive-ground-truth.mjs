/**
 * motive-ground-truth.mjs — recomputed-outside-the-fold ground truth.
 *
 * The ONLY impure module in the motive-compile pipeline.
 * Injected into the pure fold as opts.groundTruth; never thrown, never exits.
 *
 * Returns:
 *   {
 *     head_sha,            // 40-char hex or null
 *     branch,              // branch name or null
 *     dirty_paths: [...],  // repo-relative, from git status --porcelain
 *     existing_paths: {},  // path -> bool
 *     ledger: { found, path?, active?, slices, gate },
 *     collected_at         // ISO-8601 — the ONLY wall-clock read in the pipeline
 *   }
 *
 * Per D2b: collected_at and dirty_paths are present-tense. The compiler's
 * --no-ground-truth flag skips this module entirely, giving divergence_checked:false,
 * which keeps "never looked" distinguishable from "clean" (S6-AC5 / D2b).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Run a git command; return trimmed stdout or null on any error.
 * Never throws.
 */
function gitQ(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 10_000,
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Probe whether a path exists on disk.
 * Resolves relative to projectDir when not absolute.
 * Never throws.
 */
function probeExists(p, projectDir) {
  try {
    const abs = resolve(projectDir, p);
    return existsSync(abs);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Ledger discovery
// ---------------------------------------------------------------------------

/**
 * Slice fields that must round-trip (S3-AC3).
 */
const SLICE_FIELDS = ['id', 'wave', 'status', 'desc', 'blocked_by', 'acceptance', 'kind'];

function pickSlice(raw) {
  const out = {};
  for (const k of SLICE_FIELDS) {
    if (k in raw) out[k] = raw[k];
  }
  return out;
}

/**
 * Find and parse the most-recently-modified ledger file in
 * <projectDir>/.groundwork/runs/*.json, falling back to the legacy
 * <projectDir>/.groundwork/run.json.
 *
 * Returns { found: false } when no ledger is present (never throws).
 */
function readLedger(projectDir) {
  const runsDir = join(projectDir, '.groundwork', 'runs');
  let candidates = [];

  try {
    if (existsSync(runsDir) && statSync(runsDir).isDirectory()) {
      const files = readdirSync(runsDir)
        .filter(f => f.endsWith('.json'))
        .map(f => {
          const full = join(runsDir, f);
          try {
            const mtime = statSync(full).mtimeMs;
            return { path: full, mtime };
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      candidates.push(...files);
    }
  } catch {
    // directory unreadable — continue to legacy fallback
  }

  // legacy fallback
  const legacyPath = join(projectDir, '.groundwork', 'run.json');
  try {
    if (existsSync(legacyPath)) {
      candidates.push({ path: legacyPath, mtime: statSync(legacyPath).mtimeMs });
    }
  } catch {
    // ignore
  }

  if (candidates.length === 0) {
    return { found: false, slices: [], gate: {} };
  }

  // pick most recently modified
  candidates.sort((a, b) => b.mtime - a.mtime);
  const { path } = candidates[0];

  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const slices = Array.isArray(raw.slices) ? raw.slices.map(pickSlice) : [];
    const gate = raw.gate && typeof raw.gate === 'object' ? raw.gate : {};
    return {
      found: true,
      path,
      active: raw.active ?? null,
      slices,
      gate,
    };
  } catch {
    return {
      found: false,
      not_checkable: { reason: 'ledger_parse_error', path },
      slices: [],
      gate: {},
    };
  }
}

// ---------------------------------------------------------------------------
// Path collection from events and ledger slices
// ---------------------------------------------------------------------------

/**
 * Collect all paths mentioned by events and ledger slices that need probing.
 */
function collectPaths(events, ledgerSlices) {
  const paths = new Set();

  for (const ev of events) {
    const d = ev.data ?? {};
    // SPEC_DRIFT.data.path (F2: the one reliable path field)
    if (typeof d.path === 'string' && d.path) paths.add(d.path);
    // any other conventional path fields
    if (typeof d.file === 'string' && d.file) paths.add(d.file);
    if (Array.isArray(d.paths)) {
      for (const p of d.paths) {
        if (typeof p === 'string' && p) paths.add(p);
      }
    }
  }

  // Paths from ledger slices — from acceptance criteria or desc (heuristic: skip;
  // the plan only mentions slice record fields, not derived text paths)
  // Ledger slices don't carry explicit path fields in the schema, so no extraction here.
  // (S3-AC4 says "probed for every path the events and the ledger slices mention" —
  //  ledger slices carry no structured path fields in the data model defined by D4.)
  void ledgerSlices;

  return paths;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Collect ground truth recomputed outside the fold.
 *
 * @param {object} opts
 * @param {string} opts.projectDir  — absolute path to the project root (never uses CWD)
 * @param {Array}  [opts.events]    — folded events (for path extraction); defaults to []
 * @returns {object}                — ground truth record; never throws
 */
export async function collectGroundTruth({ projectDir, events = [] }) {
  const collected_at = new Date().toISOString();

  // --- git probes ----------------------------------------------------------
  let head_sha = null;
  let branch = null;
  let dirty_paths = [];
  let git_not_checkable = null;

  const rawSha = gitQ(['rev-parse', 'HEAD'], projectDir);
  if (rawSha === null) {
    git_not_checkable = { reason: 'not_a_git_repo_or_git_unavailable' };
  } else if (/^[0-9a-f]{40}$/i.test(rawSha)) {
    head_sha = rawSha.toLowerCase();

    const rawBranch = gitQ(['rev-parse', '--abbrev-ref', 'HEAD'], projectDir);
    branch = rawBranch ?? null;

    const rawStatus = gitQ(['status', '--porcelain'], projectDir);
    if (rawStatus !== null) {
      dirty_paths = rawStatus
        .split('\n')
        .filter(Boolean)
        .map(line => line.slice(3)); // strip XY + space
    }
  } else {
    git_not_checkable = { reason: 'unexpected_sha_format', raw: rawSha };
  }

  // --- ledger --------------------------------------------------------------
  let ledger;
  try {
    ledger = readLedger(projectDir);
  } catch {
    ledger = { found: false, not_checkable: { reason: 'ledger_read_error' }, slices: [], gate: {} };
  }

  // --- path existence probing ---------------------------------------------
  let existing_paths = {};
  try {
    const paths = collectPaths(events, ledger.slices ?? []);
    for (const p of paths) {
      existing_paths[p] = probeExists(p, projectDir);
    }
  } catch {
    // non-fatal; return what we have
  }

  // --- assemble ------------------------------------------------------------
  const result = {
    head_sha,
    branch,
    dirty_paths,
    existing_paths,
    ledger,
    collected_at,
  };

  if (git_not_checkable) {
    result.not_checkable = git_not_checkable;
  }

  return result;
}
