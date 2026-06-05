import { describe, test, expect, afterEach } from "bun:test";
import {
	detectPtyPlugin,
	setPtyPluginAvailable,
	getBootstrapForAgent,
} from "../src/lib/skills.js";

describe("detectPtyPlugin", () => {
	test('returns true for ["opencode-pty"]', () => {
		expect(detectPtyPlugin(["opencode-pty"])).toBe(true);
	});

	test('returns true for [["opencode-pty", {}]]', () => {
		expect(detectPtyPlugin([["opencode-pty", {}]])).toBe(true);
	});

	test('returns true for ["some-plugin", "opencode-pty"]', () => {
		expect(detectPtyPlugin(["some-plugin", "opencode-pty"])).toBe(true);
	});

	test('returns false for ["some-other-plugin"]', () => {
		expect(detectPtyPlugin(["some-other-plugin"])).toBe(false);
	});

	test("returns false for []", () => {
		expect(detectPtyPlugin([])).toBe(false);
	});

	test("returns false for non-array input", () => {
		expect(detectPtyPlugin(null)).toBe(false);
		expect(detectPtyPlugin(undefined)).toBe(false);
		expect(detectPtyPlugin("opencode-pty")).toBe(false);
		expect(detectPtyPlugin({ plugins: ["opencode-pty"] })).toBe(false);
	});
});

describe("getBootstrapForAgent aliases", () => {
	afterEach(() => {
		setPtyPluginAvailable(false);
	});

	test("general-purpose receives orchestrator hard rules", () => {
		const content = getBootstrapForAgent("general-purpose");
		expect(content).not.toBeNull();
		expect(content).toContain("ORCHESTRATOR HARD RULES");
		expect(content).toContain("EXTREMELY_IMPORTANT");
	});

	test("orchestrator alias receives orchestrator bootstrap", () => {
		const content = getBootstrapForAgent("orchestrator");
		expect(content).toContain("Orchestrator Bootstrap");
		expect(content).toContain("Fan-Out Maximization");
	});

	test("coder receives coder bootstrap", () => {
		expect(getBootstrapForAgent("coder")).toContain("Groundwork Coder Rules");
	});
});

describe("conditional bootstrap content", () => {
	afterEach(() => {
		setPtyPluginAvailable(false);
	});

	test("includes PTY content when pty plugin is available", () => {
		setPtyPluginAvailable(true);
		const content = getBootstrapForAgent("orchestrator");
		expect(content).not.toBeNull();
		expect(content).toContain("pty_spawn");
		expect(content).toContain("PTY");
	});

	test("excludes PTY content when pty plugin is unavailable", () => {
		setPtyPluginAvailable(false);
		const content = getBootstrapForAgent("orchestrator");
		expect(content).not.toBeNull();
		expect(content).not.toContain("pty_spawn");
		expect(content).not.toContain("PTY");
	});

	test("cache key differentiates pty=true vs pty=false", () => {
		setPtyPluginAvailable(true);
		const withPty = getBootstrapForAgent("orchestrator");

		setPtyPluginAvailable(false);
		const withoutPty = getBootstrapForAgent("orchestrator");

		expect(withPty).not.toBeNull();
		expect(withoutPty).not.toBeNull();
		expect(withPty).not.toBe(withoutPty);
		expect(withPty).toContain("pty_spawn");
		expect(withoutPty).not.toContain("pty_spawn");
	});
});
