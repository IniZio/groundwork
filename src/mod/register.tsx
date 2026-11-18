import { atom, read, update } from 'claude-code'
import type { CoreEngineInterface, Register } from 'claude-code'

import type { Question, QuestionLedger } from '../../types'
import { askedQuestions } from './questions'

const ledger = atom({ plugin: 'groundwork', key: 'ledger' } as const, { next: 1, open: [] } as QuestionLedger)

type Dollar = Pick<CoreEngineInterface, 'state'>

const change = ($: Dollar, fn: (l: QuestionLedger) => QuestionLedger) => update($, ledger, fn)

function answeredIds(prompt: string): number[] {
  return [...prompt.matchAll(/(?<![\w#])#(\d+) /g)].map(m => Number(m[1]))
}

async function answer($: Dollar, prompt: string): Promise<string> {
  const ids = new Set(answeredIds(prompt))
  let closed: Question[] = []
  let open: Question[] = []
  await change($, l => {
    closed = l.open.filter(q => ids.has(q.id))
    open = l.open.filter(q => !ids.has(q.id))
    return closed.length === 0 ? l : { ...l, open }
  })
  return [
    prompt,
    ...closed.map(q => `(#${q.id} was: "${q.question}")`),
    ...open.map(q => `(#${q.id} still open: "${q.question}")`),
  ].join('\n')
}

// Questions come from the reply, not a tool: a tool.call hook turns Code Mode off for the session.
function record(l: QuestionLedger, reply: string): QuestionLedger {
  const open = [...l.open]
  let next = l.next
  for (const { id, question, recommend } of askedQuestions(reply)) {
    const i = open.findIndex(q => q.id === id || q.question === question)
    if (i === -1) open.push({ id: next++, question, recommend })
    else open[i] = { id: open[i]!.id, question, recommend }
  }
  return { next, open }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const home = await $.env.get('HOME')
    if (home !== undefined) await $.fs.write(`${home}/.claude/groundwork/questions/${await $.session.id()}.json`, '{}')
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && !e.isAborted) await change($, l => record(l, e.answer))
    return next(e)
  })

  on('prompt.submit', async ($, e, next) =>
    e.command !== undefined || e.isMeta === true ? next(e) : next({ ...e, text: await answer($, e.text) }),
  )

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { open } = await read($, ledger)
    if (e.props.hasSurvey || open.length === 0) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const dismiss = (id: number) => change($, l => ({ ...l, open: l.open.filter(q => q.id !== id) }))

    return (
      <Box flexDirection="column">
        {open.map(q => (
          <Box key={`q-${q.id}`} flexDirection="column">
            <Text>❓ #{q.id} {q.question}</Text>
            <Box flexWrap="wrap">
              <Button
                key={`rec-${q.id}`}
                label={q.recommend}
                onPress={async () => $.prompt.submit({ text: await answer($, `#${q.id} ${q.recommend}`), asUser: true })}
              />
              <Button key={`answer-${q.id}`} label="answer…" onPress={() => $.prompt.fill({ text: `#${q.id} `, mode: 'insert' })} />
              <Button key={`dismiss-${q.id}`} label="✕" onPress={() => dismiss(q.id)} />
            </Box>
          </Box>
        ))}
      </Box>
    )
  })
}
