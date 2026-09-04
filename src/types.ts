// ─── Shared TypeScript Interfaces ──────────────────────────────────────────

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      CLAUDE_CODE_SESSION_ID?: string;
      CLAUDE_PROJECT_DIR?: string;
    }
  }
}
