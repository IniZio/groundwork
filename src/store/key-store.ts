/**
 * External secret management for groundwork.
 *
 * Both the write-token and the gate-seal key live OUTSIDE the repo:
 *   ~/.config/groundwork/repos/<sha256[:16]-of-repo-path>/{write.token,seal.key}
 *
 * Mode 0600. Never committed. Not in work.db.
 *
 * Subagents are blocked from reaching these paths by store-write-guard.
 * The main session retrieves the token via $GW init stdout only.
 */

import { createHmac, randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Config dir resolution
// ---------------------------------------------------------------------------

/** Hash a repo path to a stable 16-hex directory name. */
function repoHash(repoPath: string): string {
  return createHash("sha256").update(resolve(repoPath)).digest("hex").slice(0, 16);
}

/** Base config dir for a repo: `$XDG_CONFIG_HOME/groundwork/repos/<hash>/`. */
export function configDirForRepo(repoPath: string): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(base, "groundwork", "repos", repoHash(repoPath));
}

export function writeTokenPath(repoPath: string): string {
  return join(configDirForRepo(repoPath), "write.token");
}

export function sealKeyPath(repoPath: string): string {
  return join(configDirForRepo(repoPath), "seal.key");
}

// ---------------------------------------------------------------------------
// Write token
// ---------------------------------------------------------------------------

/** Read the write token for a repo, or null if not initialised. */
export function readWriteToken(repoPath: string): string | null {
  try { return readFileSync(writeTokenPath(repoPath), "utf8").trim() || null; }
  catch { return null; }
}

/**
 * Ensure a write token exists.  Returns the token.
 * Pass `existing` to migrate a token from the old meta-table location.
 */
export function ensureWriteToken(repoPath: string, existing?: string): string {
  const p = writeTokenPath(repoPath);
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  mkdirSync(configDirForRepo(repoPath), { recursive: true });
  const tok = existing ?? randomBytes(16).toString("hex");
  writeFileSync(p, tok + "\n", { mode: 0o600 });
  return tok;
}

// ---------------------------------------------------------------------------
// Seal key
// ---------------------------------------------------------------------------

/** Read the seal key for a repo, or null if not initialised. */
export function readSealKey(repoPath: string): Buffer | null {
  try {
    const buf = readFileSync(sealKeyPath(repoPath));
    return buf.length > 0 ? buf : null;
  } catch { return null; }
}

/** Ensure a 32-byte seal key exists.  Returns the key buffer. */
export function ensureSealKey(repoPath: string): Buffer {
  const p = sealKeyPath(repoPath);
  if (existsSync(p)) {
    const buf = readFileSync(p);
    if (buf.length > 0) return buf;
  }
  mkdirSync(configDirForRepo(repoPath), { recursive: true });
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
export interface SealFields {
  base_commit?: string | null;
  citation: string;
  created_at: string;
  event_type: string;
  motive_id: string;
}

function canonicalize(fields: SealFields): string {
  const obj: Record<string, string> = {};
  const f = fields as unknown as Record<string, string | null | undefined>;
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
