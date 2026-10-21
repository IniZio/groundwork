export interface CleanupOptions {
  commentChar: string
  cleanup: string
  editorUsed: boolean
}

export declare function cleanMessage(raw: string, opts: CleanupOptions): string
export declare function checkCommitMessage(cwd: string, raw: string, opts: { editorUsed: boolean }): string | null
export declare function runLintCommitMsg(file: string, cwd: string): number
