import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"#src": path.resolve(import.meta.dirname, "src"),
			"#test": path.resolve(import.meta.dirname, "test"),
		},
	},
	test: {
		include: ["test/**/*.test.ts"],
		exclude: [
			// Vitest built-in defaults (preserved so node_modules etc. remain excluded)
			"**/node_modules/**",
			"**/dist/**",
			"**/.{idea,git,cache,output,temp}/**",
			"**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*",
			// Gate live agent calls behind opt-in flag
			...(process.env.RUN_E2E ? [] : ["test/e2e/**"]),
		],
		testTimeout: 30_000,
		// E2E tests need longer; set per-test via third argument
	},
});
