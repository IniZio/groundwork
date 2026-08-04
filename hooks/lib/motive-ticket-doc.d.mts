// Type declarations for motive-ticket-doc.mjs

export declare const REQUIRED_SECTIONS: readonly string[]

export interface TemplateOpts {
  title: string
  type?: string
  status?: string
  blockedBy?: string
}

export interface ParseResult {
  emptySections: string[]
}

export interface WriteResult {
  written: boolean
}

export declare function renderTemplate(opts: TemplateOpts): string

export declare function parseTicket(content: string): ParseResult

export declare function writeTicket(ticketPath: string, opts: TemplateOpts): Promise<WriteResult>

export declare function resolveTicketPath(
  charter: { tickets_dir?: string } | null | undefined,
  motiveDir: string,
  ticketId: string,
): string
