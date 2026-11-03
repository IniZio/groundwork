import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const TOOL = 'mcp__groundwork__ask'
const LEDGER = '/home/t/.claude/groundwork/questions/sess-1.json'
const BAND = {
  plugin: 'groundwork',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

function engine(on: On) {
  const registered: unknown[] = []
  const submitted: string[] = []
  const files = new Map<string, unknown>()
  mock.env(on, { HOME: '/home/t' })
  on('session.id', () => ({ value: 'sess-1' }))
  on('fs.write', (_, e) => {
    files.set(e.path, JSON.parse(e.text))
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.register', (_, e) => {
    registered.push(e)
    return { value: { tool: `mcp__groundwork__${e.name}` } }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  return { registered, submitted, ledger: () => files.get(LEDGER) }
}

const ask = ($: Engine, question: string, recommend: string) =>
  $.tool.call({ tool: TOOL, question, recommend, source: 'lead' })

const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as const

test('the ask tool registers deferred and records a numbered question', async ($, on) => {
  const { registered } = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(registered).toEqual([expect.objectContaining({ name: 'ask', isDeferred: true })])

  const first = await ask($, 'Ship it?', 'yes')
  expect(first.result).toBe('Question #1 recorded. End your reply with: #1 Ship it? Recommend: yes')
  const second = await ask($, 'Squash?', 'no')
  expect(second.result).toBe('Question #2 recorded. End your reply with: #2 Squash? Recommend: no')
})

test('the band shows an open question and its recommend button answers it', async ($, on) => {
  const { submitted } = engine(on)
  await ask($, 'Ship it?', 'yes')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /#1/ }))?.text).toContain('#1 Ship it?')
    expect(await ui.find({ key: 'rec-1' })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'rec-1' })
  await ui.unmount()
  expect(submitted).toEqual(['#1 yes\n(#1 was: "Ship it?")'])

  const after = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await after.find({ type: 'Text', text: /#1/ })).toBeUndefined()
  expect((await after.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await after.unmount()
})

test('a typed answer closes its question and leaves other #numbers alone', async ($, on) => {
  const { submitted } = engine(on)
  await ask($, 'Ship it?', 'yes')
  await ask($, 'Squash?', 'no')

  await $.prompt.submit(typed('#920 merge first'))
  await $.prompt.submit(typed('#2 yes, squash #920 too'))
  expect(submitted).toEqual(['#920 merge first', '#2 yes, squash #920 too\n(#2 was: "Squash?")'])

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /#1/ }))?.text).toContain('#1 Ship it?')
  expect(await ui.find({ type: 'Text', text: /#2/ })).toBeUndefined()
  await ui.unmount()
})

test('dismiss removes a question without submitting anything', async ($, on) => {
  const { submitted } = engine(on)
  await ask($, 'Ship it?', 'yes')

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'dismiss-1' })
  await ui.unmount()
  expect(submitted).toEqual([])

  const after = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await after.find({ type: 'Text', text: /#1/ })).toBeUndefined()
  await after.unmount()
})

test('session start writes an empty ledger file for the hook', async ($, on) => {
  const { ledger } = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(ledger()).toEqual({ recorded: [], open: [] })
})

test('ask writes the ledger file before it returns, and an answer closes the id but keeps it recorded', async ($, on) => {
  const { ledger } = engine(on)
  await ask($, 'Ship it?', 'yes')
  expect(ledger()).toEqual({ recorded: [1], open: [1] })

  await $.prompt.submit(typed('#1 yes'))
  expect(ledger()).toEqual({ recorded: [1], open: [] })
})
