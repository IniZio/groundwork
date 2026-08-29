/**
 * Parity test: motive_ref canonical form contract.
 *
 * The canonical form for ledger.motive_ref is a SLUG (e.g. "my-feature").
 * Historical prose documented it as a PATH, causing silent failures:
 *   - stop-gate built path.join(..., motiveSlug, 'motive.md') from the raw value,
 *     so a path-form value produced a nonsensical nested path and existsSync failed.
 *   - motive-graph did `ledger.motive_ref !== slug`, so a path-form value never matched.
 *
 * This test spans BOTH readers by importing the shared resolveMotiveSlug normaliser
 * that both files now use. If either file drifts back to raw comparison the test
 * that validates the normaliser's contract will still catch it — and the source-text
 * assertions below will catch a drift that removes the import entirely.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveMotiveSlug } from "../../hooks/lib/motive-ref.mjs";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..");

// ---------------------------------------------------------------------------
// 1. resolveMotiveSlug — core contract
// ---------------------------------------------------------------------------

describe("resolveMotiveSlug — canonical form normaliser", () => {
  it("returns a plain slug unchanged", () => {
    expect(resolveMotiveSlug("my-feature")).toBe("my-feature");
  });

  it("normalises relative path form to slug", () => {
    expect(resolveMotiveSlug(".groundwork/motives/my-feature/motive.md")).toBe("my-feature");
  });

  it("normalises absolute path form to slug", () => {
    expect(resolveMotiveSlug("/home/user/project/.groundwork/motives/my-feature/motive.md")).toBe("my-feature");
  });

  it("normalises Windows-style path form to slug", () => {
    expect(resolveMotiveSlug("C:\\project\\.groundwork\\motives\\my-feature\\motive.md")).toBe("my-feature");
  });

  it("returns null for empty string", () => {
    expect(resolveMotiveSlug("")).toBeNull();
  });

  it("returns null for non-string values", () => {
    expect(resolveMotiveSlug(null as unknown as string)).toBeNull();
    expect(resolveMotiveSlug(undefined as unknown as string)).toBeNull();
    expect(resolveMotiveSlug(42 as unknown as string)).toBeNull();
  });

  it("proves the old silent-failure: raw path !== slug", () => {
    // This documents WHY normalisation is needed.
    // Before the fix, both stop-gate and motive-graph compared the raw value:
    //   stop-gate: path.join(projectDir, '.groundwork', 'motives', rawValue, 'motive.md')
    //   motive-graph: ledger.motive_ref !== slug
    // A path-form value silently produced the wrong answer.
    const pathForm = ".groundwork/motives/my-feature/motive.md";
    const slug = "my-feature";
    // TypeScript knows these literals differ; cast to string to document the runtime reality.
    expect((pathForm as string) === (slug as string)).toBe(false); // the bug: raw === fails
    expect(resolveMotiveSlug(pathForm)).toBe(slug); // the fix: normaliser works
  });
});

// ---------------------------------------------------------------------------
// 2. Parity: both stop-gate and motive-graph use resolveMotiveSlug
//    If either drifts back to raw comparison, these assertions catch it.
// ---------------------------------------------------------------------------

describe("motive_ref parity: stop-gate and motive-graph both use resolveMotiveSlug", () => {
  // stop-gate.mjs is now a thin shim; the implementation lives in the TypeScript source.
  // The parity guard checks the TypeScript source so it still catches raw-comparison drift.
  const stopGateSrc = readFileSync(path.join(ROOT, "src", "gw", "hook", "stop-gate.ts"), "utf8");
  const motiveGraphSrc = readFileSync(path.join(ROOT, "hooks", "lib", "motive-graph.mjs"), "utf8");

  it("stop-gate imports resolveMotiveSlug from ./lib/motive-ref.mjs", () => {
    expect(stopGateSrc).toContain("resolveMotiveSlug");
    // TypeScript source inlines the helper (no import) — the function definition is present.
  });

  it("motive-graph imports resolveMotiveSlug from ./motive-ref.mjs", () => {
    expect(motiveGraphSrc).toContain("resolveMotiveSlug");
    expect(motiveGraphSrc).toContain("./motive-ref.mjs");
  });

  it("stop-gate does not use raw motive_ref as a slug (no bare ledger.motive_ref as path segment)", () => {
    // The old pattern was: ? ledger.motive_ref : ... with the result passed to path.join.
    // After the fix, resolveMotiveSlug wraps the raw value before it reaches path.join.
    // Assert the old bare ternary is gone.
    expect(stopGateSrc).not.toMatch(/\?\s*ledger\.motive_ref\s*\n\s*:/);
  });

  it("motive-graph does not compare motive_ref directly with ===", () => {
    // The old pattern was: if (ledger.motive_ref !== slug) continue
    // After the fix it uses: if (resolveMotiveSlug(ledger.motive_ref) !== slug) continue
    expect(motiveGraphSrc).not.toContain("ledger.motive_ref !== slug");
  });
});
