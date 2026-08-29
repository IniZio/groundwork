/**
 * Tamper-evident sidecar seal store for Obsidian note files.
 *
 * Seal sidecar pattern:
 *   Each note `<note>.md` gets a sidecar `<note>.md.seal` containing a
 *   HMAC-SHA256 hex string (64 hex chars, no trailing newline). The seal
 *   covers only machine-owned frontmatter keys; human-owned keys (desc,
 *   question) and the markdown body are excluded so humans can edit freely
 *   in Obsidian without invalidating the seal.
 *
 * Key management:
 *   One 32-byte random key per motive directory, stored at
 *   `<motiveDir>/.seal.key` (mode 0600, never committed). Limits key
 *   proliferation: a compromised motive key only affects that motive's notes.
 *
 * Canonical state:
 *   Extract only machine-owned keys from the frontmatter object, sort
 *   alphabetically, serialize as JSON.stringify with sorted keys. Absent keys
 *   are omitted (not serialised as null).
 */

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

// ---------------------------------------------------------------------------
// Machine-owned key lists
// ---------------------------------------------------------------------------

/**
 * Machine-owned frontmatter keys for slice notes (sorted alphabetically).
 * Tampering any of these invalidates the seal.
 */
export const SLICE_MACHINE_KEYS: readonly string[] = [
  'acceptance',
  'blocked_by',
  'claimed_at',
  'claimed_by',
  'completed_at',
  'covers_ac',
  'created_by',
  'decisions',
  'id',
  'kind',
  'session',
  'status',
  'ticket',
  'wave',
] as const;

/**
 * Machine-owned frontmatter keys for gate notes (sorted alphabetically).
 */
export const GATE_MACHINE_KEYS: readonly string[] = [
  'advisor',
  'created_at',
  'motive',
  'qa',
  'session',
  'verifier',
] as const;

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** Path of seal sidecar next to a note: `<notePath>.seal` */
export function sealPath(notePath: string): string {
  return `${notePath}.seal`;
}

/** Path of per-motive HMAC key: `<motiveDir>/.seal.key` */
export function keyPath(motiveDir: string): string {
  return join(motiveDir, '.seal.key');
}

// ---------------------------------------------------------------------------
// Key management
// ---------------------------------------------------------------------------

/**
 * Ensure key file exists. If absent, mint 32 random bytes and write with
 * mode 0600. Returns the key as a Buffer.
 */
export function ensureKey(motiveDir: string): Buffer {
  const kp = keyPath(motiveDir);
  if (existsSync(kp)) {
    return readFileSync(kp);
  }
  const key = randomBytes(32);
  writeFileSync(kp, key, { mode: 0o600 });
  // Explicitly set mode in case umask restricted it
  chmodSync(kp, 0o600);
  return key;
}

/**
 * Read existing key file. Throws if absent.
 */
export function readKey(motiveDir: string): Buffer {
  const kp = keyPath(motiveDir);
  if (!existsSync(kp)) {
    throw new Error(`Seal key not found: ${kp}`);
  }
  return readFileSync(kp);
}

// ---------------------------------------------------------------------------
// Canonical state
// ---------------------------------------------------------------------------

/**
 * Deterministic canonical JSON of only the machine-owned keys present in `fm`.
 * Keys sorted alphabetically; absent keys omitted.
 */
export function canonicalMachineState(
  fm: Record<string, unknown>,
  machineKeys: readonly string[],
): string {
  const sorted = [...machineKeys].sort();
  const obj: Record<string, unknown> = {};
  for (const k of sorted) {
    if (Object.prototype.hasOwnProperty.call(fm, k) && fm[k] !== undefined) {
      obj[k] = fm[k];
    }
  }
  // JSON.stringify preserves insertion order; we inserted in sorted order above.
  return JSON.stringify(obj);
}

// ---------------------------------------------------------------------------
// HMAC helpers
// ---------------------------------------------------------------------------

function computeHmac(key: Buffer, canonical: string): string {
  return createHmac('sha256', key).update(canonical, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Seal I/O
// ---------------------------------------------------------------------------

/**
 * Write seal sidecar for a note. Calls ensureKey internally.
 * `fm` is the raw parsed frontmatter object (before any schema transformation).
 */
export function writeSeal(
  notePath: string,
  motiveDir: string,
  fm: Record<string, unknown>,
  machineKeys: readonly string[],
): void {
  const key = ensureKey(motiveDir);
  const canonical = canonicalMachineState(fm, machineKeys);
  const hmac = computeHmac(key, canonical);
  writeFileSync(sealPath(notePath), hmac, { encoding: 'utf8' });
}

/**
 * Verify seal sidecar.
 *
 * Returns:
 *   true  — seal present and valid
 *   false — seal present but invalid (tampered)
 *   null  — no seal file exists
 *
 * Note: does NOT read the note file from disk. Receives already-parsed fm.
 */
export function verifySeal(
  notePath: string,
  motiveDir: string,
  fm: Record<string, unknown>,
  machineKeys: readonly string[],
): true | false | null {
  const sp = sealPath(notePath);
  if (!existsSync(sp)) {
    return null;
  }

  const stored = readFileSync(sp, 'utf8').trim();
  const key = readKey(motiveDir);
  const canonical = canonicalMachineState(fm, machineKeys);
  const computed = computeHmac(key, canonical);

  // Timing-safe comparison; lengths must match (both are 64-char hex strings)
  if (stored.length !== computed.length) {
    return false;
  }

  const match = timingSafeEqual(
    Buffer.from(stored, 'hex'),
    Buffer.from(computed, 'hex'),
  );
  return match ? true : false;
}

/**
 * Read a note file from disk, parse its frontmatter, and verify the seal.
 * This is the disk-read path that catches tampering done directly to the file.
 *
 * Returns:
 *   true  — seal present and valid (frontmatter matches sealed state)
 *   false — seal present but invalid (machine-owned frontmatter was tampered)
 *   null  — no seal file exists (legacy/unsealed note)
 */
export function verifyNote(
  notePath: string,
  motiveDir: string,
  kind: 'slice' | 'gate',
): true | false | null {
  const content = readFileSync(notePath, 'utf8');
  const { data } = matter(content);
  const machineKeys = kind === 'slice' ? SLICE_MACHINE_KEYS : GATE_MACHINE_KEYS;
  return verifySeal(notePath, motiveDir, data as Record<string, unknown>, machineKeys);
}
