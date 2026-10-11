/**
 * External secret management for groundwork.
 *
 * Both the write-token and the gate-seal key live OUTSIDE the repo:
 *   $XDG_CONFIG_HOME(or ~/.config)/groundwork/repos/<store_id>/{write.token,seal.key}
 *
 * <store_id> is a random 16-byte hex id stored in the work.db `meta` table
 * (key `store_id`), generated on first use. Keys follow the db, so moving or
 * swapping a checkout neither loses keys nor inherits another checkout's.
 *
 * Migration: the old layout keyed the dir by sha256(resolve(repoPath))[:16].
 * On first store_id resolution, write.token and seal.key are COPIED from that
 * legacy dir into the store_id dir if absent there. The legacy dir is never
 * modified or deleted.
 *
 * Mode 0600. Never committed. Not in work.db.
 *
 * Subagents are blocked from reaching these paths by store-write-guard.
 * The main session retrieves the token via $GW init stdout only.
 */

import { createHmac, randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { WorkStore } from "./store.js";

// ---------------------------------------------------------------------------
// Config dir resolution
// ---------------------------------------------------------------------------

function reposBase(): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(base, "groundwork", "repos");
}

/** Hash a repo path to a stable 16-hex directory name (legacy layout). */
function repoHash(repoPath: string): string {
  return createHash("sha256").update(resolve(repoPath)).digest("hex").slice(0, 16);
}

/** Legacy config dir: `<repos>/<sha256(resolve(repoPath))[:16]>/`. */
function legacyConfigDirForRepo(repoPath: string): string {
  return join(reposBase(), repoHash(repoPath));
}

const KEY_FILES = ["write.token", "seal.key"] as const;

/**
 * Return the store_id of a work.db, creating it if missing, then copy any
 * legacy keys into the store_id dir (never touching the legacy dir).
 */
export function storeIdForDb(dbPath: string): string {
  const abs = resolve(dbPath);
  const store = new WorkStore(abs);
  let id: string | null;
  try {
    id = store.getMeta("store_id");
    if (!id) {
      id = randomBytes(16).toString("hex");
      store.setMeta("store_id", id);
    }
  } finally {
    store.close();
  }
  const dir = join(reposBase(), id);
  const legacy = legacyConfigDirForRepo(dirname(dirname(abs)));
  for (const f of KEY_FILES) {
    const src = join(legacy, f);
    const dst = join(dir, f);
    if (existsSync(src) && !existsSync(dst)) {
      const data = readFileSync(src);
      mkdirSync(dir, { recursive: true });
      writeFileSync(dst, data, { mode: 0o600 });
    }
  }
  return id;
}

/** Base config dir for a db: `<repos>/<store_id>/`. */
export function configDirForDb(dbPath: string): string {
  return join(reposBase(), storeIdForDb(dbPath));
}

function ensureDbParent(dbPath: string): void {
  if (!existsSync(dbPath)) mkdirSync(dirname(resolve(dbPath)), { recursive: true });
}

// ---------------------------------------------------------------------------
// Write token
// ---------------------------------------------------------------------------

/** Read the write token for a db, or null. Never creates the db. */
export function readWriteTokenForDb(dbPath: string): string | null {
  if (!existsSync(dbPath)) return null;
  try { return readFileSync(join(configDirForDb(dbPath), "write.token"), "utf8").trim() || null; }
  catch { return null; }
}

/**
 * Ensure a write token exists.  Returns the token.
 * Pass `existing` to migrate a token from the old meta-table location.
 */
export function ensureWriteTokenForDb(dbPath: string, existing?: string): string {
  ensureDbParent(dbPath);
  const dir = configDirForDb(dbPath);
  const p = join(dir, "write.token");
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  mkdirSync(dir, { recursive: true });
  const tok = existing ?? randomBytes(16).toString("hex");
  writeFileSync(p, tok + "\n", { mode: 0o600 });
  return tok;
}

// ---------------------------------------------------------------------------
// Seal key
// ---------------------------------------------------------------------------

/** Read the seal key for a db, or null. Never creates the db. */
export function readSealKeyForDb(dbPath: string): Buffer | null {
  if (!existsSync(dbPath)) return null;
  try {
    const buf = readFileSync(join(configDirForDb(dbPath), "seal.key"));
    return buf.length > 0 ? buf : null;
  } catch { return null; }
}

/** Ensure a 32-byte seal key exists.  Returns the key buffer. */
export function ensureSealKeyForDb(dbPath: string): Buffer {
  ensureDbParent(dbPath);
  const dir = configDirForDb(dbPath);
  const p = join(dir, "seal.key");
  if (existsSync(p)) {
    const buf = readFileSync(p);
    if (buf.length > 0) return buf;
  }
  mkdirSync(dir, { recursive: true });
  const key = randomBytes(32);
  writeFileSync(p, key, { mode: 0o600 });
  return key;
}

// ---------------------------------------------------------------------------
// HMAC seal
// ---------------------------------------------------------------------------

/**
 * Canonical field set for a gate-verdict seal.
 * Absent/null values are omitted; keys sorted alphabetically before hashing.
 */
export type SealFields = {
  base_commit?: string | null;
  citation: string;
  created_at: string;
  event_type: string;
  motive_id: string;
};

function canonicalize(fields: SealFields): string {
  const obj: Record<string, string> = {};
  const f: Record<string, string | null | undefined> = fields;
  for (const k of Object.keys(f).sort()) {
    const v = f[k];
    if (v != null && v !== "") obj[k] = v;
  }
  return JSON.stringify(obj);
}

/** Compute HMAC-SHA256 hex over the canonical field set. */
export function computeSeal(key: Buffer, fields: SealFields): string {
  return createHmac("sha256", key).update(canonicalize(fields)).digest("hex");
}

/** Verify a seal using constant-time comparison.  Returns true if valid. */
export function verifySeal(key: Buffer, fields: SealFields, seal: string): boolean {
  try {
    const expected = Buffer.from(computeSeal(key, fields), "hex");
    const actual   = Buffer.from(seal,               "hex");
    if (expected.length !== actual.length) return false;
    // Manual constant-time compare (Node timingSafeEqual needs same-length Buffers,
    // which we already checked above, but keep it explicit).
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ actual[i];
    return diff === 0;
  } catch { return false; }
}
