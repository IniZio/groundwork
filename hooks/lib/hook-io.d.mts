// Type declarations for hook-io.mjs

/** Read raw stdin to a string. Returns '' on any read failure. */
export declare function readStdin(): Promise<string>

/** Let the call proceed unchanged. Emitting nothing + exit 0 = normal flow. */
export declare function passthrough(): void

/**
 * Returns true when the current session was launched by an SDK-embedded agent
 * (CLAUDE_CODE_ENTRYPOINT is "sdk-py" or "sdk-js").
 */
export declare function isEmbeddedAgent(): boolean
