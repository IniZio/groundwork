import { describe, test, expect, vi, afterEach } from "vitest";
import piExtension, { exportSessionEnv } from "../pi/pi.js";

describe("Pi Extension", () => {
	test("registers tools and commands without throwing", () => {
		const pi = {
			registerTool: vi.fn(),
			registerCommand: vi.fn(),
			on: vi.fn(),
			events: { emit: vi.fn() },
			sendMessage: vi.fn(),
		};
		expect(() => piExtension(pi as any)).not.toThrow();
		expect(pi.registerTool).toHaveBeenCalledTimes(2);
		expect(pi.registerCommand).toHaveBeenCalledTimes(2);
		expect(pi.on).toHaveBeenCalledTimes(4);
	});
});

describe("exportSessionEnv", () => {
	afterEach(() => {
		delete process.env.CLAUDE_CODE_SESSION_ID;
		delete process.env.CLAUDE_PROJECT_DIR;
	});

	test("sets CLAUDE_CODE_SESSION_ID and CLAUDE_PROJECT_DIR", () => {
		exportSessionEnv("sess-123", "/tmp/proj");
		expect(process.env.CLAUDE_CODE_SESSION_ID).toBe("sess-123");
		expect(process.env.CLAUDE_PROJECT_DIR).toBe("/tmp/proj");
	});

	test("does not overwrite session id when undefined", () => {
		process.env.CLAUDE_CODE_SESSION_ID = "stale";
		exportSessionEnv(undefined, "/tmp/proj");
		expect(process.env.CLAUDE_CODE_SESSION_ID).toBe("stale");
		expect(process.env.CLAUDE_PROJECT_DIR).toBe("/tmp/proj");
	});
});
