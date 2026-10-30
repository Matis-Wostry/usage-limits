import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const BAND = {
  plugin: 'usage-limits',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

const LIMITS = [
  { kind: 'five_hour', percentUsed: 12, resetsAt: '2099-01-01T00:00:00Z' },
  { kind: 'seven_day', percentUsed: 39, resetsAt: '2099-01-03T00:00:00Z' },
  { kind: 'seven_day_fable', percentUsed: 64, resetsAt: '2099-01-03T00:00:00Z' },
]

const USAGE = (input: number, output: number, cacheRead = 0) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: 0,
  model: 'claude-fable-5-1',
})

// Stands for the engine: the commands, the usage figures and the selected model.
const engine = (on: Parameters<TestBody>[1], model: string) => {
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 110_000, window: 1_000_000, percent: 11 }, rateLimits: LIMITS } }))
  on('session.model', () => ({ value: model }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_, e) => ({ text: e.answer, usage: e.usage }))
  on('clock.now', () => ({ value: Date.parse('2098-12-31T23:00:00Z') }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
}

const turn = (id: string, usage: ReturnType<typeof USAGE>, agentId?: string) => ({
  answer: 'ok',
  durationMs: 1,
  isAborted: false,
  turnId: id,
  reason: 'answer' as const,
  usage,
  ...(agentId ? { agentId } : {}),
})

test('with Fable selected, the Fable bar takes the place of the 7 j one', async ($, on) => {
  engine(on, 'claude-fable-5-1')
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /^Fable$/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /^7 j$/ })).toBeFalsy()
    expect((await ui.find({ type: 'Text', text: /64 %/ }))?.text).toBeTruthy()
    await ui.unmount()
  }
})

test('with another model, the 7 j bar stays and no Fable bar shows', async ($, on) => {
  engine(on, 'claude-opus-5-5')
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^7 j$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^Fable$/ })).toBeFalsy()
  await ui.unmount()
})

test('the tokens line shows the last turn and the session totals, subagents included', async ($, on) => {
  engine(on, 'claude-fable-5-1')
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete(turn('t1', USAGE(1000, 500, 9000)))
  await $.turn.complete(turn('t2', USAGE(2000, 300), 'agent-1'))
  await $.turn.complete(turn('t3', USAGE(400, 1200)))

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const line = await ui.find({ type: 'Text', text: /Dernier tour/ })
  expect(line?.text).toBe('Dernier tour : entrée 400, sortie 1,2 k · Session : entrée 12 k, sortie 2 k · Contexte : 110 k / 1 M (11 %)')
  await ui.unmount()
})

test('showTokens off hides the tokens line', { options: { showTokens: false } }, async ($, on) => {
  engine(on, 'claude-fable-5-1')
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.complete(turn('t1', USAGE(1000, 500)))

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Dernier tour/ })).toBeFalsy()
  await ui.unmount()
})
