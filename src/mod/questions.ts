export type AskedQuestion = { id?: number; question: string; recommend: string }

const ASKED = /^(?:[-*]\s+|\d+[.)]\s+)?(?:#(\d+)\s+)?(.*\?)[*_]*\s+Recommend:\s*(.+)$/

/** A reply line `[#N] <question>? Recommend: <answer>`, the shape both the band and the Stop hook read. */
export function parseQuestion(line: string): AskedQuestion | null {
  const s = line.trim().replace(/\*\*/g, '')
  const m = ASKED.exec(s)
  if (m === null) return null
  const insideCode = (s.slice(0, s.length - m[3]!.length).match(/`/g)?.length ?? 0) % 2 === 1
  if (insideCode) return null
  const question = m[2]!.split(/(?<=[.!])\s+/).at(-1)!.trim()
  const recommend = m[3]!.trim()
  if (question === '?' || recommend === '') return null
  return m[1] === undefined ? { question, recommend } : { id: Number(m[1]), question, recommend }
}

export function askedQuestions(reply: string): AskedQuestion[] {
  const out: AskedQuestion[] = []
  let fenced = false
  for (const line of reply.split('\n')) {
    if (line.trim().startsWith('```')) { fenced = !fenced; continue }
    const q = fenced ? null : parseQuestion(line)
    if (q !== null) out.push(q)
  }
  return out
}
