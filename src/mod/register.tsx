import { atom, read, update } from 'claude-code'
import type { Register, StateDollar } from 'claude-code'

import type { Question, QuestionLedger } from '../../types'

const TOOL = 'mcp__groundwork__ask'
const ledger = atom({ plugin: 'groundwork', key: 'ledger' } as const, { next: 1, open: [] } as QuestionLedger)

const DESCRIPTION = [
  'Record a question for the user so it stays on screen above the prompt with one-click answers.',
  'Use it for every question you put to the user, with your recommended answer.',
  'Do not wait for the answer: end your reply with the line the result gives you and keep working on whatever the question does not block.',
].join(' ')

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    question: { type: 'string', description: 'The question, answerable in a word or a short phrase.' },
    recommend: { type: 'string', description: 'Your recommended answer.' },
    source: { type: 'string', description: 'The asking agent\'s name; "lead" when it is you.' },
  },
  required: ['question', 'recommend'],
}

const filled = (s: string | undefined): string | null => (s?.trim() ? s.trim() : null)

function answeredIds(prompt: string): number[] {
  return [...prompt.matchAll(/(?<![\w#])#(\d+) /g)].map(m => Number(m[1]))
}

async function answer($: StateDollar, prompt: string): Promise<string> {
  const ids = new Set(answeredIds(prompt))
  if (ids.size === 0) return prompt
  let closed: Question[] = []
  await update($, ledger, l => {
    closed = l.open.filter(q => ids.has(q.id))
    return closed.length === 0 ? l : { ...l, open: l.open.filter(q => !ids.has(q.id)) }
  })
  return [prompt, ...closed.map(q => `(#${q.id} was: "${q.question}")`)].join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({ name: 'ask', description: DESCRIPTION, inputSchema: INPUT_SCHEMA, isDeferred: true })
    return next(e)
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const question = filled(e.question)
    if (question === null) return { deny: 'ask needs a non-empty `question`.' }
    const recommend = filled(e.recommend)
    const source = filled(e.source) ?? 'lead'
    const written = await update($, ledger, l => ({
      next: l.next + 1,
      open: [...l.open, { id: l.next, question, recommend, source }],
    }))
    const id = written.next - 1
    return { result: `Question #${id} recorded. End your reply with: #${id} ${question} Recommend: ${recommend ?? '-'}` }
  })

  on('prompt.submit', async ($, e, next) =>
    e.command !== undefined || e.isMeta === true ? next(e) : next({ ...e, text: await answer($, e.text) }),
  )

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { open } = await read($, ledger)
    if (e.props.hasSurvey || open.length === 0) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const dismiss = (id: number) => update($, ledger, l => ({ ...l, open: l.open.filter(q => q.id !== id) }))

    return (
      <Box flexDirection="column">
        {open.map(q => (
          <Box key={`q-${q.id}`}>
            <Text>❓ #{q.id} {q.question} </Text>
            {q.recommend === null ? null : (
              <Button
                key={`rec-${q.id}`}
                label={q.recommend}
                onPress={async () => $.prompt.submit({ text: await answer($, `#${q.id} ${q.recommend}`), asUser: true })}
              />
            )}
            <Button key={`answer-${q.id}`} label="answer…" onPress={() => $.prompt.fill({ text: `#${q.id} `, mode: 'insert' })} />
            <Button key={`dismiss-${q.id}`} label="✕" onPress={() => dismiss(q.id)} />
          </Box>
        ))}
      </Box>
    )
  })
}
