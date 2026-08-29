import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import {
  SLICE_MACHINE_KEYS,
  GATE_MACHINE_KEYS,
  keyPath,
  ensureKey,
  canonicalMachineState,
  writeSeal,
  verifySeal,
  verifyNote,
} from '../../../../src/gw/store/seal/index.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let tmpDirs: string[] = [];

function makeTmp(): { motiveDir: string; notePath: string } {
  const base = join(tmpdir(), `seal-test-${randomBytes(6).toString('hex')}`);
  mkdirSync(base, { recursive: true });
  tmpDirs.push(base);
  const motiveDir = join(base, 'motive');
  mkdirSync(motiveDir, { recursive: true });
  const notePath = join(motiveDir, 'slice-001.md');
  // Write a minimal note file (the seal module itself never reads this)
  writeFileSync(notePath, '---\nid: slice-001\nstatus: pending\n---\n\nBody text.\n');
  return { motiveDir, notePath };
}

afterEach(() => {
  for (const d of tmpDirs) {
    rmSync(d, { recursive: true, force: true });
  }
  tmpDirs = [];
});

// ---------------------------------------------------------------------------
// Slice FM fixture
// ---------------------------------------------------------------------------

const sliceFm: Record<string, unknown> = {
  id: 'slice-001',
  wave: 1,
  status: 'pending',
  kind: 'impl',
  session: 'sess-abc',
  claimed_by: null,
  claimed_at: null,
  completed_at: null,
  covers_ac: ['AC-1'],
  decisions: [],
  blocked_by: [],
  acceptance: 'something works',
  ticket: 'T-1',
  created_by: 'agent',
  // human-owned — not sealed
  desc: 'My slice description',
};

// ---------------------------------------------------------------------------
// Test 1: writeSeal + verifySeal on a slice note with all machine keys → true
// ---------------------------------------------------------------------------

describe('writeSeal + verifySeal', () => {
  it('returns true when seal is valid (slice note, all machine keys present)', () => {
    const { motiveDir, notePath } = makeTmp();
    writeSeal(notePath, motiveDir, sliceFm, SLICE_MACHINE_KEYS);
    expect(verifySeal(notePath, motiveDir, sliceFm, SLICE_MACHINE_KEYS)).toBe(true);
  });

  // Test 2: human edits body → seal still valid
  it('returns true after human edits the note body (body not in canonical state)', () => {
    const { motiveDir, notePath } = makeTmp();
    writeSeal(notePath, motiveDir, sliceFm, SLICE_MACHINE_KEYS);
    // Simulate Obsidian appending to the body — the fm object itself doesn't change
    writeFileSync(notePath, '---\nid: slice-001\nstatus: pending\n---\n\nBody text.\n\nExtra paragraph added by human.\n');
    // verifySeal does not read the note file; it receives the fm object
    expect(verifySeal(notePath, motiveDir, sliceFm, SLICE_MACHINE_KEYS)).toBe(true);
  });

  // Test 3: machine-owned key tampered → false
  it('returns false when a machine-owned key is tampered', () => {
    const { motiveDir, notePath } = makeTmp();
    writeSeal(notePath, motiveDir, sliceFm, SLICE_MACHINE_KEYS);
    const tamperedFm = { ...sliceFm, status: 'complete' }; // was 'pending'
    expect(verifySeal(notePath, motiveDir, tamperedFm, SLICE_MACHINE_KEYS)).toBe(false);
  });

  // Test 4: human-owned key changed → still true
  it('returns true when only a human-owned key changes (desc)', () => {
    const { motiveDir, notePath } = makeTmp();
    writeSeal(notePath, motiveDir, sliceFm, SLICE_MACHINE_KEYS);
    const editedFm = { ...sliceFm, desc: 'Updated description by human' };
    expect(verifySeal(notePath, motiveDir, editedFm, SLICE_MACHINE_KEYS)).toBe(true);
  });

  // Test 5: no seal file → null
  it('returns null when no seal file exists', () => {
    const { motiveDir, notePath } = makeTmp();
    // Do NOT call writeSeal
    expect(verifySeal(notePath, motiveDir, sliceFm, SLICE_MACHINE_KEYS)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test 6: canonicalMachineState is deterministic regardless of key order
// ---------------------------------------------------------------------------

describe('canonicalMachineState', () => {
  it('produces identical output regardless of key insertion order', () => {
    const fm1: Record<string, unknown> = { id: 'x', status: 'pending', wave: 2, kind: 'impl' };
    const fm2: Record<string, unknown> = { wave: 2, kind: 'impl', status: 'pending', id: 'x' };
    const keys: readonly string[] = ['id', 'wave', 'status', 'kind'];
    expect(canonicalMachineState(fm1, keys)).toBe(canonicalMachineState(fm2, keys));
  });

  it('omits absent keys', () => {
    const fm: Record<string, unknown> = { id: 'x' };
    const result = canonicalMachineState(fm, ['id', 'status', 'wave']);
    expect(JSON.parse(result)).toEqual({ id: 'x' });
  });
});

// ---------------------------------------------------------------------------
// Test 7: ensureKey is idempotent
// ---------------------------------------------------------------------------

describe('ensureKey', () => {
  it('is idempotent — second call returns same key content, same file', () => {
    const { motiveDir } = makeTmp();
    const key1 = ensureKey(motiveDir);
    const key2 = ensureKey(motiveDir);
    expect(key1.equals(key2)).toBe(true);
    // Only one key file
    expect(existsSync(keyPath(motiveDir))).toBe(true);
    const onDisk = readFileSync(keyPath(motiveDir));
    expect(key1.equals(onDisk)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 8: gate note — write + verify with GATE_MACHINE_KEYS → true
// ---------------------------------------------------------------------------

describe('gate note sealing', () => {
  it('write + verify with GATE_MACHINE_KEYS returns true', () => {
    const { motiveDir, notePath } = makeTmp();
    const gateFm: Record<string, unknown> = {
      session: 'sess-xyz',
      motive: 'my-motive',
      created_at: '2026-08-29T00:00:00Z',
      advisor: 'APPROVE',
      verifier: 'agent-v1',
      qa: null,
      // not sealed
      desc: 'gate note human text',
    };
    writeSeal(notePath, motiveDir, gateFm, GATE_MACHINE_KEYS);
    expect(verifySeal(notePath, motiveDir, gateFm, GATE_MACHINE_KEYS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests 9-11: verifyNote — disk-read tamper detection
// ---------------------------------------------------------------------------

describe('verifyNote — disk-read tamper detection', () => {
  it('detects machine-owned field tampered on disk (status: pending → complete) → false', () => {
    const { motiveDir, notePath } = makeTmp();
    // Write a note with frontmatter that verifyNote will read from disk
    const noteContent = '---\nid: slice-001\nstatus: pending\n---\n\nOriginal body.\n';
    writeFileSync(notePath, noteContent);
    // Seal using SLICE_MACHINE_KEYS (same list verifyNote will use for kind='slice')
    writeSeal(notePath, motiveDir, { id: 'slice-001', status: 'pending' }, SLICE_MACHINE_KEYS);

    // Tamper: rewrite status on disk directly (simulates Obsidian property edit)
    writeFileSync(notePath, noteContent.replace('status: pending', 'status: complete'));

    // verifyNote reads file from disk → machine key changed → seal invalid → false
    expect(verifyNote(notePath, motiveDir, 'slice')).toBe(false);
  });

  it('body prose appended on disk → seal still valid → true', () => {
    const { motiveDir, notePath } = makeTmp();
    const noteContent = '---\nid: slice-001\nstatus: pending\n---\n\nOriginal body.\n';
    writeFileSync(notePath, noteContent);
    writeSeal(notePath, motiveDir, { id: 'slice-001', status: 'pending' }, SLICE_MACHINE_KEYS);

    // Append body prose on disk (body is human-owned, not sealed)
    writeFileSync(notePath, noteContent + '\nHuman appended paragraph.\n');

    // verifyNote reads file → frontmatter unchanged → seal valid → true
    expect(verifyNote(notePath, motiveDir, 'slice')).toBe(true);
  });

  it('human-owned desc changed on disk → seal still valid → true', () => {
    const { motiveDir, notePath } = makeTmp();
    // desc is NOT in SLICE_MACHINE_KEYS → not included in canonical state
    const noteContent = '---\nid: slice-001\nstatus: pending\ndesc: original desc\n---\n\n';
    writeFileSync(notePath, noteContent);
    writeSeal(notePath, motiveDir, { id: 'slice-001', status: 'pending', desc: 'original desc' }, SLICE_MACHINE_KEYS);

    // Human edits desc in Obsidian
    writeFileSync(notePath, noteContent.replace('desc: original desc', 'desc: updated by human'));

    // verifyNote reads file → desc not machine-owned → canonical unchanged → true
    expect(verifyNote(notePath, motiveDir, 'slice')).toBe(true);
  });
});
