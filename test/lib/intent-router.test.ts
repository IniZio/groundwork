import { describe, test, expect } from "vitest";
import { inferLaneIntent, routeTaskToRole } from "../../src/lib/intent-router.js";

describe("inferLaneIntent", () => {
	test("detects build-fix intent", () => {
		expect(inferLaneIntent("tsc error in module.ts")).toBe("build-fix");
		expect(inferLaneIntent("The build fails on CI")).toBe("build-fix");
		expect(inferLaneIntent("compile error in main.ts")).toBe("build-fix");
	});

	test("detects debug intent", () => {
		expect(inferLaneIntent("debug the login flow")).toBe("debug");
		expect(inferLaneIntent("fix bug in pagination")).toBe("debug");
		expect(inferLaneIntent("stack trace shows null reference")).toBe("debug");
		expect(inferLaneIntent("the button is not working")).toBe("debug");
	});

	test("detects docs intent", () => {
		expect(inferLaneIntent("write docs for the API")).toBe("docs");
		expect(inferLaneIntent("update the README")).toBe("docs");
		expect(inferLaneIntent("add jsdoc comments to utils")).toBe("docs");
	});

	test("detects design intent", () => {
		expect(inferLaneIntent("improve the UI layout")).toBe("design");
		expect(inferLaneIntent("fix responsive styling")).toBe("design");
		expect(inferLaneIntent("update CSS for dark mode")).toBe("design");
	});

	test("detects cleanup intent", () => {
		expect(inferLaneIntent("refactor the auth module")).toBe("cleanup");
		expect(inferLaneIntent("simplify the helper functions")).toBe("cleanup");
		expect(inferLaneIntent("remove dead code from utils")).toBe("cleanup");
	});

	test("detects review intent", () => {
		expect(inferLaneIntent("review the pull request")).toBe("review");
		expect(inferLaneIntent("audit the codebase")).toBe("review");
		expect(inferLaneIntent("code quality check")).toBe("review");
	});

	test("detects verification intent", () => {
		expect(inferLaneIntent("write unit tests for the service")).toBe("verification");
		expect(inferLaneIntent("add e2e spec coverage")).toBe("verification");
		expect(inferLaneIntent("integration test the API")).toBe("verification");
	});

	test("detects implementation intent", () => {
		expect(inferLaneIntent("implement the new feature")).toBe("implementation");
		expect(inferLaneIntent("create a user dashboard")).toBe("implementation");
		expect(inferLaneIntent("add dark mode support")).toBe("implementation");
	});

	test("returns unknown for empty string", () => {
		expect(inferLaneIntent("")).toBe("unknown");
	});

	test("returns unknown for unrecognized input", () => {
		expect(inferLaneIntent("something completely unrelated xyz")).toBe("unknown");
	});

	test("debug beats implementation (ordering)", () => {
		// "fix" triggers debug before "add" can trigger implementation
		expect(inferLaneIntent("fix the bug in the add feature")).toBe("debug");
	});
});

describe("routeTaskToRole", () => {
	test("routes build-fix to general-purpose with high confidence", () => {
		const result = routeTaskToRole("broken build in CI");
		expect(result.intent).toBe("build-fix");
		expect(result.role).toBe("general-purpose");
		expect(result.confidence).toBe("high");
		expect(result.reason).toBe("build-fix intent detected");
	});

	test("routes debug to general-purpose with high confidence", () => {
		const result = routeTaskToRole("debug the failing request");
		expect(result.intent).toBe("debug");
		expect(result.role).toBe("general-purpose");
		expect(result.confidence).toBe("high");
		expect(result.reason).toBe("keyword match for debug");
	});

	test("routes docs to general-purpose with high confidence", () => {
		const result = routeTaskToRole("write docs for the new endpoint");
		expect(result.intent).toBe("docs");
		expect(result.role).toBe("general-purpose");
		expect(result.confidence).toBe("high");
	});

	test("routes design to designer with high confidence", () => {
		const result = routeTaskToRole("redesign the UI layout");
		expect(result.intent).toBe("design");
		expect(result.role).toBe("designer");
		expect(result.confidence).toBe("high");
	});

	test("routes cleanup to general-purpose with high confidence", () => {
		const result = routeTaskToRole("refactor the data layer");
		expect(result.intent).toBe("cleanup");
		expect(result.role).toBe("general-purpose");
		expect(result.confidence).toBe("high");
	});

	test("routes plain review to advisor with high confidence", () => {
		const result = routeTaskToRole("review the pull request changes");
		expect(result.intent).toBe("review");
		expect(result.role).toBe("advisor");
		expect(result.confidence).toBe("high");
		expect(result.reason).toBe("review intent detected");
	});

	test("routes review with security keywords to advisor with security reason", () => {
		const result = routeTaskToRole("review auth token handling");
		expect(result.intent).toBe("review");
		expect(result.role).toBe("advisor");
		expect(result.confidence).toBe("high");
		expect(result.reason).toBe("review intent with security domain");
	});

	test("routes review with password keyword to advisor with security reason", () => {
		const result = routeTaskToRole("audit password reset flow for vulnerabilities");
		expect(result.intent).toBe("review");
		expect(result.role).toBe("advisor");
		expect(result.reason).toBe("review intent with security domain");
	});

	test("routes verification to general-purpose with high confidence", () => {
		const result = routeTaskToRole("add unit tests for the payment service");
		expect(result.intent).toBe("verification");
		expect(result.role).toBe("general-purpose");
		expect(result.confidence).toBe("high");
	});

	test("routes implementation to general-purpose with medium confidence", () => {
		const result = routeTaskToRole("implement the new dashboard feature");
		expect(result.intent).toBe("implementation");
		expect(result.role).toBe("general-purpose");
		expect(result.confidence).toBe("medium");
	});

	test("unknown intent with empty string returns low confidence", () => {
		const result = routeTaskToRole("");
		expect(result.intent).toBe("unknown");
		expect(result.confidence).toBe("low");
		expect(result.reason).toBe("unknown intent, using fallback");
	});

	test("unknown intent uses default fallback role general-purpose", () => {
		const result = routeTaskToRole("");
		expect(result.role).toBe("general-purpose");
	});

	test("custom fallback role is used for unknown intent", () => {
		const result = routeTaskToRole("", "explorer");
		expect(result.intent).toBe("unknown");
		expect(result.role).toBe("explorer");
		expect(result.confidence).toBe("low");
	});

	test("custom fallback role on non-matching task", () => {
		const result = routeTaskToRole("xyz abc totally unknown 12345", "explorer");
		expect(result.role).toBe("explorer");
		expect(result.intent).toBe("unknown");
	});
});
