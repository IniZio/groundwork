// ─── Intent Router ───────────────────────────────────────────────────────────
// Pure TypeScript module, no I/O.
// Routes a task string to a role and intent with confidence scoring.

export type LaneIntent =
	| "implementation"
	| "verification"
	| "review"
	| "debug"
	| "design"
	| "docs"
	| "build-fix"
	| "cleanup"
	| "unknown";

export interface RouteResult {
	role: string;
	intent: LaneIntent;
	confidence: "high" | "medium" | "low";
	reason: string;
}

const SECURITY_KEYWORDS =
	/auth|xss|csrf|sqli|cve|owasp|injection|password|token|secret|vulnerability/i;

const INTENT_PATTERNS: Array<{ intent: LaneIntent; pattern: RegExp }> = [
	{
		intent: "build-fix",
		pattern:
			/build fail|compile error|lint error|tsc error|type error|broken build|ci fail/i,
	},
	{
		intent: "debug",
		pattern:
			/debug|fix\b.*\bbug\b|reproduction|stack trace|error|exception|broken|not working|regression/i,
	},
	{
		intent: "docs",
		pattern: /document|readme|comment|jsdoc|changelog|write docs/i,
	},
	{
		intent: "design",
		pattern: /design|ui|ux|styling|css|layout|visual|responsive|component/i,
	},
	{
		intent: "cleanup",
		pattern:
			/cleanup|refactor|simplify|remove dead code|extract|rename|reorganize/i,
	},
	{
		intent: "review",
		pattern: /review|audit|check|verify code|code quality/i,
	},
	{
		intent: "verification",
		pattern: /test|spec|coverage|assert|e2e|unit test|integration test/i,
	},
	{
		intent: "implementation",
		pattern: /implement|add|create|build|make|develop|feature|new/i,
	},
];

export function inferLaneIntent(task: string): LaneIntent {
	for (const { intent, pattern } of INTENT_PATTERNS) {
		if (pattern.test(task)) {
			return intent;
		}
	}
	return "unknown";
}

export function routeTaskToRole(task: string, fallback = "coder"): RouteResult {
	const intent = inferLaneIntent(task);

	switch (intent) {
		case "build-fix":
			return {
				role: "coder",
				intent,
				confidence: "high",
				reason: "build-fix intent detected",
			};

		case "debug":
			return {
				role: "coder",
				intent,
				confidence: "high",
				reason: "keyword match for debug",
			};

		case "docs":
			return {
				role: "coder",
				intent,
				confidence: "high",
				reason: "docs intent detected",
			};

		case "design":
			return {
				role: "designer",
				intent,
				confidence: "high",
				reason: "design intent detected",
			};

		case "cleanup":
			return {
				role: "coder",
				intent,
				confidence: "high",
				reason: "cleanup intent detected",
			};

		case "review":
			if (SECURITY_KEYWORDS.test(task)) {
				return {
					role: "advisor",
					intent,
					confidence: "high",
					reason: "review intent with security domain",
				};
			}
			return {
				role: "advisor",
				intent,
				confidence: "high",
				reason: "review intent detected",
			};

		case "verification":
			return {
				role: "coder",
				intent,
				confidence: "high",
				reason: "verification intent detected",
			};

		case "implementation":
			return {
				role: "coder",
				intent,
				confidence: "medium",
				reason: "implementation intent detected",
			};

		default:
			return {
				role: fallback,
				intent: "unknown",
				confidence: "low",
				reason: "unknown intent, using fallback",
			};
	}
}
