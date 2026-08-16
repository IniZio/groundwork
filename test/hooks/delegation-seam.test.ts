/**
 * delegation-seam — guards cross-surface consistency of the fan-out bounds
 * (floor AND ceiling) for junior-orchestrator and general-purpose.
 *
 * Surfaces checked:
 *
 *   TABLE format (per-agent junior + gp rows, both floor and ceiling):
 *     - agents-src/orchestrator.md              [AUTHORITY]
 *     - hooks/session-reminder.mjs
 *     - agents-pi/orchestrator.md
 *     - skills/groundwork/use-groundwork/reference/fan-out-patterns.md
 *
 *   JUNIOR-ONLY inline format (CLAUDE.md; gp has no separate range):
 *     - CLAUDE.md                               (routing table row for Feature classification)
 *     gp exclusion: the Feature row reads
 *       "5–20 `junior-orchestrator` (default) or `general-purpose` (leaf — …)"
 *     with ONE numeric range covering both agents. No separate per-agent range
 *     for general-purpose exists in this surface.
 *
 *   COMBINED prose format (wave ceiling covering both agents equally):
 *     - skills/groundwork/implement/SKILL.md    ("N–M parallel agents per wave")
 *     - skills/groundwork/use-groundwork/reference/agent-selection.md ("launch N–M parallel tasks")
 *     Both floor AND ceiling are compared to the authority. These surfaces do not
 *     carry a per-agent split, but the combined wave width must equal the authority's
 *     per-agent bounds (all agents share the same 5–20 range).
 *
 * Design property: surfaces are compared to each other (orchestrator.md as authority),
 * never to hardcoded values. A consistent future rule change stays green; a lagging
 * surface fails. Extractors THROW a descriptive error on parse failure — a test that
 * silently skips when it cannot parse is worse than no test.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");

function read(relPath: string): string {
	return readFileSync(resolve(REPO_ROOT, relPath), "utf8");
}

interface Bounds {
	floor: number;
	ceiling: number;
}

interface AgentBounds extends Bounds {
	isDefault: boolean;
}

// ---------------------------------------------------------------------------
// Per-agent table/list extractors — return junior + gp bounds separately
// ---------------------------------------------------------------------------

/** agents-src/orchestrator.md — Per-wave fan-out targets table (AUTHORITY). */
function fromOrchestratorMd(): { junior: AgentBounds; gp: Bounds } {
	const file = "agents-src/orchestrator.md";
	const text = read(file);

	const jm = text.match(/\|\s*`junior-orchestrator`\s*\|\s*(\d+)[-–](\d+)\s*\(([^|]+)\)/);
	if (!jm)
		throw new Error(
			`${file}: junior-orchestrator row not found in per-wave fan-out table.\n` +
				"Expected: | `junior-orchestrator` | N–M (DEFAULT...) |",
		);

	const gm = text.match(/\|\s*`general-purpose`\s*\|\s*(\d+)[-–](\d+)\s*\(/);
	if (!gm)
		throw new Error(
			`${file}: general-purpose row not found in per-wave fan-out table.\n` +
				"Expected: | `general-purpose` | N–M (...) |",
		);

	return {
		junior: {
			floor: parseInt(jm[1], 10),
			ceiling: parseInt(jm[2], 10),
			isDefault: /DEFAULT/i.test(jm[3]),
		},
		gp: { floor: parseInt(gm[1], 10), ceiling: parseInt(gm[2], 10) },
	};
}

/**
 * hooks/session-reminder.mjs — SessionStart injection fan-out table.
 * The table lives inside a JS template string; backticks appear as \` in source.
 */
function fromSessionReminder(): { junior: AgentBounds; gp: Bounds } {
	const file = "hooks/session-reminder.mjs";
	const text = read(file);

	const jm = text.match(/\|\s*\\`junior-orchestrator\\`\s*\|\s*(\d+)[-–](\d+)\s*\(([^|]+)\)/);
	if (!jm)
		throw new Error(
			`${file}: junior-orchestrator row not found in fan-out table (inside template string).\n` +
				"Expected: | \\`junior-orchestrator\\` | N–M (DEFAULT...) |",
		);

	const gm = text.match(/\|\s*\\`general-purpose\\`\s*\|\s*(\d+)[-–](\d+)\s*\(/);
	if (!gm)
		throw new Error(
			`${file}: general-purpose row not found in fan-out table (inside template string).\n` +
				"Expected: | \\`general-purpose\\` | N–M (...) |",
		);

	return {
		junior: {
			floor: parseInt(jm[1], 10),
			ceiling: parseInt(jm[2], 10),
			isDefault: /DEFAULT/i.test(jm[3]),
		},
		gp: { floor: parseInt(gm[1], 10), ceiling: parseInt(gm[2], 10) },
	};
}

/** agents-pi/orchestrator.md — Pi-overlay; same table format as agents-src/orchestrator.md. */
function fromAgentsPiOrchestrator(): { junior: AgentBounds; gp: Bounds } {
	const file = "agents-pi/orchestrator.md";
	const text = read(file);

	const jm = text.match(/\|\s*`junior-orchestrator`\s*\|\s*(\d+)[-–](\d+)\s*\(([^|]+)\)/);
	if (!jm)
		throw new Error(
			`${file}: junior-orchestrator row not found in per-wave fan-out table.\n` +
				"Expected: | `junior-orchestrator` | N–M (DEFAULT...) |",
		);

	const gm = text.match(/\|\s*`general-purpose`\s*\|\s*(\d+)[-–](\d+)\s*\(/);
	if (!gm)
		throw new Error(
			`${file}: general-purpose row not found in per-wave fan-out table.\n` +
				"Expected: | `general-purpose` | N–M (...) |",
		);

	return {
		junior: {
			floor: parseInt(jm[1], 10),
			ceiling: parseInt(jm[2], 10),
			isDefault: /DEFAULT/i.test(jm[3]),
		},
		gp: { floor: parseInt(gm[1], 10), ceiling: parseInt(gm[2], 10) },
	};
}

/**
 * skills/groundwork/use-groundwork/reference/fan-out-patterns.md — per-agent list.
 * "- **junior-orchestrator:** 5–20 parallel tasks for ... (DEFAULT — one per slice)"
 * "- **general-purpose:** 5–20 parallel tasks for leaf carve-outs (...)"
 */
function fromFanOutPatterns(): { junior: AgentBounds; gp: Bounds } {
	const file = "skills/groundwork/use-groundwork/reference/fan-out-patterns.md";
	const text = read(file);

	const jm = text.match(
		/- \*\*junior-orchestrator:\*\* (\d+)[-–](\d+) parallel tasks[^(\n]*\(([^)]+)\)/,
	);
	if (!jm)
		throw new Error(
			`${file}: junior-orchestrator list item not found.\n` +
				"Expected: - **junior-orchestrator:** N–M parallel tasks ... (DEFAULT ...)",
		);

	const gm = text.match(/- \*\*general-purpose:\*\* (\d+)[-–](\d+) parallel tasks/);
	if (!gm)
		throw new Error(
			`${file}: general-purpose list item not found.\n` +
				"Expected: - **general-purpose:** N–M parallel tasks ...",
		);

	return {
		junior: {
			floor: parseInt(jm[1], 10),
			ceiling: parseInt(jm[2], 10),
			isDefault: /DEFAULT/i.test(jm[3]),
		},
		gp: { floor: parseInt(gm[1], 10), ceiling: parseInt(gm[2], 10) },
	};
}

// ---------------------------------------------------------------------------
// Junior-only extractor — CLAUDE.md
// ---------------------------------------------------------------------------
// gp exclusion: the Feature routing row reads
//   "5–20 `junior-orchestrator` (default) or `general-purpose` (leaf — …)"
// One numeric range covers both agents; there is no separate per-agent ceiling
// for general-purpose in this surface. gp cannot be independently extracted here.

/**
 * CLAUDE.md — routing table (no standalone fan-out table).
 * Pattern in the Feature row: "N–M `junior-orchestrator` (default)"
 */
function fromClaudeMd(): { junior: AgentBounds } {
	const file = "CLAUDE.md";
	const text = read(file);

	const jm = text.match(/(\d+)[-–](\d+)\s*`junior-orchestrator`\s*\(default\)/i);
	if (!jm)
		throw new Error(
			`${file}: junior-orchestrator ceiling not found in routing table.\n` +
				"Expected: N–M `junior-orchestrator` (default) inside the Feature row.\n" +
				"Note: CLAUDE.md uses an inline routing table, not a standalone fan-out table.\n" +
				"If the routing table format changed, update this extractor.",
		);

	// The regex requires `(default)` — isDefault is guaranteed true on a successful match.
	return {
		junior: { floor: parseInt(jm[1], 10), ceiling: parseInt(jm[2], 10), isDefault: true },
	};
}

// ---------------------------------------------------------------------------
// Combined-ceiling extractors — wave-level prose (no per-agent split)
// ---------------------------------------------------------------------------
// These surfaces state the per-wave width as one range covering all agents.
// Junior-orchestrator is the default and both junior/gp share the same ceiling
// in the authority, so the combined wave range must equal the authority's bounds.
// Floor drift (e.g. "1–20") and ceiling drift (e.g. "5–15") are both caught.

/** skills/groundwork/implement/SKILL.md — "N–M parallel agents per wave is the target". */
function fromImplementSkill(): Bounds {
	const file = "skills/groundwork/implement/SKILL.md";
	const text = read(file);

	const m = text.match(/(\d+)[-–](\d+) parallel agents per wave/);
	if (!m)
		throw new Error(
			`${file}: combined wave ceiling not found.\n` +
				"Expected: N–M parallel agents per wave is the target",
		);

	return { floor: parseInt(m[1], 10), ceiling: parseInt(m[2], 10) };
}

/**
 * skills/groundwork/use-groundwork/reference/agent-selection.md —
 * "launch N–M parallel tasks (default `junior-orchestrator` per slice; ...)"
 */
function fromAgentSelection(): Bounds {
	const file = "skills/groundwork/use-groundwork/reference/agent-selection.md";
	const text = read(file);

	const m = text.match(/launch (\d+)[-–](\d+) parallel tasks/);
	if (!m)
		throw new Error(
			`${file}: combined wave ceiling not found.\n` +
				"Expected: launch N–M parallel tasks (default `junior-orchestrator` per slice; ...)",
		);

	return { floor: parseInt(m[1], 10), ceiling: parseInt(m[2], 10) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("delegation-seam parity", () => {
	it("junior-orchestrator floor AND ceiling agree across all surfaces", () => {
		const authority = fromOrchestratorMd();
		const reminder = fromSessionReminder();
		const claude = fromClaudeMd();
		const agentsPi = fromAgentsPiOrchestrator();
		const fanOut = fromFanOutPatterns();
		const impl = fromImplementSkill();
		const agentSel = fromAgentSelection();

		// --- hooks/session-reminder.mjs ---
		expect(
			reminder.junior.floor,
			`junior floor mismatch: hooks/session-reminder.mjs says ${reminder.junior.floor} ` +
				`but agents-src/orchestrator.md (authority) says ${authority.junior.floor}`,
		).toBe(authority.junior.floor);
		expect(
			reminder.junior.ceiling,
			`junior ceiling mismatch: hooks/session-reminder.mjs says ${reminder.junior.ceiling} ` +
				`but agents-src/orchestrator.md (authority) says ${authority.junior.ceiling}`,
		).toBe(authority.junior.ceiling);

		// --- CLAUDE.md ---
		expect(
			claude.junior.floor,
			`junior floor mismatch: CLAUDE.md says ${claude.junior.floor} ` +
				`but agents-src/orchestrator.md (authority) says ${authority.junior.floor}`,
		).toBe(authority.junior.floor);
		expect(
			claude.junior.ceiling,
			`junior ceiling mismatch: CLAUDE.md says ${claude.junior.ceiling} ` +
				`but agents-src/orchestrator.md (authority) says ${authority.junior.ceiling}`,
		).toBe(authority.junior.ceiling);

		// --- agents-pi/orchestrator.md ---
		expect(
			agentsPi.junior.floor,
			`junior floor mismatch: agents-pi/orchestrator.md says ${agentsPi.junior.floor} ` +
				`but agents-src/orchestrator.md (authority) says ${authority.junior.floor}`,
		).toBe(authority.junior.floor);
		expect(
			agentsPi.junior.ceiling,
			`junior ceiling mismatch: agents-pi/orchestrator.md says ${agentsPi.junior.ceiling} ` +
				`but agents-src/orchestrator.md (authority) says ${authority.junior.ceiling}`,
		).toBe(authority.junior.ceiling);

		// --- skills/groundwork/use-groundwork/reference/fan-out-patterns.md ---
		expect(
			fanOut.junior.floor,
			`junior floor mismatch: skills/groundwork/use-groundwork/reference/fan-out-patterns.md says ${fanOut.junior.floor} ` +
				`but agents-src/orchestrator.md (authority) says ${authority.junior.floor}`,
		).toBe(authority.junior.floor);
		expect(
			fanOut.junior.ceiling,
			`junior ceiling mismatch: skills/groundwork/use-groundwork/reference/fan-out-patterns.md says ${fanOut.junior.ceiling} ` +
				`but agents-src/orchestrator.md (authority) says ${authority.junior.ceiling}`,
		).toBe(authority.junior.ceiling);

		// --- skills/groundwork/implement/SKILL.md (combined wave ceiling) ---
		expect(
			impl.floor,
			`wave floor mismatch: skills/groundwork/implement/SKILL.md says ${impl.floor} ` +
				`but agents-src/orchestrator.md (authority) says ${authority.junior.floor}`,
		).toBe(authority.junior.floor);
		expect(
			impl.ceiling,
			`wave ceiling mismatch: skills/groundwork/implement/SKILL.md says ${impl.ceiling} ` +
				`but agents-src/orchestrator.md (authority) says ${authority.junior.ceiling}`,
		).toBe(authority.junior.ceiling);

		// --- skills/groundwork/use-groundwork/reference/agent-selection.md (combined) ---
		expect(
			agentSel.floor,
			`wave floor mismatch: skills/groundwork/use-groundwork/reference/agent-selection.md says ${agentSel.floor} ` +
				`but agents-src/orchestrator.md (authority) says ${authority.junior.floor}`,
		).toBe(authority.junior.floor);
		expect(
			agentSel.ceiling,
			`wave ceiling mismatch: skills/groundwork/use-groundwork/reference/agent-selection.md says ${agentSel.ceiling} ` +
				`but agents-src/orchestrator.md (authority) says ${authority.junior.ceiling}`,
		).toBe(authority.junior.ceiling);
	});

	it("general-purpose floor AND ceiling agree across surfaces with per-agent rows", () => {
		// CLAUDE.md excluded: Feature row has one range for both agents ("5–20 `junior-orchestrator`
		// (default) or `general-purpose` (leaf — …)") — no separate per-agent range for gp.
		// implement/SKILL.md and agent-selection.md excluded: combined prose, no per-agent split.
		const authority = fromOrchestratorMd();
		const reminder = fromSessionReminder();
		const agentsPi = fromAgentsPiOrchestrator();
		const fanOut = fromFanOutPatterns();

		// --- hooks/session-reminder.mjs ---
		expect(
			reminder.gp.floor,
			`gp floor mismatch: hooks/session-reminder.mjs says ${reminder.gp.floor} ` +
				`but agents-src/orchestrator.md (authority) says ${authority.gp.floor}`,
		).toBe(authority.gp.floor);
		expect(
			reminder.gp.ceiling,
			`gp ceiling mismatch: hooks/session-reminder.mjs says ${reminder.gp.ceiling} ` +
				`but agents-src/orchestrator.md (authority) says ${authority.gp.ceiling}`,
		).toBe(authority.gp.ceiling);

		// --- agents-pi/orchestrator.md ---
		expect(
			agentsPi.gp.floor,
			`gp floor mismatch: agents-pi/orchestrator.md says ${agentsPi.gp.floor} ` +
				`but agents-src/orchestrator.md (authority) says ${authority.gp.floor}`,
		).toBe(authority.gp.floor);
		expect(
			agentsPi.gp.ceiling,
			`gp ceiling mismatch: agents-pi/orchestrator.md says ${agentsPi.gp.ceiling} ` +
				`but agents-src/orchestrator.md (authority) says ${authority.gp.ceiling}`,
		).toBe(authority.gp.ceiling);

		// --- skills/groundwork/use-groundwork/reference/fan-out-patterns.md ---
		expect(
			fanOut.gp.floor,
			`gp floor mismatch: skills/groundwork/use-groundwork/reference/fan-out-patterns.md says ${fanOut.gp.floor} ` +
				`but agents-src/orchestrator.md (authority) says ${authority.gp.floor}`,
		).toBe(authority.gp.floor);
		expect(
			fanOut.gp.ceiling,
			`gp ceiling mismatch: skills/groundwork/use-groundwork/reference/fan-out-patterns.md says ${fanOut.gp.ceiling} ` +
				`but agents-src/orchestrator.md (authority) says ${authority.gp.ceiling}`,
		).toBe(authority.gp.ceiling);
	});

	it("junior-orchestrator is named as DEFAULT in all surfaces that carry the designation", () => {
		const authority = fromOrchestratorMd();
		const reminder = fromSessionReminder();
		const claude = fromClaudeMd();
		const agentsPi = fromAgentsPiOrchestrator();
		const fanOut = fromFanOutPatterns();

		expect(
			authority.junior.isDefault,
			"agents-src/orchestrator.md: junior-orchestrator not marked as DEFAULT in fan-out table",
		).toBe(true);
		expect(
			reminder.junior.isDefault,
			"hooks/session-reminder.mjs: junior-orchestrator not marked as DEFAULT in fan-out table",
		).toBe(true);
		expect(
			claude.junior.isDefault,
			'CLAUDE.md: junior-orchestrator not marked as DEFAULT in routing table. ' +
				'Expected "(default)" in the Feature row.',
		).toBe(true);
		expect(
			agentsPi.junior.isDefault,
			"agents-pi/orchestrator.md: junior-orchestrator not marked as DEFAULT in fan-out table",
		).toBe(true);
		expect(
			fanOut.junior.isDefault,
			"skills/groundwork/use-groundwork/reference/fan-out-patterns.md: junior-orchestrator not marked as DEFAULT in list",
		).toBe(true);
	});
});
