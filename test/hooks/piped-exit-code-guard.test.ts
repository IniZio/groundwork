/**
 * Tests for hooks/piped-exit-code-guard.mjs
 *
 * DENY: commands that read $? after piping through a filter — the filter's
 *       exit status is captured, not the upstream command's.
 * ALLOW: all other Bash patterns — false positives here are disruptive because
 *        this hook fires on every Bash call.
 */

import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const HOOK = path.resolve(
	import.meta.dirname,
	"..",
	"..",
	"hooks",
	"piped-exit-code-guard.mjs",
);

type Decision = {
	hookSpecificOutput?: {
		permissionDecision?: string;
		permissionDecisionReason?: string;
	};
};

function runHook(command: string): Decision {
	const payload = {
		hook_event_name: "PreToolUse",
		tool_name: "Bash",
		tool_input: { command },
	};
	const out = execFileSync("node", [HOOK], {
		input: JSON.stringify(payload),
		encoding: "utf8",
	});
	return out.trim() ? JSON.parse(out) : {};
}

function decision(d: Decision): string | undefined {
	return d.hookSpecificOutput?.permissionDecision;
}

function reason(d: Decision): string {
	return d.hookSpecificOutput?.permissionDecisionReason ?? "";
}

// ─── MODE BIT CONTRACT ──────────────────────────────────────────────────────
// The hook is registered in hooks.json by bare path and executed directly by
// the shell.  Without the exec bit the shell returns 126 (Permission denied)
// and the hook silently never runs.  This test guards against the bit being
// stripped by a checkout or a careless chmod.

describe("piped-exit-code-guard — exec bit", () => {
	it("hook file has exec bit set (mode & 0o111 !== 0)", () => {
		const mode = statSync(HOOK).mode;
		expect(mode & 0o111).not.toBe(0);
	});
});

// ─── MUST DENY ──────────────────────────────────────────────────────────────

describe("piped-exit-code-guard — MUST DENY", () => {
	it("DENIES: grep | head; echo $?", () => {
		const d = runHook("grep -rn X . | head; echo $?");
		expect(decision(d)).toBe("deny");
		expect(reason(d)).toMatch(/PIPESTATUS/);
	});

	it("DENIES: cmd | tail && echo $?", () => {
		const d = runHook("npx vitest run | tail -5 && echo $?");
		expect(decision(d)).toBe("deny");
		expect(reason(d)).toMatch(/PIPESTATUS/);
	});

	it("DENIES: cmd | tail; echo with quoted status", () => {
		// $? inside double quotes still expands — this is a real status read
		const d = runHook('pnpm run check | tail -20; echo "EXIT=$?"');
		expect(decision(d)).toBe("deny");
	});

	it("DENIES: newline-separated form (cmd | head then echo $? on next line)", () => {
		const d = runHook("cmd | head\necho $?");
		expect(decision(d)).toBe("deny");
	});

	it("DENIES: cmd | grep foo; echo $?", () => {
		const d = runHook("cmd | grep foo; echo $?");
		expect(decision(d)).toBe("deny");
	});
});

// ─── MUST ALLOW ─────────────────────────────────────────────────────────────

describe("piped-exit-code-guard — MUST ALLOW", () => {
	it("ALLOWS: cmd | head -5 with no $? read", () => {
		// Extremely common pattern — must never be blocked
		const d = runHook("cmd | head -5");
		expect(decision(d)).toBeUndefined();
	});

	it("ALLOWS: cmd; echo $? with no pipe (correct idiom)", () => {
		const d = runHook("cmd; echo $?");
		expect(decision(d)).toBeUndefined();
	});

	it("ALLOWS: piping into count and reading the value (not $?)", () => {
		// n=$(grep ...) captures value; echo $n does not read $?
		const d = runHook("n=$(grep -rl X . | wc -l); echo $n");
		expect(decision(d)).toBeUndefined();
	});

	it("ALLOWS: chained filters with no status read", () => {
		const d = runHook("cmd | tail -3 | grep foo");
		expect(decision(d)).toBeUndefined();
	});

	it("ALLOWS: $? inside single quotes is not a status read", () => {
		// Single-quoted $? does not expand — the shell prints the literal string
		const d = runHook("cmd | head; echo 'exit status is in $?'");
		expect(decision(d)).toBeUndefined();
	});

	it("ALLOWS: non-Bash tool_name is ignored", () => {
		const payload = {
			hook_event_name: "PreToolUse",
			tool_name: "Read",
			tool_input: { command: "cmd | head; echo $?" },
		};
		const out = execFileSync("node", [HOOK], {
			input: JSON.stringify(payload),
			encoding: "utf8",
		});
		const d: Decision = out.trim() ? JSON.parse(out) : {};
		expect(decision(d)).toBeUndefined();
	});

	it("ALLOWS: empty / missing command", () => {
		const payload = {
			hook_event_name: "PreToolUse",
			tool_name: "Bash",
			tool_input: { command: "" },
		};
		const out = execFileSync("node", [HOOK], {
			input: JSON.stringify(payload),
			encoding: "utf8",
		});
		const d: Decision = out.trim() ? JSON.parse(out) : {};
		expect(decision(d)).toBeUndefined();
	});
});

// ─── FALSE POSITIVE REGRESSION (must ALLOW) ─────────────────────────────────
// 30 historical false positives were caused by [^|]* crossing command
// separators.  These five are representative and must all pass through.

describe("piped-exit-code-guard — false positive regression (must ALLOW)", () => {
	it("ALLOWS: pipe+head on one line, $? reads a later unrelated cmd", () => {
		// $? belongs to `npm run build`, not to `ls | head`
		const d = runHook("ls -la | head -3\nnpm run build; echo $?");
		expect(decision(d)).toBeUndefined();
	});

	it("ALLOWS: pipe+grep+&&, then separate cmd; echo $?", () => {
		// $? belongs to `make test`, not to `cat | grep`
		const d = runHook("cat f | grep x && make test; echo $?");
		expect(decision(d)).toBeUndefined();
	});

	it("ALLOWS: real historical multi-statement command", () => {
		// Real corpus command: tail filters vitest output; $? is from spec.mjs
		const d = runHook(
			'npx vitest run 2>&1 | tail -5; node hooks/spec.mjs build >/dev/null; echo "build:$?"',
		);
		expect(decision(d)).toBeUndefined();
	});

	it("ALLOWS: pipe+head on line 1, unrelated make+echo on subsequent lines", () => {
		const d = runHook("grep -rn foo src | head -5\nmake build\necho $?");
		expect(decision(d)).toBeUndefined();
	});

	it("ALLOWS: pipe+wc on line 1, pnpm check+echo on next line", () => {
		const d = runHook('ls hooks/ | wc -l\ncd /repo && pnpm run check; echo "check=$?"');
		expect(decision(d)).toBeUndefined();
	});
});

// ─── PIPEFAIL DEFEAT REGRESSION (must DENY) ─────────────────────────────────
// The old `\bpipefail\b` substring check was trivially bypassed.  All four
// forms below must be denied.

describe("piped-exit-code-guard — pipefail defeat cases (must DENY)", () => {
	it("DENIES: set -o pipefail before the pipeline — guard denies regardless (scope unverifiable)", () => {
		// No exemption: the guard cannot verify scope from a flat string.
		// Use ${PIPESTATUS[0]} instead.
		const d = runHook("set -o pipefail; cmd | head; echo $?");
		expect(decision(d)).toBe("deny");
	});

	it("DENIES: pipefail only in a trailing comment (not a real set)", () => {
		// # comments don't set shell options
		const d = runHook("tsc | tail -5; echo $?  # pipefail not set");
		expect(decision(d)).toBe("deny");
	});

	it("DENIES: pipefail only inside a double-quoted string (not a real set)", () => {
		const d = runHook('echo "remember pipefail"; tsc | tail -5; echo $?');
		expect(decision(d)).toBe("deny");
	});

	it("DENIES: pipefail only as a filename (not a real set)", () => {
		const d = runHook("cat pipefail.txt | head; echo $?");
		expect(decision(d)).toBe("deny");
	});

	it("DENIES: set +o pipefail explicitly DISABLES pipefail", () => {
		const d = runHook("set +o pipefail; tsc | tail -5; echo $?");
		expect(decision(d)).toBe("deny");
	});

	it("DENIES: exact set -o pipefail form inside a double-quoted string", () => {
		// The string `"set -o pipefail"` does not invoke set — it is an argument
		// to echo.  The old \b regex matched across the quote boundary; the
		// anchored regex requires a statement-start character before `set`.
		const d = runHook('echo "set -o pipefail"; tsc | tail -5; echo $?');
		expect(decision(d)).toBe("deny");
	});

	it("DENIES: exact set -o pipefail form inside a leading comment", () => {
		// `# set -o pipefail` is a comment; the real command that follows is
		// the pipe.  The old \b regex matched inside the comment; the anchored
		// regex only matches at a statement boundary, and `#` cannot satisfy it.
		const d = runHook("# set -o pipefail\ntsc | tail -5; echo $?");
		expect(decision(d)).toBe("deny");
	});
});

// ─── NEW FALSE NEGATIVES NOW CAUGHT (must DENY) ───────────────────────────────
// Patterns the old regex missed; the tighter spans now catch them.

describe("piped-exit-code-guard — previously-missed patterns (must DENY)", () => {
	it("DENIES: rc=$? after a pipe through tail", () => {
		const d = runHook("make build | tail -5; rc=$?");
		expect(decision(d)).toBe("deny");
	});

	it("DENIES: if [ $? -ne 0 ] after a pipe through tail", () => {
		const d = runHook("tsc | tail -5; if [ $? -ne 0 ]; then echo fail; fi");
		expect(decision(d)).toBe("deny");
	});
});

// ─── DENY REASON content ────────────────────────────────────────────────────

describe("piped-exit-code-guard — deny reason names all remedies", () => {
	it("deny reason mentions PIPESTATUS and wc count-capture pattern (no pipefail remedy)", () => {
		const d = runHook("grep -rn X . | head; echo $?");
		const r = reason(d);
		expect(r).toMatch(/PIPESTATUS/);
		expect(r).toMatch(/wc/);
		// Deny reason must NOT advise `set -o pipefail` — that would cause an
		// infinite correction loop since the guard now denies piped-$? regardless.
		expect(r).not.toMatch(/set -o pipefail/);
	});
});

// ─── PIPEFAIL EXEMPTION DEFEAT VIA QUOTED/COMMENT SEPARATOR (must DENY) ─────
// A semicolon or keyword INSIDE a double-quoted string or a #-comment must NOT
// satisfy the statement-boundary anchor and must not exempt the command.

describe("piped-exit-code-guard — quoted/comment separator defeats (must DENY)", () => {
	it("DENIES: semicolon inside double-quoted string satisfies anchor (Defect 1a)", () => {
		// The ; inside "note; set -o pipefail here" is inside a string — not a
		// real statement boundary.  The old code saw it as an anchor and wrongly
		// granted the exemption.
		const d = runHook('echo "note; set -o pipefail here"; tsc | tail -5; echo $?');
		expect(decision(d)).toBe("deny");
	});

	it("DENIES: set -o pipefail inside a # comment satisfies anchor (Defect 1b)", () => {
		// The ; in "# fix; set -o pipefail" is inside a comment — not a real
		// statement boundary.
		const d = runHook("# fix; set -o pipefail\ntsc | tail -5; echo $?");
		expect(decision(d)).toBe("deny");
	});
});

// ─── PIPEFAIL SCOPE ATTACKS — NO EXEMPTION (must DENY) ───────────────────────
// Previously the guard tried to exempt { } groups and then/do/else boundaries.
// The exemption is gone: scope cannot be verified from a flat command string.

describe("piped-exit-code-guard — brace and keyword boundary — no scope exemption (must DENY)", () => {
	it("DENIES: set -o pipefail in a { } group — guard denies regardless (scope unverifiable)", () => {
		// Was formerly ALLOW; no exemption means piped-$? always denies.
		const d = runHook("{ set -o pipefail; tsc | tail -5; echo $?; }");
		expect(decision(d)).toBe("deny");
	});

	it("DENIES: set -o pipefail after then keyword — guard denies regardless (scope unverifiable)", () => {
		// Was formerly ALLOW; no exemption means piped-$? always denies.
		const d = runHook("if true; then set -o pipefail; tsc | tail -5; echo $?; fi");
		expect(decision(d)).toBe("deny");
	});

	it("DENIES: { } group with set -o pipefail only in a double-quoted string (scope attack)", () => {
		// A { cannot smuggle a fake pipefail via a quoted string.
		const d = runHook('{ echo "x; set -o pipefail"; tsc | tail -5; echo $?; }');
		expect(decision(d)).toBe("deny");
	});
});

// ─── SCOPE ATTACK DEFEAT CASES (must DENY) ───────────────────────────────────
// The five confirmed live defeats against the old exemption regex, plus the
// ${#PATH} false-positive case introduced by the now-deleted comment-strip
// logic.  With no exemption all six simply DENY via PIPED_EXIT_RE.

describe("piped-exit-code-guard — scope attack defeat cases (must DENY)", () => {
	it("DENIES: escaped-quote attack — semicolon appears to exit quoted string (defeat 1)", () => {
		// `\"` inside a double-quoted string leaves the ; outside in the old
		// [^"]* probe, making the guard think pipefail is at a statement boundary.
		const d = runHook('echo "a \\" ; set -o pipefail" ; tsc | tail -5; echo $?');
		expect(decision(d)).toBe("deny");
	});

	it("DENIES: subshell — set -o pipefail in () does not affect the outer pipeline (defeat 2)", () => {
		// A subshell forks; pipefail in the child does not propagate to the parent.
		const d = runHook("(set -o pipefail); tsc | tail -5; echo $?");
		expect(decision(d)).toBe("deny");
	});

	it("DENIES: command substitution assignment — set -o pipefail in $() is a child shell (defeat 3)", () => {
		// Command substitution runs in a child process; pipefail does not escape.
		const d = runHook("x=$(cd /; set -o pipefail); tsc | tail -5; echo $?");
		expect(decision(d)).toBe("deny");
	});

	it("DENIES: inline command substitution — set -o pipefail in $() is a child shell (defeat 4)", () => {
		const d = runHook("echo $(true; set -o pipefail); tsc | tail -5; echo $?");
		expect(decision(d)).toBe("deny");
	});

	it("DENIES: here-doc body — set -o pipefail is data, not a shell command (defeat 5)", () => {
		// The here-doc body is passed as stdin to `cat`; it is not executed.
		const d = runHook("cat <<EOF\nset -o pipefail\nEOF\ntsc | tail -5; echo $?");
		expect(decision(d)).toBe("deny");
	});

	it("DENIES: ${#PATH} expansion — old comment-strip bug no longer applies; piped-$? shape denies", () => {
		// Under the old code the pipefailProbe's `#[^\n]*` strip erased
		// everything from `${#` to EOL, destroying the real `set -o pipefail`
		// and preventing the exemption — a false positive caused by the probe.
		// The probe is now gone.  The command still contains a piped-$? shape
		// (| tail -5; echo $?), so PIPED_EXIT_RE fires and the guard correctly
		// denies it.  Use ${PIPESTATUS[0]} to read tsc's exit status.
		const d = runHook("echo ${#PATH}; set -o pipefail; tsc | tail -5; echo $?");
		expect(decision(d)).toBe("deny");
	});
});
