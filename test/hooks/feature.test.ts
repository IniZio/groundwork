import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dump as yamlDump } from "js-yaml";

const CLI = path.resolve(import.meta.dirname, "..", "..", "hooks", "feature.mjs");

let projectDir: string;

beforeEach(() => {
	projectDir = mkdtempSync(path.join(tmpdir(), "gw-feature-"));
});
afterEach(() => rmSync(projectDir, { recursive: true, force: true }));

/** Minimal valid active feature ledger (status=started, pointer=slice:F2). */
function baseFeature(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		version: 1,
		id: "feat_workspace-disk-min-size",
		slug: "workspace-disk-min-size",
		active: true,
		status: "started",
		health: "onTrack",
		plan_ref: ".groundwork/features/workspace-disk-min-size/plan.md",
		spec_ref: ".groundwork/features/workspace-disk-min-size/spec.md",
		branch: "feat/workspace-disk-min-size",
		ac_coverage: {
			AC1: ["F1"],
			AC2: ["F1"],
			AC3: ["F2"],
		},
		resume: {
			pointer: "slice:F2",
			slice_id: "F2",
			next_actions: [
				"Implement guest agent undersized-disk error path",
				"Add integration assertion for AC3",
			],
			blocked_reason: null,
			waiting_on: null,
			updated_at: "2026-07-25T14:02:00Z",
			updated_by_session: "019f9a07-22c5-7000-8bc0-291e2980660c",
		},
		runs: [
			{
				session_id: "019f9a07-22c5-7000-8bc0-291e2980660c",
				run_path: ".groundwork/runs/019f9a07-22c5-7000-8bc0-291e2980660c.json",
				started_at: "2026-07-25T13:40:00Z",
				ended_at: null,
				gate_advisor: "pending",
				slices_completed: ["F1"],
			},
		],
		history: [
			{
				at: "2026-07-25T13:30:00Z",
				session_id: "019f9a07-22c5-7000-8bc0-291e2980660c",
				type: "created",
				summary: "Feature ledger created",
				ref: null,
			},
			{
				at: "2026-07-25T14:02:00Z",
				session_id: "019f9a07-22c5-7000-8bc0-291e2980660c",
				type: "slice_complete",
				summary: "F1 image_sparse min-size + tests",
				ref: "F1",
			},
		],
		decisions: [
			{
				at: "2026-07-25T13:35:00Z",
				summary: "Min size enforced at image_sparse, not guest",
				adr: null,
			},
		],
		links: {
			linear_project_id: null,
			linear_issue_ids: [],
			github_issue: null,
			github_prs: [],
			handoffs: [],
		},
		gate: {
			advisor: "pending",
			last_verdict_at: null,
		},
		created_at: "2026-07-25T13:30:00Z",
		updated_at: "2026-07-25T14:02:00Z",
		created_by_session: "019f9a07-22c5-7000-8bc0-291e2980660c",
		...overrides,
	};
}

function writeFeatureYaml(
	doc: Record<string, unknown>,
	opts: { slug?: string; asDir?: boolean } = {},
): string {
	const slug = (opts.slug as string) || (doc.slug as string) || "fixture";
	const dir = path.join(projectDir, ".groundwork", "features", slug);
	mkdirSync(dir, { recursive: true });
	const file = path.join(dir, ".feature.yaml");
	writeFileSync(file, yamlDump(doc, { lineWidth: 120, noRefs: true }));
	return opts.asDir ? dir : file;
}

function writeSpec(slug: string, body: string) {
	const dir = path.join(projectDir, ".groundwork", "features", slug);
	mkdirSync(dir, { recursive: true });
	writeFileSync(path.join(dir, "spec.md"), body);
}

/** Run the CLI with CLAUDE_PROJECT_DIR pointing at the temp project. */
function run(args: string[]): { code: number; stdout: string; stderr: string } {
	const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir };
	delete env.CLAUDE_CODE_SESSION_ID;
	try {
		const stdout = execFileSync("node", [CLI, ...args], {
			env,
			encoding: "utf8",
		});
		return { code: 0, stdout, stderr: "" };
	} catch (e: unknown) {
		const err = e as { status?: number; stdout?: string; stderr?: string };
		return {
			code: err.status ?? 1,
			stdout: err.stdout ?? "",
			stderr: err.stderr ?? "",
		};
	}
}

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

describe("feature CLI — validate", () => {
	it("1. valid active ledger → exit 0", () => {
		const file = writeFeatureYaml(baseFeature());
		const r = run(["validate", file]);
		expect(r.code).toBe(0);
		expect(r.stdout).toMatch(/^OK\b/);
		expect(r.stdout).toContain("status=started");
	});

	it("1b. valid ledger via feature directory path → exit 0", () => {
		const dir = writeFeatureYaml(baseFeature(), { asDir: true });
		const r = run(["validate", dir]);
		expect(r.code).toBe(0);
		expect(r.stdout).toMatch(/^OK\b/);
	});

	it("2. additionalProperties drift (typo / extra field) → exit 1 AND names the field", () => {
		const doc = baseFeature();
		// intentional typo field to trip additionalProperties
		(doc as Record<string, unknown>)["stauts"] = "started";
		const file = writeFeatureYaml(doc);
		const r = run(["validate", file]);
		expect(r.code).toBe(1);
		const out = r.stderr + r.stdout;
		expect(out).toMatch(/stauts/);
		expect(out).toMatch(/unrecognized field|additionalProperties/i);
	});

	it("2b. nested additionalProperties on resume → names the field", () => {
		const doc = baseFeature();
		const resume = doc.resume as Record<string, unknown>;
		resume.extra_typo = "nope";
		const file = writeFeatureYaml(doc);
		const r = run(["validate", file]);
		expect(r.code).toBe(1);
		expect(r.stderr + r.stdout).toMatch(/resume\.extra_typo/);
	});

	it("3. bad status enum (in_progress) → exit 1", () => {
		const doc = baseFeature({ status: "in_progress" });
		const file = writeFeatureYaml(doc);
		const r = run(["validate", file]);
		expect(r.code).toBe(1);
		const out = r.stderr + r.stdout;
		expect(out).toMatch(/status/);
		expect(out).toMatch(/in_progress/);
	});

	it("4. invariant violation (status=completed + resume.pointer=slice:F2) → exit 1", () => {
		const doc = baseFeature({
			status: "completed",
			active: false,
			resume: {
				pointer: "slice:F2",
				slice_id: "F2",
				next_actions: [],
				blocked_reason: null,
				waiting_on: null,
			},
		});
		const file = writeFeatureYaml(doc);
		const r = run(["validate", file]);
		expect(r.code).toBe(1);
		const out = r.stderr + r.stdout;
		expect(out).toMatch(/invariant/i);
		expect(out).toMatch(/terminal|completed|pointer/i);
	});

	it("5. invariant violation (status=started + resume.pointer=null) → exit 1", () => {
		const doc = baseFeature({
			resume: {
				pointer: null,
				slice_id: null,
				next_actions: ["do something"],
				blocked_reason: null,
				waiting_on: null,
			},
		});
		const file = writeFeatureYaml(doc);
		const r = run(["validate", file]);
		expect(r.code).toBe(1);
		const out = r.stderr + r.stdout;
		expect(out).toMatch(/invariant/i);
		expect(out).toMatch(/active|started|pointer/i);
	});

	it("6. missing ac_coverage → exit 1", () => {
		const doc = baseFeature();
		delete doc.ac_coverage;
		const file = writeFeatureYaml(doc);
		const r = run(["validate", file]);
		expect(r.code).toBe(1);
		expect(r.stderr + r.stdout).toMatch(/ac_coverage/);
	});
});

// ---------------------------------------------------------------------------
// resume
// ---------------------------------------------------------------------------

describe("feature CLI — resume", () => {
	it("7. valid partial ledger → briefing with correct met/unmet ACs from ac_coverage+runs", () => {
		const slug = "workspace-disk-min-size";
		// F1 done → AC1+AC2 met; F2 not done → AC3 unmet
		writeFeatureYaml(baseFeature({ slug }), { slug });
		writeSpec(
			slug,
			`# Workspace disk min size\n\n## Goal\n\nEnforce a minimum sparse image size at provision time.\n\n## AC\n\n- AC1 ...\n`,
		);

		const r = run(["resume", slug]);
		expect(r.code).toBe(0);
		const out = r.stdout;

		// Goal from spec.md
		expect(out).toMatch(/Goal:.*minimum sparse image size/i);

		// Program counter
		expect(out).toMatch(/pointer:\s*"slice:F2"/);
		expect(out).toMatch(/slice_id:\s*"F2"/);

		// Next actions present
		expect(out).toMatch(/Implement guest agent undersized-disk error path/);

		// AC derivation: AC1/AC2 met (F1 complete), AC3 unmet (F2 missing)
		expect(out).toMatch(/MET\s+AC1/);
		expect(out).toMatch(/MET\s+AC2/);
		expect(out).toMatch(/UNMET\s+AC3/);
		expect(out).toMatch(/missing slices:\s*F2/);

		// completed union
		expect(out).toMatch(/completed slices.*\bF1\b/);
	});

	it("8. resume tolerates null runs[].run_path without failing", () => {
		const slug = "null-run-path-fixture";
		const doc = baseFeature({
			id: "feat_null-run-path-fixture",
			slug,
			runs: [
				{
					session_id: "sess-pruned",
					run_path: null,
					started_at: "2026-07-20T10:00:00Z",
					ended_at: "2026-07-20T12:00:00Z",
					gate_advisor: "APPROVE",
					slices_completed: ["F1"],
				},
			],
		});
		writeFeatureYaml(doc, { slug });
		writeSpec(slug, `## Goal\n\nTolerate pruned run ledgers.\n`);

		const r = run(["resume", slug]);
		expect(r.code).toBe(0);
		expect(r.stdout).toMatch(/run_path=null/);
		expect(r.stdout).toMatch(/NOTE:.*null\/absent run_path|pruned/i);
		// Still derives AC met from slices_completed even with null path
		expect(r.stdout).toMatch(/MET\s+AC1/);
		expect(r.stdout).toMatch(/UNMET\s+AC3/);
	});

	it("resume on invalid ledger exits 1 with validation errors", () => {
		const slug = "bad-feature";
		writeFeatureYaml(
			baseFeature({
				id: "feat_bad-feature",
				slug,
				status: "in_progress",
			}),
			{ slug },
		);
		const r = run(["resume", slug]);
		expect(r.code).toBe(1);
		expect(r.stderr + r.stdout).toMatch(/INVALID|status|in_progress/);
	});
});
