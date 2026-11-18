export type Question = { id: number; question: string; recommend: string }

/** `working`: a main-loop turn is running. `closedMidTurn`: questions answered or dismissed during it, so its reply re-asking them adds nothing. */
export type QuestionLedger = { next: number; open: Question[]; working?: boolean; closedMidTurn?: Question[] }

declare module 'claude-code' {
  interface PluginState {
    groundwork: { ledger: QuestionLedger }
  }
}
