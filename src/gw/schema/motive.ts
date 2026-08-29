import { z } from 'zod'

export const MotiveSchema = z.looseObject({
  // All optional — charters are partially-authored documents
  id: z.string().optional(),        // slug, e.g. "obsidian-native-groundwork"
  title: z.string().optional(),     // H1 if captured in frontmatter
  status: z.enum(['active','paused','complete','archived']).optional(),
  objective: z.string().optional(),
  created: z.string().optional(),   // ISO date
  tags: z.array(z.string()).optional(),
  aliases: z.array(z.string()).optional(),  // Obsidian reserved
})

export type Motive = z.infer<typeof MotiveSchema>
