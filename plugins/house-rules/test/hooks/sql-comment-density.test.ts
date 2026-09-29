/**
 * SQL comment-density autofix (stable).
 *
 * fixEntryFor("sql") is stable; the guard strips over-budget plain comments;
 * migration/codegen markers and optimizer hints are never stripped; `--`
 * comments can now match exemptions because commentInnerText strips the prefix.
 */
import { describe, it, expect } from "bun:test";
import { autoFix, findComments } from "../../src/hooks/lib/comment-density.js";
import { fixEntryFor } from "../../rules/comment-density/languages.js";
import { commentInnerText } from "../../src/hooks/languages/comments.js";

function removableBlock(n: number): string {
  return Array.from({ length: n }, (_, i) => `-- prose comment ${i} that is removable`).join("\n");
}

function allRows(text: string): Set<number> {
  return new Set(text.split("\n").map((_, i) => i));
}

async function fix(text: string) {
  const r = await autoFix(text, "sql", allRows(text));
  if (!r.ok) throw new Error(r.reason);
  return r;
}

const CODE = "CREATE TABLE items (id BIGINT PRIMARY KEY, name TEXT NOT NULL);";

describe("fixEntryFor(sql) is stable", () => {
  it("stability stable, applicability safe", () => {
    expect(fixEntryFor("sql")).toEqual({ stability: "stable", applicability: "safe" });
  });
});

describe("per-edit guard: over-budget SQL prose is stripped", () => {
  const src = `${CODE}\n\n${removableBlock(30)}\n`;

  it("removes -- prose, keeps code", async () => {
    const r = await fix(src);
    expect(r.fixed).toContain(CODE);
    expect(r.fixed).not.toContain("-- prose comment 29 that is removable");
    expect(r.removed).toBeGreaterThan(0);
  });

  it("removes block-comment prose too", async () => {
    const block = Array.from({ length: 30 }, (_, i) => `/* block prose ${i} removable */`).join("\n");
    const r = await fix(`${CODE}\n\n${block}\n`);
    expect(r.fixed).toContain(CODE);
    expect(r.fixed).not.toContain("/* block prose 29 removable */");
  });

  it("under-budget SQL passes through unchanged", async () => {
    const small = `${CODE}\n${CODE}\n${CODE}\n${CODE}\n${CODE}\n${CODE}\n${CODE}\n${CODE}\n${CODE}\n${CODE}\n${CODE}\n${CODE}\n${CODE}\n${CODE}\n${CODE}\n${CODE}\n${CODE}\n${CODE}\n${CODE}\n${CODE}\n${CODE}\n${CODE}\n${CODE}\n${CODE}\n-- one short note\n`;
    const r = await fix(small);
    expect(r.fixed).toBe(small);
  });
});

describe("tool markers are never stripped", () => {
  const MARKERS = [
    "-- migrate:up",
    "-- migrate:down",
    "-- +goose Up",
    "-- +goose Down",
    "-- +goose StatementBegin",
    "-- +goose StatementEnd",
    "-- name: ListItems :many",
  ];

  it("dbmate, goose and sqlc markers survive; prose around them is removed", async () => {
    const src = [
      ...MARKERS.slice(0, 1),
      CODE,
      ...MARKERS.slice(1),
      removableBlock(30),
      "",
    ].join("\n");
    const r = await fix(src);
    const kept = r.fixed.split("\n").filter((l) => l.startsWith("--"));
    expect(kept).toEqual(MARKERS);
    expect(r.fixed).not.toContain("-- prose comment 0 that is removable");
  });

  it("optimizer hint /*+ ... */ survives", async () => {
    const hint = "SELECT /*+ INDEX(items idx_items_name) */ id FROM items;";
    const r = await fix(`${hint}\n${CODE}\n\n${removableBlock(30)}\n`);
    expect(r.fixed).toContain("/*+ INDEX(items idx_items_name) */");
  });
});

describe("-- comments match exemptions", () => {
  it("commentInnerText strips the -- prefix", () => {
    expect(commentInnerText("-- NOTE(dba): partition monthly")).toBe("NOTE(dba): partition monthly");
    expect(commentInnerText("--https://example.com/doc")).toBe("https://example.com/doc");
  });

  it("commentInnerText leaves other languages unchanged", () => {
    expect(commentInnerText("// -- keep dashes")).toBe("-- keep dashes");
    expect(commentInnerText("# -- flag")).toBe("-- flag");
  });

  it("a -- comment carrying a URL is exempt and survives the strip", async () => {
    const url = "-- https://www.postgresql.org/docs/current/indexes-partial.html";
    const src = `${url}\n${CODE}\n\n${removableBlock(30)}\n`;
    const found = await findComments(src, "sql");
    expect(found.ok).toBe(true);
    if (!found.ok) throw new Error("parse");
    const c = found.comments.find((x) => x.text.includes("postgresql.org"));
    expect(c?.exempt).toBe(true);
    const r = await fix(src);
    expect(r.fixed).toContain(url);
  });

  it("a -- NOTE(...) comment is exempt", async () => {
    const note = "-- NOTE(dba): partition by month once row count exceeds 10 million";
    const src = `${note}\n${CODE}\n\n${removableBlock(30)}\n`;
    const r = await fix(src);
    expect(r.fixed).toContain(note);
  });
});
