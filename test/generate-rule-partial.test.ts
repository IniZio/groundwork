import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
	buildRulePartial,
	injectRulePartial,
	RULE_PARTIAL_REGISTRY,
} from "../scripts/generate-agent-definitions.js";

const root = join(__dirname, "..");

// ─── buildRulePartial ─────────────────────────────────────────────────────────

describe("buildRulePartial", () => {
	test("reads the fan-out-targets partial from disk", () => {
		const content = buildRulePartial("fan-out-targets");
		expect(content).toContain("| Agent | Tasks per wave |");
		expect(content).toContain("| `junior-orchestrator` | 5–20 (DEFAULT — one per slice) |");
		expect(content).toContain("| `general-purpose` | 5–20 (leaf carve-out only) |");
		expect(content).toContain("| `explore` | 3–7 (one per area/module) |");
		expect(content).toContain("| `designer` | 2–5 |");
		expect(content).toContain("| `advisor` | 1–2 (decision gates only) |");
		expect(content).toContain("CEILINGS, not quotas");
	});

	test("partial content matches agents-src/junior-orchestrator.md marker region", () => {
		const partial = buildRulePartial("fan-out-targets");
		const juniorSrc = readFileSync(join(root, "agents-src", "junior-orchestrator.md"), "utf8");
		const BEGIN = "<!-- FANOUT-TARGETS:BEGIN -->";
		const END = "<!-- FANOUT-TARGETS:END -->";
		const beginIdx = juniorSrc.indexOf(BEGIN);
		const endIdx = juniorSrc.indexOf(END);
		expect(beginIdx).toBeGreaterThan(-1);
		expect(endIdx).toBeGreaterThan(beginIdx);
		const beginLineEnd = juniorSrc.indexOf("\n", beginIdx);
		const regionContent = juniorSrc.slice(beginLineEnd + 1, endIdx);
		expect(regionContent).toBe(partial);
	});
});

// ─── RULE_PARTIAL_REGISTRY ────────────────────────────────────────────────────

describe("RULE_PARTIAL_REGISTRY", () => {
	test("contains exactly 9 entries (4 for junior-orchestrator + 2 for orchestrator + 2 for CLAUDE.md/task-scoping + 1 for vertical-slice SKILL.md)", () => {
		expect(RULE_PARTIAL_REGISTRY).toHaveLength(9);
	});

	test("every entry has partial, beginMarker, endMarker, targetPath fields", () => {
		for (const entry of RULE_PARTIAL_REGISTRY) {
			expect(typeof entry.partial).toBe("string");
			expect(typeof entry.beginMarker).toBe("string");
			expect(typeof entry.endMarker).toBe("string");
			expect(typeof entry.targetPath).toBe("string");
		}
	});

	test("all four partial names are registered", () => {
		const names = RULE_PARTIAL_REGISTRY.map((e) => e.partial);
		expect(names).toContain("fan-out-targets");
		expect(names).toContain("one-message-parallel");
		expect(names).toContain("vertical-slice-gate");
		expect(names).toContain("context-isolation-template");
	});

	test("every registry entry: partial content matches its target file marker region", () => {
		// This loop iterates ALL entries in RULE_PARTIAL_REGISTRY, so a 10th entry
		// is automatically covered with no test edit required.
		for (const entry of RULE_PARTIAL_REGISTRY) {
			const partial = buildRulePartial(entry.partial);
			const targetSrc = readFileSync(entry.targetPath, "utf8");
			const beginIdx = targetSrc.indexOf(entry.beginMarker);
			const endIdx = targetSrc.indexOf(entry.endMarker);
			expect(
				beginIdx,
				`${entry.targetPath}: ${entry.beginMarker} not found`,
			).toBeGreaterThan(-1);
			expect(
				endIdx,
				`${entry.targetPath}: ${entry.endMarker} after begin`,
			).toBeGreaterThan(beginIdx);
			const beginLineEnd = targetSrc.indexOf("\n", beginIdx);
			const regionContent = targetSrc.slice(beginLineEnd + 1, endIdx);
			expect(
				regionContent,
				`${entry.targetPath}: ${entry.partial} partial drift`,
			).toBe(partial);
		}
	});
});

// ─── one-message-parallel partial ────────────────────────────────────────────

describe("buildRulePartial — one-message-parallel", () => {
	test("reads the one-message-parallel partial from disk", () => {
		const content = buildRulePartial("one-message-parallel");
		expect(content).toContain("ONE message");
		expect(content).toContain("sequential");
		expect(content).toContain("blocked_by");
		expect(content).toContain("independent");
	});

	test("partial content matches agents-src/junior-orchestrator.md ONE-MESSAGE-PARALLEL region", () => {
		const partial = buildRulePartial("one-message-parallel");
		const juniorSrc = readFileSync(join(root, "agents-src", "junior-orchestrator.md"), "utf8");
		const BEGIN = "<!-- ONE-MESSAGE-PARALLEL:BEGIN -->";
		const END = "<!-- ONE-MESSAGE-PARALLEL:END -->";
		const beginIdx = juniorSrc.indexOf(BEGIN);
		const endIdx = juniorSrc.indexOf(END);
		expect(beginIdx).toBeGreaterThan(-1);
		expect(endIdx).toBeGreaterThan(beginIdx);
		const beginLineEnd = juniorSrc.indexOf("\n", beginIdx);
		const regionContent = juniorSrc.slice(beginLineEnd + 1, endIdx);
		expect(regionContent).toBe(partial);
	});
});

// ─── vertical-slice-gate partial ─────────────────────────────────────────────

describe("buildRulePartial — vertical-slice-gate", () => {
	test("reads the vertical-slice-gate partial from disk", () => {
		const content = buildRulePartial("vertical-slice-gate");
		expect(content).toContain("vertical slice");
		expect(content).toContain("ONE outcome");
		expect(content).toContain("tracer-bullet");
		expect(content).toContain("blocked_by");
		expect(content).toContain("Single-slice waves");
		expect(content).toContain("Wave 0");
		expect(content).toContain("test file");
		expect(content).toContain("single-owner");
	});

	test("partial content matches agents-src/junior-orchestrator.md VERTICAL-SLICE-GATE region", () => {
		const partial = buildRulePartial("vertical-slice-gate");
		const juniorSrc = readFileSync(join(root, "agents-src", "junior-orchestrator.md"), "utf8");
		const BEGIN = "<!-- VERTICAL-SLICE-GATE:BEGIN -->";
		const END = "<!-- VERTICAL-SLICE-GATE:END -->";
		const beginIdx = juniorSrc.indexOf(BEGIN);
		const endIdx = juniorSrc.indexOf(END);
		expect(beginIdx).toBeGreaterThan(-1);
		expect(endIdx).toBeGreaterThan(beginIdx);
		const beginLineEnd = juniorSrc.indexOf("\n", beginIdx);
		const regionContent = juniorSrc.slice(beginLineEnd + 1, endIdx);
		expect(regionContent).toBe(partial);
	});
});

// ─── context-isolation-template partial ──────────────────────────────────────

describe("buildRulePartial — context-isolation-template", () => {
	test("reads the context-isolation-template partial from disk", () => {
		const content = buildRulePartial("context-isolation-template");
		expect(content).toContain("session history");
		expect(content).toContain("self-contained");
		expect(content).toContain("SUCCESS CRITERIA");
		expect(content).toContain("model:");
		expect(content).toContain("SCOPE");
		expect(content).toContain("MOTIVE:");
		expect(content).not.toContain("PLAN:");
		expect(content).not.toContain("Wave 0");
		expect(content).not.toContain("test file");
		expect(content).not.toContain("single-owner");
	});

	test("partial content matches agents-src/junior-orchestrator.md CONTEXT-ISOLATION-TEMPLATE region", () => {
		const partial = buildRulePartial("context-isolation-template");
		const juniorSrc = readFileSync(join(root, "agents-src", "junior-orchestrator.md"), "utf8");
		const BEGIN = "<!-- CONTEXT-ISOLATION-TEMPLATE:BEGIN -->";
		const END = "<!-- CONTEXT-ISOLATION-TEMPLATE:END -->";
		const beginIdx = juniorSrc.indexOf(BEGIN);
		const endIdx = juniorSrc.indexOf(END);
		expect(beginIdx).toBeGreaterThan(-1);
		expect(endIdx).toBeGreaterThan(beginIdx);
		const beginLineEnd = juniorSrc.indexOf("\n", beginIdx);
		const regionContent = juniorSrc.slice(beginLineEnd + 1, endIdx);
		expect(regionContent).toBe(partial);
	});

	test("partial content matches CLAUDE.md CONTEXT-ISOLATION-TEMPLATE region", () => {
		const partial = buildRulePartial("context-isolation-template");
		const claudeSrc = readFileSync(join(root, "CLAUDE.md"), "utf8");
		const BEGIN = "<!-- CONTEXT-ISOLATION-TEMPLATE:BEGIN -->";
		const END = "<!-- CONTEXT-ISOLATION-TEMPLATE:END -->";
		const beginIdx = claudeSrc.indexOf(BEGIN);
		const endIdx = claudeSrc.indexOf(END);
		expect(beginIdx).toBeGreaterThan(-1);
		expect(endIdx).toBeGreaterThan(beginIdx);
		const beginLineEnd = claudeSrc.indexOf("\n", beginIdx);
		const regionContent = claudeSrc.slice(beginLineEnd + 1, endIdx);
		expect(regionContent).toBe(partial);
	});

	test("partial content matches skills/groundwork/use-groundwork/reference/task-scoping.md CONTEXT-ISOLATION-TEMPLATE region", () => {
		const partial = buildRulePartial("context-isolation-template");
		const taskScopingSrc = readFileSync(
			join(root, "skills", "groundwork", "use-groundwork", "reference", "task-scoping.md"),
			"utf8",
		);
		const BEGIN = "<!-- CONTEXT-ISOLATION-TEMPLATE:BEGIN -->";
		const END = "<!-- CONTEXT-ISOLATION-TEMPLATE:END -->";
		const beginIdx = taskScopingSrc.indexOf(BEGIN);
		const endIdx = taskScopingSrc.indexOf(END);
		expect(beginIdx).toBeGreaterThan(-1);
		expect(endIdx).toBeGreaterThan(beginIdx);
		const beginLineEnd = taskScopingSrc.indexOf("\n", beginIdx);
		const regionContent = taskScopingSrc.slice(beginLineEnd + 1, endIdx);
		expect(regionContent).toBe(partial);
	});
});

// ─── injectRulePartial ────────────────────────────────────────────────────────

const BEGIN = "<!-- TEST-RULE:BEGIN -->";
const END = "<!-- TEST-RULE:END -->";
const FIXTURE_DIR = join(root, "test", "fixtures", "rule-partial");
const FIXTURE_FILE = join(FIXTURE_DIR, "target.md");

function writeFixture(content: string): void {
	mkdirSync(FIXTURE_DIR, { recursive: true });
	writeFileSync(FIXTURE_FILE, content, "utf8");
}

function readFixture(): string {
	return readFileSync(FIXTURE_FILE, "utf8");
}

afterEach(() => {
	// Leave fixture dir; each test writes its own content.
});

describe("injectRulePartial", () => {
	test("injects content between markers", () => {
		const initial = `# Doc\n${BEGIN}\nold content\n${END}\nafter\n`;
		writeFixture(initial);
		injectRulePartial(FIXTURE_FILE, BEGIN, END, "new content\n");
		const result = readFixture();
		expect(result).toBe(`# Doc\n${BEGIN}\nnew content\n${END}\nafter\n`);
	});

	test("idempotent — second call with same content makes no change", () => {
		const initial = `# Doc\n${BEGIN}\nsome content\n${END}\nafter\n`;
		writeFixture(initial);
		injectRulePartial(FIXTURE_FILE, BEGIN, END, "some content\n");
		const after1 = readFixture();
		injectRulePartial(FIXTURE_FILE, BEGIN, END, "some content\n");
		const after2 = readFixture();
		expect(after1).toBe(after2);
	});

	test("preserves all content outside the marker region", () => {
		const initial = `BEFORE\n${BEGIN}\nold\n${END}\nAFTER\n`;
		writeFixture(initial);
		injectRulePartial(FIXTURE_FILE, BEGIN, END, "new\n");
		const result = readFixture();
		expect(result.startsWith("BEFORE\n")).toBe(true);
		expect(result.endsWith(`${END}\nAFTER\n`)).toBe(true);
	});

	test("throws when BEGIN marker is missing", () => {
		writeFixture(`# Doc\n${END}\n`);
		expect(() => injectRulePartial(FIXTURE_FILE, BEGIN, END, "x")).toThrow(/not found/);
	});

	test("throws when END marker is missing", () => {
		writeFixture(`# Doc\n${BEGIN}\nsome content\n`);
		expect(() => injectRulePartial(FIXTURE_FILE, BEGIN, END, "x")).toThrow(/not found/);
	});

	test("throws when END appears before BEGIN", () => {
		writeFixture(`# Doc\n${END}\n${BEGIN}\ncontent\n`);
		expect(() => injectRulePartial(FIXTURE_FILE, BEGIN, END, "x")).toThrow(/appears before/);
	});
});
