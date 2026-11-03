export type Question = { id: number; question: string; recommend: string | null; source: string }

export type QuestionLedger = { next: number; open: Question[] }

export type QuestionAsk = { question: string; recommend: string; source?: string }

declare module 'claude-code' {
  interface PluginState {
    groundwork: { ledger: QuestionLedger }
  }
  interface McpToolInputs {
    mcp__groundwork__ask: QuestionAsk
  }
}
