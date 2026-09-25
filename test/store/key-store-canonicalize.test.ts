/**
 * Behaviour lock for canonicalize / computeSeal.
 * Seal hashes are persisted — this test must never change the expected literal.
 */

import { describe, it, expect } from "bun:test";
import { computeSeal } from "../../src/store/key-store.js";

describe("computeSeal canonicalize", () => {
  it("omits null and empty-string fields, sorts keys, returns stable hash", () => {
    // Fixed 32-byte key (0x42 repeated)
    const key = Buffer.alloc(32, 0x42);

    const fields = {
      motive_id: "m-001",
      citation: "" as string,
      event_type: "gate",
      created_at: "2026-01-01T00:00:00Z",
      base_commit: null as string | null,
    };

    const seal = computeSeal(key, fields);

    expect(seal).toBe(
      "b1add9f1ab63020b6b9123ff4d97672c536d44c9f1678b23eeac92a287e1648e"
    );
  });
});
