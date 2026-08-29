import { z } from 'zod'

export const TicketSchema = z.looseObject({
  id: z.string().optional(),
  title: z.string().optional(),
  status: z.enum(['open','in-progress','done','cancelled']).optional(),
  created: z.string().optional(),          // ISO date
  tags: z.array(z.string()).optional(),
  aliases: z.array(z.string()).optional(),  // Obsidian reserved
  links: z.array(z.string()).optional(),    // wikilinks e.g. "[[other-ticket]]"
})

export type Ticket = z.infer<typeof TicketSchema>
