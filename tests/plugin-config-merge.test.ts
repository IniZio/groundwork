import { describe, test, expect } from "bun:test";
import { GroundworkPlugin } from "../src/index.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Plugin config merge", () => {
	test("frontmatter permissions materialize into runtime agent config", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "groundwork-test-"));
		try {
			const plugin = await GroundworkPlugin({
				client: {} as any,
				directory: tmpDir,
			});

			const config: any = { agent: {} };
			await plugin.config(config);

			// explore agent should have frontmatter permissions loaded
			expect(config.agent.explore).toBeDefined();
			expect(config.agent.explore.permission).toBeDefined();
			expect(config.agent.explore.permission.question).toBe("deny");
			expect(config.agent.explore.permission.task).toBe("deny");
			expect(config.agent.explore.permission["background*"]).toBe("deny");

			// general-purpose agent should have nested task permissions loaded
			expect(config.agent.general-purpose).toBeDefined();
			expect(config.agent.general-purpose.permission).toBeDefined();
			expect(config.agent.general-purpose.permission.question).toBe("deny");
			expect(config.agent.general-purpose.permission["background*"]).toBe("deny");
			expect(config.agent.general-purpose.permission.bash).toBeDefined();
			expect(config.agent.general-purpose.permission.bash["git reset --hard *"]).toBe(
				"deny",
			);
			// general-purpose can delegate to explore and advisor
			expect(config.agent.general-purpose.permission.task).toBeDefined();
			expect(config.agent.general-purpose.permission.task["*"]).toBe("deny");
			expect(config.agent.general-purpose.permission.task.advisor).toBe("allow");
			expect(config.agent.general-purpose.permission.task.explore).toBe("allow");

			// orchestrator denies self-delegation but allows all other task types
			expect(config.agent.orchestrator.permission.task.orchestrator).toBe(
				"deny",
			);
			expect(config.agent.orchestrator.permission.task.general-purpose).toBeUndefined(); // no explicit allow needed — only self-delegation is denied
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test("orchestrator is registered under primary-agent aliases", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "groundwork-test-"));
		try {
			const plugin = await GroundworkPlugin({
				client: {} as any,
				directory: tmpDir,
			});

			const config: any = { agent: {} };
			await plugin.config(config);

			expect(config.agent["general-purpose"].prompt).toContain(
				"You are the ORCHESTRATOR",
			);
			expect(config.agent["general-purpose"].permission.task.orchestrator).toBe(
				"deny",
			);
			expect(config.agent.general_purpose.prompt).toContain(
				"You are the ORCHESTRATOR",
			);
			expect(config.agent.default.prompt).toContain("You are the ORCHESTRATOR");
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test("explicit config.agent permission values win over frontmatter defaults", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "groundwork-test-"));
		try {
			const plugin = await GroundworkPlugin({
				client: {} as any,
				directory: tmpDir,
			});

			// User explicitly sets some permissions that conflict with frontmatter
			const config: any = {
				agent: {
					explore: {
						permission: {
							question: "allow", // frontmatter says deny
							task: "allow", // frontmatter says deny
							extra: "deny", // not in frontmatter
						},
					},
					general-purpose: {
						permission: {
							task: {
								explore: "deny", // frontmatter says allow
								advisor: "deny", // frontmatter says allow
								custom: "allow", // not in frontmatter
							},
							question: "allow", // frontmatter says deny
						},
					},
				},
			};

			await plugin.config(config);

			// explore: explicit values should win
			expect(config.agent.explore.permission.question).toBe("allow");
			expect(config.agent.explore.permission.task).toBe("allow");
			// frontmatter value for background* should still be merged in (not overridden)
			expect(config.agent.explore.permission["background*"]).toBe("deny");
			// extra permission not in frontmatter should be preserved
			expect(config.agent.explore.permission.extra).toBe("deny");

			// general-purpose: explicit nested values should win
			expect(config.agent.general-purpose.permission.task.explore).toBe("deny");
			expect(config.agent.general-purpose.permission.task.advisor).toBe("deny");
			// frontmatter wildcard should still be merged in
			expect(config.agent.general-purpose.permission.task["*"]).toBe("deny");
			// custom permission not in frontmatter should be preserved
			expect(config.agent.general-purpose.permission.task.custom).toBe("allow");
			// frontmatter value for background* should still be merged in
			expect(config.agent.general-purpose.permission["background*"]).toBe("deny");
			// explicit question wins over frontmatter
			expect(config.agent.general-purpose.permission.question).toBe("allow");
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test("explore is a leaf agent (task deny) while delegating agents can task->explore", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "groundwork-test-"));
		try {
			const plugin = await GroundworkPlugin({
				client: {} as any,
				directory: tmpDir,
			});

			const config: any = { agent: {} };
			await plugin.config(config);

			// explore is a leaf: cannot delegate to anyone
			expect(config.agent.explore.permission.task).toBe("deny");

			// general-purpose can delegate to explore
			expect(config.agent.general-purpose.permission.task.explore).toBe("allow");

			// advisor can delegate to explore
			expect(config.agent.advisor.permission.task.explore).toBe("allow");

			// designer can delegate to explore
			expect(config.agent.designer.permission.task.explore).toBe("allow");

			// Verify explore cannot delegate to advisor (only general-purpose can)
			expect(config.agent.explore.permission.task).toBe("deny");
			// general-purpose is the only one that can delegate to advisor
			expect(config.agent.general-purpose.permission.task.advisor).toBe("allow");
			expect(config.agent.advisor.permission.task.advisor).toBeUndefined();
			expect(config.agent.designer.permission.task.advisor).toBeUndefined();
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test("disabled agents are skipped", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "groundwork-test-"));
		try {
			const plugin = await GroundworkPlugin({
				client: {} as any,
				directory: tmpDir,
			});

			const config: any = {
				agent: {
					explore: { disable: true },
				},
			};

			await plugin.config(config);

			// explore should not have been processed
			expect(config.agent.explore.permission).toBeUndefined();
			expect(config.agent.explore.prompt).toBeUndefined();
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test("default temperatures are applied only when not explicitly set", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "groundwork-test-"));
		try {
			const plugin = await GroundworkPlugin({
				client: {} as any,
				directory: tmpDir,
			});

			const config: any = {
				agent: {
					explore: { temperature: 0.99 },
				},
			};

			await plugin.config(config);

			// explicit temperature should win
			expect(config.agent.explore.temperature).toBe(0.99);

			// other agents should get defaults
			expect(config.agent.general-purpose.temperature).toBe(0.2);
			expect(config.agent.advisor.temperature).toBe(0.1);
			expect(config.agent.designer.temperature).toBe(0.7);
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});
