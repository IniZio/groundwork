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
// Session-scoped TASK_COMPLETE collection
// ---------------------------------------------------------------------------

/**
 * Scan journal shards for TASK_COMPLETE events emitted in a given session,
 * regardless of the motive they were tagged with.  This handles the case where
 * `ledger complete` ran BEFORE the ledger's `motive` field was populated, so
 * the events received a synthetic motive (e.g. "session:<id>") instead of the
 * real one.  Returning these IDs lets the divergence checker treat them as
 * witnessed completions and avoid false slice_state_mismatch findings.
 *
 * @param {string} journalDir  — absolute path to the journal shard directory
 * @param {string} sessionId   — session ID from the ledger
 * @returns {Set<string>}      — slice IDs with a TASK_COMPLETE in this session
 */
function collectSessionCompletedIds(journalDir, sessionId) {
  const ids = new Set();
  let files = [];
  try {
    files = readdirSync(journalDir).filter(f => f.endsWith('.jsonl'));
  } catch {
    return ids; // journal dir absent or unreadable — not an error
  }
  for (const f of files) {
    // Fast-path: skip shards whose filename clearly belongs to a different
    // session (filename pattern: YYYY-MM-DD-<sessionId>.jsonl).
    if (!f.includes(sessionId)) continue;
    try {
      const lines = readFileSync(join(journalDir, f), 'utf8').split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line);
          if (ev.type === 'TASK_COMPLETE' && ev.session === sessionId) {
            const sliceId = ev.data?.slice;
            if (typeof sliceId === 'string' && sliceId) ids.add(sliceId);
          }
        } catch { /* malformed line — skip */ }
      }
    } catch { /* unreadable shard — skip */ }
  }
  return ids;
}

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
 * Find and parse ledger file(s) in <projectDir>/.groundwork/runs/*.json,
 * falling back to the legacy <projectDir>/.groundwork/run.json.
 *
 * When `motive` is non-null and ≥1 file matches (`raw.motive === motive`),
 * ALL matching files are UNIONED rather than picking one by mtime.  This
 * preserves completions from earlier sessions of the same motive (a motive
 * outlives a single session, so picking only the newest file would drop
 * prior session's completed slices).
 *
 * Union semantics:
 *   - Slices are keyed on `(session_id, slice_id)`.  Each ledger carries a
 *     `session_id` field; slices from the SAME session that appear in multiple
 *     files (re-saves) use the newer file's copy.  Slices from DIFFERENT
 *     sessions with the same slice_id are kept as DISTINCT entries — they
 *     represent independent work items across sessions.
 *   - Top-level fields (gate, active, path) come from the most-recently-
 *     modified matching file.
 *   - Each slice entry receives a `_session_id` annotation for callers that
 *     need to distinguish per-session provenance.
 *
 * Fallback: when motive is null OR no file matches the motive, the original
 * single-most-recent-file behavior is preserved (unchanged).
 *
 * Unparseable files are excluded from the motive match.
 * Returns { found: false } when no ledger is present (never throws).
 */
function readLedger(projectDir, motive = null) {
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

  // When motive is specified, union ALL matching ledgers instead of picking one.
  // Fall back to the full candidate list if none match (legacy unlabelled runs).
  if (motive !== null) {
    const parsed = [];
    for (const c of candidates) {
      try {
        const raw = JSON.parse(readFileSync(c.path, 'utf8'));
        if (raw.motive === motive) {
          parsed.push({ ...c, raw });
        }
      } catch {
        // skip unparseable file
      }
    }

    if (parsed.length > 0) {
      // Union slices keyed on (session_id, slice_id).
      // Within the same session, the newer file's copy wins.
      // Slices from different sessions with the same slice_id are kept as
      // distinct entries — they represent independent work across sessions.
      const sliceMap = new Map(); // `${session_id}::${slice_id}` -> { slice, mtime }
      for (const { raw, mtime } of parsed) {
        const sessionId = typeof raw.session_id === 'string' ? raw.session_id : '';
        const rawSlices = Array.isArray(raw.slices) ? raw.slices : [];
        for (const s of rawSlices) {
          const key = `${sessionId}::${s.id}`;
          const existing = sliceMap.get(key);
          if (!existing || mtime > existing.mtime) {
            sliceMap.set(key, {
              slice: { ...pickSlice(s), _session_id: sessionId },
              mtime,
            });
          }
        }
      }

      // Most-recently-modified file provides the top-level gate/active fields.
      parsed.sort((a, b) => b.mtime - a.mtime);
      const primary = parsed[0];
      const gate = primary.raw.gate && typeof primary.raw.gate === 'object'
        ? primary.raw.gate
        : {};

      return {
        found: true,
        path: primary.path,
        active: primary.raw.active ?? null,
        slices: [...sliceMap.values()].map(v => v.slice),
        gate,
      };
    }
    // No matching file — fall through to unfiltered single-file behavior below.
  }

  // pick most recently modified (fallback / no-motive path)
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
 * @param {string|null} [opts.motive] — motive name to scope ledger selection; null = unscoped
 * @returns {object}                — ground truth record; never throws
 */
export async function collectGroundTruth({ projectDir, events = [], motive = null }) {
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
    ledger = readLedger(projectDir, motive);
  } catch {
    ledger = { found: false, not_checkable: { reason: 'ledger_read_error' }, slices: [], gate: {} };
  }

  // --- session-scoped TASK_COMPLETE witness --------------------------------
  // When `ledger complete` runs before the ledger's `motive` field is set, the
  // emitted TASK_COMPLETE events carry a synthetic motive ("session:<id>")
  // rather than the real one.  The compile fold filters by motive, so those
  // events are invisible to the divergence checker — causing false
  // slice_state_mismatch findings.  We collect them here (outside the fold)
  // and surface them as session_completed_ids so the checker can consult them.
  let session_completed_ids = [];
  if (ledger.found) {
    const raw = ledger._raw_session_id; // not stored yet — read from disk below
    void raw; // suppress lint
  }
  try {
    // The ledger's session_id is the canonical key.  readLedger doesn't expose
    // it yet, so we re-read the raw file via the path stored in ledger.path.
    let sessionId = null;
    if (ledger.found && typeof ledger.path === 'string') {
      try {
        const raw = JSON.parse(readFileSync(ledger.path, 'utf8'));
        sessionId = typeof raw.session_id === 'string' ? raw.session_id : null;
      } catch { /* ignore */ }
    }
    if (sessionId) {
      const journalDir = join(projectDir, '.groundwork', 'journal');
      const ids = collectSessionCompletedIds(journalDir, sessionId);
      session_completed_ids = [...ids];
    }
  } catch {
    // non-fatal
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
    session_completed_ids,
    collected_at,
  };

  if (git_not_checkable) {
    result.not_checkable = git_not_checkable;
  }

  return result;
}
