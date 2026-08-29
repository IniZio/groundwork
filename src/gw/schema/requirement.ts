import { z } from 'zod'

export const RequirementSchema = z.looseObject({
  id: z.string(),                 // e.g. "orchestration-r-001"
  title: z.string(),
  concept: z.string().optional(), // wikilink e.g. "[[orchestration/index]]"
  criticality: z.enum(['must','should','may']).optional(),
  verification: z.enum(['manual','automated']).optional(),
  ears_pattern: z.enum([
    'Ubiquitous',
    'Event-driven',
    'State-driven',
    'Optional feature',
    'Unwanted behaviour',
    'Complex',
    'IF-THEN',
  ]).optional(),
  verification_method: z.enum(['Test','Inspection','Demonstration','Analysis']).optional(),
  design: z.string().optional(),  // wikilink e.g. "[[design#Delegation hierarchy]]"
  status: z.enum(['open','implemented','deprecated']).optional(),
  source: z.string().optional(),  // origin reference e.g. "groundwork-development#D-34"
  verifies: z.union([z.string(), z.array(z.string())]).optional(), // D-8: coverage wikilinks
})

export type Requirement = z.infer<typeof RequirementSchema>
