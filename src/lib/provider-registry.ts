import type {
	ExtensionAPI,
	ProviderConfig,
} from "@earendil-works/pi-coding-agent";

/**
 * Groundwork custom model providers.
 *
 * Each entry's key is the provider name used in agent .md `model:` fields
 * (e.g. `kimi-for-coding` → provider "kimi-for-coding", model id "kimi-for-coding").
 *
 * The `neuralwatt` provider is NOT registered here — the pi-neuralwatt
 * extension (installed separately) handles that with dynamic model discovery.
 * Agent .md files use `neuralwatt/zai-org/GLM-5.1-FP8` as the model string.
 *
 * IMPORTANT: Provider names and model IDs must match agents/*.md files exactly.
 */
const GROUNDWORK_PROVIDERS: Record<string, ProviderConfig> = {
	// NOTE: neuralwatt is NOT registered here — the pi-neuralwatt package
	// (installed separately) registers the neuralwatt provider with dynamic
	// model discovery from the NeuralWatt API. Agent .md files reference
	// `neuralwatt/zai-org/GLM-5.1-FP8` which pi-neuralwatt resolves.

	// ── Moonshot / Kimi (coder model) ───────────────────────────────────────
	"kimi-for-coding": {
		name: "Kimi for Coding (Moonshot)",
		baseUrl: "https://api.moonshot.cn/v1",
		apiKey: "$KIMI_API_KEY",
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
