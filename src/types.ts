// ─── Shared TypeScript Interfaces ──────────────────────────────────────────

/** A detected change between two snapshots */
export interface FileChange {
  path: string
  type: 'added' | 'removed' | 'modified'
}

/** Tool context passed to tool execute functions */
export interface ToolContext {
  sessionID: string
  messageID: string
  agent?: string
}

/** Message info from session messages */
export interface MessageInfo {
  role: string
  agent?: string
  model?: { providerID: string; modelID: string }
}

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      CLAUDE_CODE_SESSION_ID?: string;
      CLAUDE_PROJECT_DIR?: string;
    }
  }
}
