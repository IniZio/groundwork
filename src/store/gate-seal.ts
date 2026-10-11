import { verifySeal, type SealFields } from "./key-store.js";

export const NO_SEAL_REASON = "approval has no verifiable seal";

/**
 * Single verifier for a GATE_APPROVE seal. Fails closed: no key, no seal,
 * or a seal that does not verify all return ok:false.
 */
export function verifyApprovalSeal(
  event: { motiveId: string; payload: Record<string, unknown> },
  sealKey: Buffer | null,
): { ok: boolean; reason?: string } {
  if (!sealKey) return { ok: false, reason: NO_SEAL_REASON };
  const p = event.payload;
  const seal = typeof p.seal === "string" ? p.seal : null;
  const createdAt = typeof p.created_at === "string" ? p.created_at : null;
  if (!seal || !createdAt) return { ok: false, reason: NO_SEAL_REASON };
  const fields: SealFields = {
    citation: typeof p.citation === "string" ? p.citation : "",
    created_at: createdAt,
    event_type: "GATE_APPROVE",
    motive_id: event.motiveId,
    base_commit: typeof p.base_commit === "string" ? p.base_commit : null,
  };
  return verifySeal(sealKey, fields, seal) ? { ok: true } : { ok: false, reason: NO_SEAL_REASON };
}
