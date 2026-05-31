// ─── Extension Runtime ──────────────────────────────────────────────────────
// Consolidates all mutable extension state, mirroring pi-subagents' pattern.

export class GroundworkRuntime {
	/** Active working directory — set on session_start. */
	cwd: string | undefined = undefined;

	/** Track which sessions have had agents installed (idempotency). */
	readonly agentsInstalledForSessions = new Set<string>();
}

export function createGroundworkRuntime(): GroundworkRuntime {
	return new GroundworkRuntime();
}
