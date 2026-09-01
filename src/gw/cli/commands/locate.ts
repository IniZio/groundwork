import { type GwEnvelope, okEnvelope, errEnvelope } from '../envelope.js'
import {
  DEFAULT_TRACKER_PATH,
  motiveDir,
  sliceNotePath,
  conceptIndexPath,
  requirementPath,
  specDecisionPath,
  motiveDecisionPath,
} from '../../../gw/schema/layout.js'

export async function run(args: string[], cwd: string): Promise<GwEnvelope> {
  if (args.length === 0) {
    return errEnvelope(
      'locate',
      'USAGE_ERROR',
      'Usage: gw locate <id>\n' +
        'ID formats:\n' +
        '  motive:<slug>           → .groundwork/motives/<slug>/\n' +
        '  slice:<motive>/<label>  → slice note path\n' +
        '  spec:<concept>          → doc/specs/<concept>/index.md\n' +
        '  req:<concept>/<req-id>  → requirement file\n' +
        '  decision:<concept>/<id> → spec decision file\n' +
        '  mdecision:<motive>/<id> → motive decision file',
      2,
    )
  }
  const id = args[0]
  const repoRoot = process.env['CLAUDE_PROJECT_DIR'] ?? cwd
  const tracker = DEFAULT_TRACKER_PATH

  const colonIdx = id.indexOf(':')
  if (colonIdx === -1) {
    return errEnvelope('locate', 'INVALID_ID', `ID must have format <kind>:<ref> — got: ${id}`, 1)
  }
  const kind = id.slice(0, colonIdx)
  const tail = id.slice(colonIdx + 1)

  let resolved: string
  switch (kind) {
    case 'motive':
      resolved = motiveDir(repoRoot, tracker, tail)
      break
    case 'slice': {
      const slashIdx = tail.indexOf('/')
      if (slashIdx === -1) {
        return errEnvelope('locate', 'INVALID_ID', `slice ID must be <motive>/<label>`, 1)
      }
      const motive = tail.slice(0, slashIdx)
      const label = tail.slice(slashIdx + 1)
      resolved = sliceNotePath(repoRoot, tracker, motive, label)
      break
    }
    case 'spec':
      resolved = conceptIndexPath(repoRoot, tail)
      break
    case 'req': {
      const slashIdx = tail.indexOf('/')
      if (slashIdx === -1) {
        return errEnvelope('locate', 'INVALID_ID', `req ID must be <concept>/<req-id>`, 1)
      }
      const concept = tail.slice(0, slashIdx)
      const reqId = tail.slice(slashIdx + 1)
      resolved = requirementPath(repoRoot, concept, reqId)
      break
    }
    case 'decision': {
      const slashIdx = tail.indexOf('/')
      if (slashIdx === -1) {
        return errEnvelope('locate', 'INVALID_ID', `decision ID must be <concept>/<id>`, 1)
      }
      const concept = tail.slice(0, slashIdx)
      const decId = tail.slice(slashIdx + 1)
      resolved = specDecisionPath(repoRoot, concept, decId)
      break
    }
    case 'mdecision': {
      const slashIdx = tail.indexOf('/')
      if (slashIdx === -1) {
        return errEnvelope('locate', 'INVALID_ID', `mdecision ID must be <motive>/<id>`, 1)
      }
      const motive = tail.slice(0, slashIdx)
      const decId = tail.slice(slashIdx + 1)
      resolved = motiveDecisionPath(repoRoot, tracker, motive, decId)
      break
    }
    default:
      return errEnvelope(
        'locate',
        'UNKNOWN_KIND',
        `Unknown id kind: "${kind}". Valid kinds: motive, slice, spec, req, decision, mdecision`,
        1,
      )
  }

  return okEnvelope('locate', { id, path: resolved })
}
