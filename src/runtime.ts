// ─── Extension Runtime ──────────────────────────────────────────────────────
// Consolidates all mutable extension state, mirroring pi-subagents' pattern.

export class GroundworkRuntime {
	/** Active working directory — set on session_start. */
	cwd: string | undefined = undefined;
}

export function createGroundworkRuntime(): GroundworkRuntime {
	return new GroundworkRuntime();
}
