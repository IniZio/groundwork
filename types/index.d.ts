export type Question = { id: number; question: string; recommend: string }

export type QuestionLedger = { next: number; open: Question[] }

declare module 'claude-code' {
  interface PluginState {
    groundwork: { ledger: QuestionLedger }
  }
}
