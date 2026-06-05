import type {
	ExtensionAPI,
	ProviderConfig,
} from "@earendil-works/pi-coding-agent";

/**
 * Groundwork custom model providers.
 *
 * Each entry's key is the provider name used in agent .md `model:` fields
 * (e.g. `neuralwatt/glm-5.1-fast` → provider "neuralwatt", model id "glm-5.1-fast").
 *
 * IMPORTANT: Provider names and model IDs must match agents/*.md files exactly.
 */
const GROUNDWORK_PROVIDERS: Record<string, ProviderConfig> = {
	// ── ZhipuAI / GLM (orchestrator model) ──────────────────────────────────
	neuralwatt: {
		name: "NeuralWatt (ZhipuAI GLM)",
		baseUrl: "https://open.bigmodel.cn/api/paas/v4",
		// Support common aliases. Command-backed auth also lets pi treat the
		// provider as configured during session model restore.
		apiKey:
			"!node -e \"process.stdout.write(process.env.NEURALWATT_API_KEY || process.env.ZHIPU_API_KEY || process.env.BIGMODEL_API_KEY || '')\"",
		api: "openai-completions",
		models: [
			{
				id: "glm-5.1-fast",
				name: "GLM 5.1 Fast",
				reasoning: false,
				input: ["text"],
				cost: { input: 0.5, output: 1.5, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128_000,
				maxTokens: 16_384,
			},
		],
	},

	// ── Moonshot / Kimi (coder model) ───────────────────────────────────────
	"kimi-for-coding": {
		name: "Kimi for Coding (Moonshot)",
		baseUrl: "https://api.moonshot.cn/v1",
		apiKey:
			"!node -e \"process.stdout.write(process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY || '')\"",
		api: "openai-completions",
		models: [
			{
				id: "kimi-for-coding",
				name: "Kimi for Coding",
				reasoning: false,
				input: ["text"],
				cost: { input: 0.5, output: 1.5, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128_000,
				maxTokens: 16_384,
			},
		],
	},

	// ── DeepSeek (explorer model) ───────────────────────────────────────────
	"opencode-go": {
		name: "OpenCode Go (DeepSeek)",
		baseUrl: "https://api.deepseek.com/v1",
		apiKey: "$DEEPSEEK_API_KEY",
		api: "openai-completions",
		models: [
			{
				id: "deepseek-v4-flash",
				name: "DeepSeek V4 Flash",
				reasoning: false,
				input: ["text"],
				cost: { input: 0.1, output: 0.3, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128_000,
				maxTokens: 16_384,
			},
		],
	},

	// ── Cursor proxy → Anthropic (designer model) ──────────────────────────
	"cursor-agent": {
		name: "Cursor Agent (Anthropic proxy)",
		baseUrl: "https://api2.cursor.sh/anthropic",
		apiKey: "$CURSOR_API_KEY",
		api: "anthropic-messages",
		models: [
			{
				id: "claude-sonnet-4-6",
				name: "Claude Sonnet 4.6 (via Cursor)",
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 3, output: 15, cacheRead: 1.5, cacheWrite: 3.75 },
				contextWindow: 200_000,
				maxTokens: 16_384,
			},
		],
	},
};

/**
 * Register all groundwork custom model providers with the pi extension API.
 *
 * Each registration is wrapped in try/catch so a missing API key or
 * registration failure only logs a warning — it does NOT crash the extension.
 * The model simply won't appear in the registry and pi-subagents will fall
 * back to other available models.
 */
export function registerGroundworkProviders(pi: ExtensionAPI): void {
	for (const [name, config] of Object.entries(GROUNDWORK_PROVIDERS)) {
		try {
			pi.registerProvider(name, config);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			console.warn(
				`[groundwork] Failed to register provider "${name}": ${message}. ` +
					`Models using this provider will not be available.`,
			);
		}
	}
}
