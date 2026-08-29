import { z } from 'zod'

/** D-15: valid design note kinds */
export const DesignNoteKind = z.enum([
  'moc',        // _MOC.md — curated reading map
  'concept',    // Diataxis explanation
  'flow',       // decision path / state machine
  'component',  // Carbon-style anatomy page
  'recipe',     // Diataxis how-to
  'reference',  // reference table
  'glossary',   // term definitions
])

export type DesignNoteKindValue = z.infer<typeof DesignNoteKind>

/** Concept index.md frontmatter */
export const ConceptIndexSchema = z.looseObject({
  id: z.string(),               // e.g. "C-ORCHESTRATION"
  type: DesignNoteKind,         // always required on the index
  title: z.string(),
  summary: z.string().optional(),
  status: z.enum(['draft','review','approved','deprecated']).optional(),
  depends_on: z.array(z.string()).optional(),  // wikilinks to other concept ids
  date_updated: z.string().optional(),          // ISO date
  parent: z.string().optional(),                // parent concept id
  origin_decision_ref: z.string().optional(),   // wikilink
  tags: z.array(z.string()).optional(),
  aliases: z.array(z.string()).optional(),
})

export type ConceptIndex = z.infer<typeof ConceptIndexSchema>
