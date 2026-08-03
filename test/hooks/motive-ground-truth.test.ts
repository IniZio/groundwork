/**
 * Tests for hooks/lib/motive-ground-truth.mjs (S3)
 *
 * All fixtures use mkdtemp; no ambient CLAUDE_PROJECT_DIR; no CWD reliance.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { collectGroundTruth } from '../../hooks/lib/motive-ground-truth.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmp() {
  return mkdtempSync(join(tmpdir(), 'mgt-test-'));
}

function gitInit(dir: string) {
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
}

function gitCommit(dir: string, msg = 'init') {
  writeFileSync(join(dir, '.gitkeep'), '');
  execFileSync('git', ['add', '.gitkeep'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', msg], { cwd: dir, stdio: 'ignore' });
}

function writeLedger(dir: string, data: any) {
  const runsDir = join(dir, '.groundwork', 'runs');
  mkdirSync(runsDir, { recursive: true });
  const path = join(runsDir, 'test-run.json');
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
  return path;
}

// ---------------------------------------------------------------------------
// S3-AC1 — real git repo: head_sha, branch, dirty_paths
// ---------------------------------------------------------------------------

describe('S3-AC1 — real git repo', () => {
  let dir: string;
  beforeEach(() => {
    dir = tmp();
    gitInit(dir);
    gitCommit(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns a 40-char head_sha and branch', async () => {
    const gt = await collectGroundTruth({ projectDir: dir, events: [] });
    expect(gt.head_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(typeof gt.branch).toBe('string');
    expect(gt.branch.length).toBeGreaterThan(0);
  });

  it('dirty_paths matches git status --porcelain lines', async () => {
    // create an untracked file
    writeFileSync(join(dir, 'untracked.txt'), 'hello');
    const gt = await collectGroundTruth({ projectDir: dir, events: [] });
    // git status --porcelain shows "?? untracked.txt"; dirty_paths strips the 3-char prefix
    expect(gt.dirty_paths).toContain('untracked.txt');
  });

  it('dirty_paths is empty on a clean repo', async () => {
    const gt = await collectGroundTruth({ projectDir: dir, events: [] });
    expect(gt.dirty_paths).toEqual([]);
  });

  it('collected_at is an ISO timestamp and is the only time field', async () => {
    const before = new Date().toISOString();
    const gt = await collectGroundTruth({ projectDir: dir, events: [] });
    const after = new Date().toISOString();
    expect(gt.collected_at >= before).toBe(true);
    expect(gt.collected_at <= after).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// S3-AC2 — non-git directory
// ---------------------------------------------------------------------------

describe('S3-AC2 — non-git directory', () => {
  let dir: string;
  beforeEach(() => { dir = tmp(); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns head_sha:null and a not_checkable reason', async () => {
    const gt = await collectGroundTruth({ projectDir: dir, events: [] });
    expect(gt.head_sha).toBeNull();
    expect(gt.not_checkable).toBeDefined();
    expect(typeof gt.not_checkable.reason).toBe('string');
  });

  it('never throws', async () => {
    await expect(collectGroundTruth({ projectDir: dir, events: [] })).resolves.toBeDefined();
  });

  it('still returns collected_at and dirty_paths fields', async () => {
    const gt = await collectGroundTruth({ projectDir: dir, events: [] });
    expect(gt.collected_at).toBeDefined();
    expect(Array.isArray(gt.dirty_paths)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// S3-AC3 — ledger round-trip
// ---------------------------------------------------------------------------

describe('S3-AC3 — ledger', () => {
  let dir: string;
  beforeEach(() => { dir = tmp(); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns found:false when no ledger is present', async () => {
    const gt = await collectGroundTruth({ projectDir: dir, events: [] });
    expect(gt.ledger.found).toBe(false);
    expect(Array.isArray(gt.ledger.slices)).toBe(true);
  });

  it('round-trips all slice fields', async () => {
    const slice = {
      id: 'S1',
      wave: 1,
      status: 'complete',
      desc: 'Test slice',
      blocked_by: ['S0'],
      acceptance: ['passes tests'],
      kind: 'impl',
    };
    writeLedger(dir, { slices: [slice], gate: { advisor: { verdict: 'APPROVE' } }, active: true });

    const gt = await collectGroundTruth({ projectDir: dir, events: [] });
    expect(gt.ledger.found).toBe(true);
    expect(gt.ledger.active).toBe(true);
    const s = gt.ledger.slices[0];
    expect(s.id).toBe('S1');
    expect(s.wave).toBe(1);
    expect(s.status).toBe('complete');
    expect(s.desc).toBe('Test slice');
    expect(s.blocked_by).toEqual(['S0']);
    expect(s.acceptance).toEqual(['passes tests']);
    expect(s.kind).toBe('impl');
  });

  it('returns gate from ledger', async () => {
    writeLedger(dir, {
      slices: [],
      gate: { advisor: { verdict: 'APPROVE', citation: 'all green' } },
      active: false,
    });
    const gt = await collectGroundTruth({ projectDir: dir, events: [] });
    expect(gt.ledger.gate?.advisor?.verdict).toBe('APPROVE');
  });

  it('handles missing optional slice fields gracefully', async () => {
    writeLedger(dir, {
      slices: [{ id: 'S2', status: 'pending' }],
      gate: {},
      active: true,
    });
    const gt = await collectGroundTruth({ projectDir: dir, events: [] });
    expect(gt.ledger.slices[0].id).toBe('S2');
    expect(gt.ledger.slices[0].acceptance).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// S3-AC4 — path existence probing
// ---------------------------------------------------------------------------

describe('S3-AC4 — path existence probing', () => {
  let dir: string;
  beforeEach(() => {
    dir = tmp();
    gitInit(dir);
    gitCommit(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('probes present and absent paths from events', async () => {
    const presentFile = join(dir, 'exists.txt');
    writeFileSync(presentFile, 'yes');

    const events = [
      { type: 'SPEC_DRIFT', data: { path: 'exists.txt' } },
      { type: 'SPEC_DRIFT', data: { path: 'missing.txt' } },
    ];

    const gt = await collectGroundTruth({ projectDir: dir, events });
    expect(gt.existing_paths['exists.txt']).toBe(true);
    expect(gt.existing_paths['missing.txt']).toBe(false);
  });

  it('probes paths from data.paths array', async () => {
    const events = [
      { type: 'TASK_COMPLETE', data: { paths: ['a.ts', 'b.ts'] } },
    ];
    const gt = await collectGroundTruth({ projectDir: dir, events });
    expect('a.ts' in gt.existing_paths).toBe(true);
    expect('b.ts' in gt.existing_paths).toBe(true);
  });

  it('existing_paths is {} when no paths are mentioned', async () => {
    const gt = await collectGroundTruth({ projectDir: dir, events: [] });
    expect(gt.existing_paths).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// S3-AC5 — never mutates filesystem; collected_at is the only wall-clock read
// ---------------------------------------------------------------------------

describe('S3-AC5 — purity and no filesystem mutation', () => {
  let dir: string;
  beforeEach(() => {
    dir = tmp();
    gitInit(dir);
    gitCommit(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('does not create any files in projectDir', async () => {
    const { readdirSync } = await import('node:fs');
    const before = readdirSync(dir).sort().join('\n');
    await collectGroundTruth({ projectDir: dir, events: [] });
    const after = readdirSync(dir).sort().join('\n');
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Never-throws — unreadable / bad dir
// ---------------------------------------------------------------------------

// ── session_completed_ids regression ─────────────────────────────────────
//
// When `ledger complete` runs before the ledger's motive field is set, the
// emitted TASK_COMPLETE events carry a synthetic motive ("session:<id>").
// collectGroundTruth() must return those slice IDs in session_completed_ids.

describe('session_completed_ids — collected from journal shard by session', () => {
  let dir: string;

  beforeEach(() => { dir = tmp(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns slice IDs from TASK_COMPLETE events matching the ledger session_id', async () => {
    const SESSION_ID = 'test-session-abc123';

    // Write a ledger with session_id and motive
    const ledgerData = {
      session_id: SESSION_ID,
      motive: 'my-motive',
      active: true,
      slices: [{ id: 'S1', status: 'complete' }],
      gate: {},
    };
    writeLedger(dir, ledgerData);

    // Write a journal shard with TASK_COMPLETE events — some for this session
    // (with a DIFFERENT motive, simulating the pre-motive-field scenario) and
    // one for a different session that must NOT appear in the result.
    const journalDir = join(dir, '.groundwork', 'journal');
    mkdirSync(journalDir, { recursive: true });
    const shardPath = join(journalDir, `2026-08-03-${SESSION_ID}.jsonl`);
    const events = [
      { ts: '2026-08-03T09:00:00.000Z', session: SESSION_ID, motive: `session:${SESSION_ID}`, type: 'TASK_COMPLETE', data: { slice: 'S1' } },
      { ts: '2026-08-03T09:00:01.000Z', session: SESSION_ID, motive: `session:${SESSION_ID}`, type: 'TASK_COMPLETE', data: { slice: 'S2' } },
      { ts: '2026-08-03T09:00:02.000Z', session: 'other-session', motive: 'other-motive', type: 'TASK_COMPLETE', data: { slice: 'S99' } },
      { ts: '2026-08-03T09:00:03.000Z', session: SESSION_ID, motive: 'my-motive', type: 'DECISION', data: { id: 'D1' } },
    ];
    writeFileSync(shardPath, events.map(e => JSON.stringify(e)).join('\n'), 'utf8');

    const gt = await collectGroundTruth({ projectDir: dir, events: [] });

    expect(Array.isArray(gt.session_completed_ids)).toBe(true);
    expect(gt.session_completed_ids).toContain('S1');
    expect(gt.session_completed_ids).toContain('S2');
    expect(gt.session_completed_ids).not.toContain('S99');  // different session
  });

  it('returns empty array when no ledger is found', async () => {
    const gt = await collectGroundTruth({ projectDir: dir, events: [] });
    expect(gt.session_completed_ids).toEqual([]);
  });

  it('returns empty array when journal dir is absent', async () => {
    writeLedger(dir, { session_id: 'sid', motive: 'm', active: true, slices: [], gate: {} });
    // No journal dir written → should not throw
    const gt = await collectGroundTruth({ projectDir: dir, events: [] });
    expect(gt.session_completed_ids).toEqual([]);
  });
});

describe('never throws under adversarial inputs', () => {
  it('handles a non-existent directory without throwing', async () => {
    const gt = await collectGroundTruth({ projectDir: '/tmp/definitely-does-not-exist-xyzzy', events: [] });
    expect(gt).toBeDefined();
    expect(gt.head_sha).toBeNull();
  });

  it('handles empty events array', async () => {
    const dir = tmp();
    try {
      await expect(collectGroundTruth({ projectDir: dir, events: [] })).resolves.toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('handles malformed ledger JSON without throwing', async () => {
    const dir = tmp();
    try {
      const runsDir = join(dir, '.groundwork', 'runs');
      mkdirSync(runsDir, { recursive: true });
      writeFileSync(join(runsDir, 'bad.json'), '{ not valid json !!!', 'utf8');
      const gt = await collectGroundTruth({ projectDir: dir, events: [] });
      expect(gt.ledger.found).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
