// ─── Stub ExtensionContext for Pi tool tests ────────────────────────────────

export const STUB_CTX = {} as any;

export function makeSessionCtx(sessionId = "test-session"): any {
  return {
    sessionManager: {
      getSessionId: () => sessionId,
      getSessionFile: () => `/tmp/sessions/${sessionId}.jsonl`,
      getBranch: () => [],
    },
    cwd: "/tmp/test",
    agent: "orchestrator",
  };
}
