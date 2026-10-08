import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { WorkStore } from "../../src/store/store.js";
import { CHILD_GATE, CHILD_LINK, SCOPE_VERIFY, serializePointer } from "../../src/store/scope-pointer.js";
import { writeInboxEvent } from "../../src/store/scope-inbox.js";
import {
  approvalPayload, classifySpec, completionGuard, evaluateArtifact, gateStatus, intentGates, intentGatesApply, refusalMessage,
} from "../../src/cli/gate-status.js";

const git = (cwd: string, ...a: string[]) =>
  spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd, encoding: "utf8" });

let tmp: string;
let store: WorkStore;
let sha: string;
beforeEach(() => {
  tmp = realpathSync(mkdtempSync(path.join(tmpdir(), "gs-")));
  git(tmp, "init", "-q");
  git(tmp, "commit", "--allow-empty", "-q", "-m", "init");
  sha = git(tmp, "rev-parse", "HEAD").stdout.trim();
  mkdirSync(path.join(tmp, ".groundwork"), { recursive: true });
  store = new WorkStore(path.join(tmp, ".groundwork", "work.db"));
  store.insertSlice({ id: "S-1", wave: 1, status: "pending", acceptance: null, blocked_by: null, covers_ac: null, decisions: null });
});
afterEach(() => {
  store.close();
  rmSync(tmp, { recursive: true, force: true });
});

const link = (mode: "direct" | "delegate", id = "L1") =>
  store.appendEvent(CHILD_LINK, { link_id: id, slice: "S-1", mode, root_realpath: tmp, worktree_realpath: tmp });
const gate = (verdict: string, base = sha, id = "L1") =>
  store.appendEvent(CHILD_GATE, { link_id: id, slice: "S-1", verdict, citation: "a.ts:1", base_commit: base });
const guard = () => completionGuard(store, { slice: "S-1", repoDir: tmp });

describe("completionGuard", () => {
  it("no links -> ok", () => {
    expect(guard().ok).toBe(true);
  });

  it("delegate with no gate verdict refuses naming the link", () => {
    link("delegate");
    const r = guard();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe("newest child link L1 has no APPROVE");
  });

  it("delegate APPROVE ok", () => {
    link("delegate");
    gate("APPROVE");
    const r = guard();
    expect(r.ok).toBe(true);
    expect(r.evidence.join("\n")).toContain(sha);
  });

  it("CORRECTION after APPROVE refuses", () => {
    link("delegate");
    gate("APPROVE");
    gate("CORRECTION");
    const r = guard();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe("latest child verdict is CORRECTION, not APPROVE");
  });

  it("missing base_commit refuses", () => {
    link("delegate");
    gate("APPROVE", "deadbeef".repeat(5));
    const r = guard();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("base_commit deadbeef");
  });

  it("direct without verify refuses; with verify ok", () => {
    link("direct");
    const r = guard();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe("direct mode: no host verification recorded after link L1; run gw scope verify");
    store.appendEvent(SCOPE_VERIFY, { slice: "S-1", citation: "a.ts:1" });
    expect(guard().ok).toBe(true);
  });

  it("inbox file not yet ingested: guard ingests then passes", () => {
    link("delegate");
    writeInboxEvent(tmp, "L1", CHILD_GATE, { link_id: "L1", slice: "S-1", verdict: "APPROVE", citation: "a.ts:1", base_commit: sha });
    expect(store.getEvents(CHILD_GATE)).toHaveLength(0);
    expect(guard().ok).toBe(true);
    expect(store.getEvents(CHILD_GATE)).toHaveLength(1);
  });
});

describe("gateStatus", () => {
  it("root: main worktree, no pointer", () => {
    store.completeSlice("S-1");
    store.appendEvent("GATE_APPROVE", { citation: "a.ts:1", created_at: "2026-01-01T00:00:00.000Z" });
    const { intent, ...s } = gateStatus({ cwd: tmp });
    expect(intent?.applies).toBe(false);
    expect(s).toEqual({
      v: 1, scope: "root", slices: { open: 0, complete: 1 }, gate: "APPROVE", approved_at: "2026-01-01T00:00:00.000Z",
    });
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it("root with open slice and no gate", () => {
    const s = gateStatus({ cwd: tmp });
    expect(s.slices).toEqual({ open: 1, complete: 0 });
    expect(s.gate).toBe("none");
    expect(s.approved_at).toBeUndefined();
  });

  it("child: pointer present, no store", () => {
    const child = path.join(tmp, "child");
    mkdirSync(path.join(child, ".groundwork"), { recursive: true });
    writeFileSync(path.join(child, ".groundwork", "parent"), serializePointer({
      v: 1, motive: "m", slice: "S-1", link_id: "L1", mode: "delegate", root: tmp, created: "2026-01-01T00:00:00Z",
    }));
    const s = gateStatus({ cwd: child });
    expect(s.scope).toBe("child");
    expect(s.mode).toBe("delegate");
    expect(s.parent).toEqual({ motive: "m", slice: "S-1", link_id: "L1", root: tmp });
    expect(s.slices).toEqual({ open: 0, complete: 0 });
    expect(s.gate).toBe("none");
  });

  it("orphan: linked git worktree without pointer", () => {
    const wt = path.join(tmp, "wt");
    expect(git(tmp, "worktree", "add", "-q", wt, "-b", "b").status).toBe(0);
    expect(gateStatus({ cwd: wt }).scope).toBe("orphan");
  });

  it("orphan: non-git dir", () => {
    const d = realpathSync(mkdtempSync(path.join(tmpdir(), "gs-ng-")));
    try {
      const s = gateStatus({ cwd: d });
      expect(s.scope).toBe("orphan");
      expect(s.slices).toEqual({ open: 0, complete: 0 });
      expect(s.gate).toBe("none");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

describe("intent gates", () => {
  const slug = "m1";
  const spec = (fm: string, body = "") => `---\n${fm}\n---\n\n# Spec\n\n## Acceptance criteria\n\n${body}`;
  const put = (rel: string, text: string) => {
    mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
    writeFileSync(path.join(tmp, rel), text);
  };

  it("bugfix with repro_test -> auto", () => {
    const c = classifySpec(spec("change_kinds: [bugfix]\nrepro_test: test/a.test.ts"));
    expect(c.auto).toBe(true);
    expect(c.rows).toContain("Bug fix with a failing test that reproduces it");
    expect(c.openDecision).toBeNull();
  });
  it("bugfix without repro_test -> human", () => {
    const c = classifySpec(spec("change_kinds:\n  - bugfix"));
    expect(c.auto).toBe(false);
    expect(c.rows).toContain("Bug fix without a reproducing test");
    expect(c.openDecision?.startsWith("H2 ")).toBe(true);
  });
  it("refactor -> auto", () => {
    const c = classifySpec(spec("change_kinds: [refactor]"));
    expect(c.auto).toBe(true);
    expect(c.rows).toContain("Refactor, no behaviour or interface change");
  });
  it("cli-flag / config-key -> human", () => {
    for (const k of ["cli-flag", "config-key"]) {
      const c = classifySpec(spec(`change_kinds: [${k}]`));
      expect(c.auto).toBe(false);
      expect(c.rows).toContain("New CLI flag or config key");
    }
  });
  it("data-format / migration -> human", () => {
    for (const k of ["data-format", "migration"]) {
      const c = classifySpec(spec(`change_kinds: [${k}]`));
      expect(c.auto).toBe(false);
      expect(c.rows).toContain("Change to stored data format or migration");
    }
  });
  it("TBD AC -> human, names the line", () => {
    const line = "- [ ] AC-2 TBD later";
    const c = classifySpec(spec("change_kinds: [refactor]", `- [ ] AC-1 ok\n${line}\n`));
    expect(c.auto).toBe(false);
    expect(c.rows).toContain("Every AC maps to a slice, one AC still TBD");
    expect(c.openDecision).toContain(line);
  });
  it("dependency -> human", () => {
    const c = classifySpec(spec("change_kinds: [dependency]"));
    expect(c.auto).toBe(false);
    expect(c.rows).toContain("Dependency added");
  });
  it("null / no frontmatter / empty kinds -> Unclassified human", () => {
    for (const t of [null, "# no fm", spec("change_kinds: []")]) {
      const c = classifySpec(t);
      expect(c.auto).toBe(false);
      expect(c.rows).toEqual(["Unclassified"]);
      expect(c.openDecision).toBe("H2 needs human approval: Unclassified (spec declares no change_kinds)");
    }
  });
  it("unknown kind -> human, named", () => {
    const c = classifySpec(spec("change_kinds: [refactor, weird]"));
    expect(c.auto).toBe(false);
    expect(c.rows).toContain("Unclassified");
    expect(c.openDecision).toContain("weird");
  });

  it("approved -> edit -> void; no event -> missing", () => {
    put(`doc/${slug}/spec.md`, "v1");
    const rec = approvalPayload(tmp, slug, "spec", "human");
    expect(rec.files).toEqual([`doc/${slug}/spec.md`]);
    expect(evaluateArtifact(tmp, slug, "spec", JSON.stringify(rec)).state).toBe("approved");
    put(`doc/${slug}/spec.md`, "v2");
    expect(evaluateArtifact(tmp, slug, "spec", JSON.stringify(rec)).state).toBe("void");
    expect(evaluateArtifact(tmp, slug, "spec", null).state).toBe("missing");
    expect(evaluateArtifact(tmp, slug, "spec", "{bad").state).toBe("missing");
  });
  it("approvalPayload throws when no file", () => {
    expect(() => approvalPayload(tmp, slug, "charter", "human")).toThrow(
      `no charter found for ${slug}: expected doc/${slug}/motive.md or .groundwork/work/${slug}/motive.md`,
    );
  });
  it("intentGatesApply false without doc views; refusalMessage null", () => {
    put(`.groundwork/work/${slug}/spec.md`, "x");
    expect(intentGatesApply(tmp, slug)).toBe(false);
    expect(refusalMessage(intentGates(tmp, slug, () => null))).toBeNull();
  });
  it("refusalMessage names H1 and H2 when missing", () => {
    put(`doc/${slug}/motive.md`, "c");
    put(`doc/${slug}/spec.md`, "s");
    const g = intentGates(tmp, slug, () => null);
    expect(g.applies).toBe(true);
    const m = refusalMessage(g) ?? "";
    expect(m.startsWith("intent gate: implementation dispatch refused — ")).toBe(true);
    expect(m).toContain("H1 charter approval missing");
    expect(m).toContain("H2 spec approval missing");
  });
  it("refusalMessage null when both approved", () => {
    put(`doc/${slug}/motive.md`, "c");
    put(`doc/${slug}/spec.md`, "s");
    const ev: Record<string, string> = {
      APPROVE_CHARTER: JSON.stringify(approvalPayload(tmp, slug, "charter", "human")),
      APPROVE_SPEC: JSON.stringify(approvalPayload(tmp, slug, "spec", "auto", ["Refactor, no behaviour or interface change"])),
    };
    expect(refusalMessage(intentGates(tmp, slug, (t) => ev[t] ?? null))).toBeNull();
  });
});
