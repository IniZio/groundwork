import { describe, test, expect, vi } from "vitest";
import piExtension from "../src/pi.js";

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
		expect(pi.on).toHaveBeenCalledTimes(3);
	});
});
