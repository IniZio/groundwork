import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const BAND = {
  plugin: 'groundwork',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

function engine(on: On) {
  const submitted: string[] = []
  const files = new Map<string, string>()
  mock.env(on, { HOME: '/home/t' })
  on('session.id', () => ({ value: 'sess-1' }))
  on('fs.write', (_, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  return { submitted, files }
}

let turns = 0
const reply = ($: Engine, answer: string, end: { agentId?: string; isAborted?: boolean } = {}) => {
  const isAborted = end.isAborted === true
  return $.turn.complete({ answer, durationMs: 1, turnId: `t${++turns}`, reason: isAborted ? 'aborted' : 'answer', isAborted, agentId: end.agentId })
}

const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as const

async function shown($: Engine): Promise<string[]> {
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const out: string[] = []
  for (let id = 1; id <= 9; id++) {
    const t = await ui.find({ type: 'Text', text: new RegExp(`#${id} `) })
    if (t !== undefined) out.push(t.text)
  }
  await ui.unmount()
  return out
}

test('a reply line `question? Recommend: answer` becomes a numbered band entry and the reply passes through', async ($, on) => {
  engine(on)
  const answer = 'Done with the fix.\n\nShip it? Recommend: yes\n- **Squash?** Recommend: no'
  expect((await reply($, answer)).text).toBe(answer)
  expect(await shown($)).toEqual(['❓ #1 Ship it?', '❓ #2 Squash?'])
})

test('a repeated question keeps its number, and fenced, aborted and subagent replies record nothing', async ($, on) => {
  engine(on)
  await reply($, 'Ship it? Recommend: yes')
  await reply($, 'Still waiting. Ship it? Recommend: yes')
  await reply($, '```\nExample? Recommend: x\n```')
  await reply($, 'Questions now come from `<question>? Recommend: <answer>` lines.')
  await reply($, 'Half done? Recommend: y', { isAborted: true })
  await reply($, 'Which one? Recommend: A', { agentId: 'a1' })
  expect(await shown($)).toEqual(['❓ #1 Ship it?'])
})

test('the band shows an open question and its recommend button answers it', async ($, on) => {
  const { submitted } = engine(on)
  await reply($, 'Ship it? Recommend: yes')

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
  await reply($, 'Ship it? Recommend: yes\nSquash? Recommend: no')

  await $.prompt.submit(typed('#920 merge first'))
  await $.prompt.submit(typed('#2 yes, squash #920 too'))
  expect(submitted).toEqual([
    '#920 merge first\n(#1 still open: "Ship it?")\n(#2 still open: "Squash?")',
    '#2 yes, squash #920 too\n(#2 was: "Squash?")\n(#1 still open: "Ship it?")',
  ])
  expect(await shown($)).toEqual(['❓ #1 Ship it?'])
})

test('an answered question asked again gets a new number', async ($, on) => {
  engine(on)
  await reply($, 'Ship it? Recommend: yes')
  await $.prompt.submit(typed('#1 no'))
  await reply($, 'Ship it now? Recommend: yes')
  expect(await shown($)).toEqual(['❓ #2 Ship it now?'])
})

test('a question written as #N rewords open #N in place, and an unknown #N is a new question', async ($, on) => {
  const { submitted } = engine(on)
  await reply($, 'Ship it? Recommend: yes\nSquash? Recommend: no')
  await reply($, '#1 Ship it to staging first? Recommend: yes\n#7 Tag it? Recommend: yes')
  expect(await shown($)).toEqual(['❓ #1 Ship it to staging first?', '❓ #2 Squash?', '❓ #3 Tag it?'])
  await $.prompt.submit(typed('#1 ok'))
  expect(submitted).toEqual(['#1 ok\n(#1 was: "Ship it to staging first?")\n(#2 still open: "Squash?")\n(#3 still open: "Tag it?")'])
})

test('dismiss removes a question without submitting anything', async ($, on) => {
  const { submitted } = engine(on)
  await reply($, 'Ship it? Recommend: yes')

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'dismiss-1' })
  await ui.unmount()
  expect(submitted).toEqual([])
  expect(await shown($)).toEqual([])
})

test('session start marks the session live for the Stop hook', async ($, on) => {
  const { files } = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect([...files.keys()]).toEqual(['/home/t/.claude/groundwork/questions/sess-1.json'])
})

test('an answer queued while a turn runs keeps that turn\'s verbatim re-ask from opening a new number', async ($, on) => {
  engine(on)
  await reply($, 'Ship it? Recommend: yes\nSquash? Recommend: no\nTag it? Recommend: yes')
  await $.turn.start({ text: 'go on', turnId: 'live' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'rec-1' })
  await ui.press({ key: 'dismiss-3' })
  await ui.unmount()
  await $.prompt.submit(typed('#2 no'))
  await reply($, 'Ship it? Recommend: yes\n#2 Squash? Recommend: no\nTag it? Recommend: yes')
  expect(await shown($)).toEqual([])
})

test('an answered question re-asked verbatim in a later turn gets a new number', async ($, on) => {
  engine(on)
  await reply($, 'Ship it? Recommend: yes')
  await $.prompt.submit(typed('#1 not yet'))
  await $.turn.start({ text: '#1 not yet', turnId: 'next' })
  await reply($, 'Ship it? Recommend: yes')
  expect(await shown($)).toEqual(['❓ #2 Ship it?'])
})

test('a prompt that names /newman-mode without running it is told to load the skill', async ($, on) => {
  const { submitted } = engine(on)
  const load = /read \S+\/skills\/newman-mode\/SKILL\.md in full/
  await $.prompt.submit(typed(' /newman-mode clean up the boxes'))
  await $.prompt.submit(typed('\n\n<pasted_content id="c3c8">\n/groundwork:newman-mode clean up\n</pasted_content id="c3c8">\n\n- more'))
  await $.prompt.submit(typed('why did /newman-mode not load?'))
  await $.prompt.submit(typed('/newman-mode-extra is another name'))
  expect(submitted.map(s => load.test(s))).toEqual([true, true, false, false])
})
