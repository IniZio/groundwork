/**
 * Parity test: motive_ref canonical form contract.
 *
 * The canonical form for ledger.motive_ref is a SLUG (e.g. "my-feature").
 * Historical prose documented it as a PATH, causing silent failures:
 *   - stop-gate built path.join(..., motiveSlug, 'motive.md') from the raw value,
 *     so a path-form value produced a nonsensical nested path and existsSync failed.
 *   - motive-graph did `ledger.motive_ref !== slug`, so a path-form value never matched.
 *
 * This test spans BOTH surfaces:
 *   - hooks/lib/motive-ref.mjs exports resolveMotiveSlug (used by the legacy stop-gate path).
 *   - src/gw/hook/stop-gate.ts inlines an identical copy.
 * Section 2 feeds the same payloads to both surfaces and asserts identical results.
 * A drift in either implementation causes the parity assertions to fail.
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
// 2. Parity — gw stop-gate inlined resolveMotiveSlug vs. legacy hooks surface
//
// NOTE: Why extraction rather than the real entry point?
// stop-gate's `run` export reads the filesystem immediately to locate a ledger
// file; resolveMotiveSlug is called only inside an internal pacing-message
// helper whose output is not surfaced in the JSON response unless a very
// specific ledger state is present (budget exhausted + incomplete slices).
// There is no observable path through the real entry for the resolved slug
// without a full on-disk fixture — out of scope for this seam test.
//
// The extraction is behavioural: it evaluates the actual function body from
// the source file. If the body drifts (different regex, different logic), the
// extracted function returns different results from the hooks surface and the
// parity assertions fail. A brace-counter locates the body precisely; the
// function body itself contains no TypeScript syntax so it evals as-is.
// ---------------------------------------------------------------------------

/**
 * Extract and return the inlined resolveMotiveSlug from src/gw/hook/stop-gate.ts.
 * Uses brace-counting so no fragile line-offset assumption is made.
 * The function body contains no TypeScript-specific syntax — it evals as plain JS.
 */
function extractGwResolveMotiveSlug(src: string): (motiveRef: unknown) => string | null {
  const fnIdx = src.indexOf("function resolveMotiveSlug(");
  if (fnIdx === -1) {
    throw new Error(
      "resolveMotiveSlug definition not found in src/gw/hook/stop-gate.ts — " +
        "inlined copy may have been removed or renamed"
    );
  }
  const braceStart = src.indexOf("{", fnIdx);
  let depth = 0;
  let pos = braceStart;
  for (; pos < src.length; pos++) {
    if (src[pos] === "{") depth++;
    else if (src[pos] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  const body = src.slice(braceStart + 1, pos);
  // eslint-disable-next-line no-new-func
  return new Function(`return (function resolveMotiveSlug(motiveRef) {\n${body}\n})`)() as (
    motiveRef: unknown
  ) => string | null;
}

describe("motive_ref parity — gw stop-gate inlined resolveMotiveSlug matches legacy hooks surface", () => {
  const stopGateSrc = readFileSync(
    path.join(ROOT, "src", "gw", "hook", "stop-gate.ts"),
    "utf8"
  );
  const gwResolve = extractGwResolveMotiveSlug(stopGateSrc);

  // Positive controls: gw surface resolves correctly on its own
  it("gw surface — plain slug resolves to itself", () => {
    expect(gwResolve("my-feature")).toBe("my-feature");
  });

  it("gw surface — relative path form resolves to slug", () => {
    expect(gwResolve(".groundwork/motives/my-feature/motive.md")).toBe("my-feature");
  });

  it("gw surface — null input returns null", () => {
    expect(gwResolve(null)).toBeNull();
  });

  // Parity: both surfaces must agree on every input shape
  it("both surfaces agree — slug form (positive control)", () => {
    const slug = "my-feature";
    expect(resolveMotiveSlug(slug)).toBe(slug);
    expect(gwResolve(slug)).toBe(slug);
    expect(resolveMotiveSlug(slug)).toBe(gwResolve(slug));
  });

  it("both surfaces agree — relative path form (divergence case: drifted gw would return raw path, not slug)", () => {
    // If the gw copy's regex were changed or removed, gwResolve would return the
    // full path string instead of "diverge-test", and this assertion would fail.
    const pathInput = ".groundwork/motives/diverge-test/motive.md";
    expect(resolveMotiveSlug(pathInput)).toBe("diverge-test");
    expect(gwResolve(pathInput)).toBe("diverge-test");
    expect(resolveMotiveSlug(pathInput)).toBe(gwResolve(pathInput));
  });

  it("both surfaces agree — absolute path form", () => {
    const pathInput = "/home/user/project/.groundwork/motives/abs-test/motive.md";
    expect(resolveMotiveSlug(pathInput)).toBe("abs-test");
    expect(gwResolve(pathInput)).toBe("abs-test");
    expect(resolveMotiveSlug(pathInput)).toBe(gwResolve(pathInput));
  });

  it("both surfaces agree — null input", () => {
    expect(resolveMotiveSlug(null as unknown as string)).toBeNull();
    expect(gwResolve(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. motive-graph imports resolveMotiveSlug from motive-ref.mjs
// ---------------------------------------------------------------------------

describe("motive-graph imports resolveMotiveSlug from motive-ref.mjs", () => {
  const motiveGraphSrc = readFileSync(
    path.join(ROOT, "hooks", "lib", "motive-graph.mjs"),
    "utf8"
  );

  it("imports resolveMotiveSlug from ./motive-ref.mjs", () => {
    expect(motiveGraphSrc).toContain("resolveMotiveSlug");
    expect(motiveGraphSrc).toContain("./motive-ref.mjs");
  });

  it("does not compare motive_ref directly with !== slug", () => {
    // The old pattern was: if (ledger.motive_ref !== slug) continue
    // After the fix: if (resolveMotiveSlug(ledger.motive_ref) !== slug) continue
    expect(motiveGraphSrc).not.toContain("ledger.motive_ref !== slug");
  });
});
