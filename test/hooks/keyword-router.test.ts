/**
 * Tests for hooks/keyword-router.mjs
 *
 * Primary coverage: content discriminator (S1 fixtures) — non-user-authored
 * turns (notifications, local-command stdout, compaction summaries) must NOT
 * produce routing hints.
 *
 * Secondary coverage: routing positives per agent and false-positive negatives,
 * salvaged from the dead tests/routing-hooks.test.ts (git HEAD).
 */
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const HOOK = path.resolve(import.meta.dirname, "..", "..", "hooks", "keyword-router.mjs");
const FIXTURES = path.resolve(import.meta.dirname, "..", "fixtures", "user-prompt-submit");

type HookOutput = {
	continue: boolean;
	hookSpecificOutput?: { hookEventName: string; additionalContext: string };
};

function runHook(prompt: string): HookOutput {
	const input = JSON.stringify({ hook_event_name: "UserPromptSubmit", role: "user", prompt });
	const out = execFileSync("node", [HOOK], { input, encoding: "utf8" });
	return JSON.parse(out.trim());
}

function runHookFromFixture(fixturePath: string): HookOutput {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const fixture = require(fixturePath) as { prompt: string };
	return runHook(fixture.prompt);
}

function context(prompt: string): string {
	return runHook(prompt).hookSpecificOutput?.additionalContext ?? "";
}

// ---------------------------------------------------------------------------
// Discriminator — S1 fixture-driven (primary)
// ---------------------------------------------------------------------------

describe("discriminator: notification fixtures → no routing signal", () => {
	it("system-notification-bare: bare SYSTEM NOTIFICATION prefix → pass-through", () => {
		const out = runHookFromFixture(`${FIXTURES}/notification/system-notification-bare.json`);
		expect(out.continue).toBe(true);
		expect(out.hookSpecificOutput).toBeUndefined();
	});

	it("task-notification-agent-result: task notification with no error text → pass-through", () => {
		const out = runHookFromFixture(`${FIXTURES}/notification/task-notification-agent-result.json`);
		expect(out.continue).toBe(true);
		expect(out.hookSpecificOutput).toBeUndefined();
	});

	it("task-notification-with-error-text: notification containing 'failed'/'broken'/'error' → pass-through", () => {
		// This fixture contains 'failed', 'broken', 'regression' — keywords that
		// route 1 would match. The discriminator must suppress routing regardless.
		const out = runHookFromFixture(`${FIXTURES}/notification/task-notification-with-error-text.json`);
		expect(out.continue).toBe(true);
		expect(out.hookSpecificOutput).toBeUndefined();
	});

	it("task-notification-with-failure: notification with 'failed'/'broke'/'error' → pass-through", () => {
		const out = runHookFromFixture(`${FIXTURES}/notification/task-notification-with-failure.json`);
		expect(out.continue).toBe(true);
		expect(out.hookSpecificOutput).toBeUndefined();
	});
});

describe("discriminator: local-command-stdout fixtures → no routing signal", () => {
	it("local-command-stdout-clean: clean test run output → pass-through", () => {
		const out = runHookFromFixture(`${FIXTURES}/local-command/local-command-stdout-clean.json`);
		expect(out.continue).toBe(true);
		expect(out.hookSpecificOutput).toBeUndefined();
	});

	it("local-command-stdout-failing-build: build output with error lines → pass-through", () => {
		// Contains 'error' (TS2322) — discriminator must suppress routing.
		const out = runHookFromFixture(`${FIXTURES}/local-command/local-command-stdout-failing-build.json`);
		expect(out.continue).toBe(true);
		expect(out.hookSpecificOutput).toBeUndefined();
	});

	it("local-command-stdout-with-errors: git status output → pass-through", () => {
		const out = runHookFromFixture(`${FIXTURES}/local-command/local-command-stdout-with-errors.json`);
		expect(out.continue).toBe(true);
		expect(out.hookSpecificOutput).toBeUndefined();
	});
});

describe("discriminator: compaction fixtures → no routing signal", () => {
	it("compaction-summary: context compaction with no error mentions → pass-through", () => {
		const out = runHookFromFixture(`${FIXTURES}/compaction/compaction-summary.json`);
		expect(out.continue).toBe(true);
		expect(out.hookSpecificOutput).toBeUndefined();
	});

	it("compaction-with-error-mentions: compaction containing 'fail'/'broken'/'PR' → pass-through", () => {
		// This fixture contains 'fail', 'broken', 'PR' — keywords that multiple
		// routes would match. The discriminator must suppress all routing.
		const out = runHookFromFixture(`${FIXTURES}/compaction/compaction-with-error-mentions.json`);
		expect(out.continue).toBe(true);
		expect(out.hookSpecificOutput).toBeUndefined();
	});
});

describe("discriminator: genuine fixtures → routing still fires", () => {
	it("bug-report-broken: 'this is broken' → routes to general-purpose", () => {
		const out = runHookFromFixture(`${FIXTURES}/genuine/bug-report-broken.json`);
		expect(out.hookSpecificOutput?.additionalContext).toContain("groundwork:general-purpose");
	});

	it("bug-report-build-fails: 'the build fails with a stack trace' → routes to general-purpose", () => {
		// Key false-negative guard: 'fails' in a genuine bug report must still route.
		const out = runHookFromFixture(`${FIXTURES}/genuine/bug-report-build-fails.json`);
		expect(out.hookSpecificOutput?.additionalContext).toContain("groundwork:general-purpose");
	});

	it("bug-report-diagnose-crash: 'diagnose why X crashes' → routes to general-purpose", () => {
		const out = runHookFromFixture(`${FIXTURES}/genuine/bug-report-diagnose-crash.json`);
		expect(out.hookSpecificOutput?.additionalContext).toContain("groundwork:general-purpose");
	});

	it("error-question: 'why does this function fail' → routes to general-purpose", () => {
		const out = runHookFromFixture(`${FIXTURES}/genuine/error-question.json`);
		expect(out.hookSpecificOutput?.additionalContext).toContain("groundwork:general-purpose");
	});

	it("feature-request: 'implement a dark mode toggle' → routes to designer", () => {
		const out = runHookFromFixture(`${FIXTURES}/genuine/feature-request.json`);
		expect(out.hookSpecificOutput?.additionalContext).toContain("groundwork:designer");
	});

	it("pr-review-request: 'review PR #42' → routes to advisor or git-master", () => {
		const out = runHookFromFixture(`${FIXTURES}/genuine/pr-review-request.json`);
		// "review PR #42 — check if the migration is safe" hits advisor (review + validate plan)
		expect(out.hookSpecificOutput?.additionalContext).toMatch(/groundwork:(advisor|git-master)/);
	});
});

// ---------------------------------------------------------------------------
// Routing positives (salvaged from dead tests/routing-hooks.test.ts)
// ---------------------------------------------------------------------------

describe("routing: bug signals → general-purpose", () => {
	it('"bug" keyword', () => {
		expect(context("fix the login bug")).toContain("groundwork:general-purpose");
	});

	it('"broken" keyword', () => {
		expect(context("the payment flow is broken")).toContain("groundwork:general-purpose");
	});

	it("\"doesn't work\" phrase", () => {
		expect(context("the search doesn't work correctly")).toContain("groundwork:general-purpose");
	});

	it('"error" keyword', () => {
		expect(context("getting an error when submitting the form")).toContain("groundwork:general-purpose");
	});

	it('"stack trace" phrase', () => {
		expect(context("here is the stack trace from production")).toContain("groundwork:general-purpose");
	});

	it('"regression" keyword', () => {
		expect(context("there is a regression in the auth module")).toContain("groundwork:general-purpose");
	});

	it('"debug" keyword', () => {
		expect(context("debug why the cache is not invalidating")).toContain("groundwork:general-purpose");
	});

	it("hint mentions diagnose skill FIRST", () => {
		const ctx = context("fix the login bug");
		expect(ctx).toContain("diagnose");
		expect(ctx).toContain("FIRST");
	});
});

describe("routing: feature signals → planner", () => {
	it('"plan this" imperative', () => {
		expect(context("plan this new notification system")).toContain("groundwork:planner");
	});

	it('"create a plan" phrase', () => {
		expect(context("create a plan for the migration")).toContain("groundwork:planner");
	});

	it('"design this first" phrase', () => {
		expect(context("design this first before we implement")).toContain("groundwork:planner");
	});

	it('"build X from scratch"', () => {
		expect(context("build a authentication system from scratch")).toContain("groundwork:planner");
	});

	it('"architect" keyword', () => {
		expect(context("architect the new microservices approach")).toContain("groundwork:planner");
	});

	it('"implement X feature" phrase', () => {
		expect(context("implement the workflow automation feature")).toContain("groundwork:planner");
	});
});

describe("routing: review signals → advisor", () => {
	it('"review my code" phrase', () => {
		expect(context("review my auth implementation")).toContain("groundwork:advisor");
	});

	it('"code review" phrase', () => {
		expect(context("can you do a code review of this PR")).toContain("groundwork:advisor");
	});

	it('"validate the plan" phrase', () => {
		expect(context("validate the plan before we proceed")).toContain("groundwork:advisor");
	});
});

describe("routing: test signals → test-engineer", () => {
	it('"write tests" phrase', () => {
		expect(context("write tests for the auth module")).toContain("groundwork:test-engineer");
	});

	it('"test coverage" phrase', () => {
		expect(context("improve test coverage for payment service")).toContain("groundwork:test-engineer");
	});

	it('"TDD" keyword', () => {
		expect(context("use TDD to implement this feature")).toContain("groundwork:test-engineer");
	});

	it('"flaky test" phrase', () => {
		expect(context("the flaky test in CI is causing issues")).toContain("groundwork:test-engineer");
	});
});

describe("routing: git signals → git-master", () => {
	it('"commit" keyword', () => {
		expect(context("commit these changes")).toContain("groundwork:git-master");
	});

	it('"rebase" keyword', () => {
		expect(context("rebase onto main")).toContain("groundwork:git-master");
	});

	it('"pull request" phrase', () => {
		expect(context("create a pull request for this branch")).toContain("groundwork:git-master");
	});

	it('"PR #N" (narrowed pattern) routes to git-master', () => {
		expect(context("open a PR #42 with these changes")).toContain("groundwork:git-master");
	});
});

describe("routing: design signals → designer", () => {
	it('"UI" keyword', () => {
		expect(context("improve the UI for the dashboard")).toContain("groundwork:designer");
	});

	it('"styling" keyword', () => {
		expect(context("fix the styling of the modal")).toContain("groundwork:designer");
	});

	it('"dark mode" phrase', () => {
		expect(context("add dark mode support")).toContain("groundwork:designer");
	});

	it('"design the UI" phrase', () => {
		expect(context("design the UI for the settings page")).toContain("groundwork:designer");
	});
});

describe("routing: completion/advisor signals → advisor", () => {
	it('"advisor gate" phrase', () => {
		expect(context("run the advisor gate before we proceed")).toContain("groundwork:advisor");
	});

	it('"all done" phrase', () => {
		expect(context("all done with the implementation")).toContain("groundwork:advisor");
	});

	it('"ready to ship" phrase', () => {
		expect(context("ready to ship the feature")).toContain("groundwork:advisor");
	});

	it('"is it done?" phrase', () => {
		expect(context("is it done?")).toContain("groundwork:advisor");
	});

	it('"are we done" phrase', () => {
		expect(context("are we done yet?")).toContain("groundwork:advisor");
	});

	it('"can we merge" phrase', () => {
		expect(context("can we merge this PR?")).toContain("groundwork:advisor");
	});

	it('"architecture trade-off" phrase', () => {
		expect(context("explain the architecture trade-off between REST and GraphQL")).toContain("groundwork:advisor");
	});
});

// ---------------------------------------------------------------------------
// False-positive negatives (salvaged from dead tests/routing-hooks.test.ts)
// ---------------------------------------------------------------------------

describe("false positives: must NOT route", () => {
	it("trivial question → pass-through", () => {
		const out = runHook("What is 2+2?");
		expect(out.hookSpecificOutput).toBeUndefined();
	});

	it('"it plans to" — bare noun in sentence → no routing', () => {
		const out = runHook("it plans to run the migration next week");
		expect(out.hookSpecificOutput).toBeUndefined();
	});

	it('"the plan landed" — bare noun in sentence → no routing', () => {
		const out = runHook("the plan landed well with the team");
		expect(out.hookSpecificOutput).toBeUndefined();
	});

	it('bare "PR" without # → no git-master routing (narrowed)', () => {
		// Route 5 now requires "PR #N" or "pull request"; bare "PR" alone no longer fires.
		const out = runHook("I sent the PR for review");
		// May hit advisor via "review" pattern — but git-master must NOT appear
		expect(out.hookSpecificOutput?.additionalContext ?? "").not.toContain("groundwork:git-master");
	});

	it(">3 route matches suppressed (multi-keyword noise)", () => {
		// A message hitting >3 route groups is noise — suppress all routing hints.
		const out = runHook("fix the broken design, write tests, review the code and commit the PR");
		expect(out.hookSpecificOutput).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
	it("empty prompt → pass-through", () => {
		const out = runHook("");
		expect(out.continue).toBe(true);
		expect(out.hookSpecificOutput).toBeUndefined();
	});

	it("invalid JSON on stdin → pass-through", () => {
		const result = spawnSync("node", [HOOK], { input: "not json at all", encoding: "utf8", timeout: 5000 });
		const out: HookOutput = JSON.parse(result.stdout.trim());
		expect(out.continue).toBe(true);
		expect(out.hookSpecificOutput).toBeUndefined();
	});

	it("always sets continue: true", () => {
		expect(runHook("fix the bug").continue).toBe(true);
		expect(runHook("plan the feature").continue).toBe(true);
		expect(runHook("random unrelated text").continue).toBe(true);
	});

	it("routing output includes [GROUNDWORK ROUTING SIGNAL] header", () => {
		const ctx = context("fix the broken login");
		expect(ctx).toContain("[GROUNDWORK ROUTING SIGNAL]");
	});
});
