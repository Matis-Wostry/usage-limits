import { expect, mock, test } from 'claude-code/testing'
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
// Hands back the clock, and the toasts shown so far.
const engine = (on: Parameters<TestBody>[1], model: string, limits: typeof LIMITS | Limit[] = LIMITS, now = '2098-12-31T23:00:00Z') => {
  const toasts: string[] = []
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 110_000, window: 1_000_000, percent: 11 }, rateLimits: limits } }))
  on('session.model', () => ({ value: model }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: 'session' }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('turn.complete', (_, e) => ({ text: e.answer, usage: e.usage }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  return { clock: mock.clock(on, { now: Date.parse(now) }), toasts }
}

type Limit = { kind: string; percentUsed: number; resetsAt?: string }

// At 22:45 the 5 h window below is 75 % through and the 7 j one 71 %.
const AT_2245 = '2098-12-31T22:45:00Z'
const FIVE = '2099-01-01T00:00:00Z'
const WEEK = '2099-01-03T00:00:00Z'
const limitsAt = (five: number, week: number): Limit[] => [
  { kind: 'five_hour', percentUsed: five, resetsAt: FIVE },
  { kind: 'seven_day', percentUsed: week, resetsAt: WEEK },
]
const START = { cwd: '/', surface: 'desktop', isInteractive: true } as const
const CALM = '#2F6FDE'
const CAUTION = '#B8570F'
const ALERT = '#B3262B'
const band = (surface: 'terminal' | 'desktop', bodyColumns = 120, maxRows = 20) => ({
  ...BAND,
  surface,
  props: { ...BAND.props, bodyColumns, maxRows },
})

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

test('a bar turns orange from cautionAt, the others keep the calm colour', async ($, on) => {
  engine(on, 'claude-opus-5-5', limitsAt(75, 65), AT_2245)
  await $.session.start(START)

  const ui = await $.ui.mount(band('terminal'))
  expect((await ui.find({ type: 'Text', text: /^75 %$/ }))?.props.color).toBe(CAUTION)
  expect((await ui.find({ type: 'Text', text: /^65 %$/ }))?.props.color).toBe(CALM)
  await ui.unmount()
})

test('cautionAt moves the threshold', { options: { cautionAt: 80 } }, async ($, on) => {
  engine(on, 'claude-opus-5-5', limitsAt(75, 65), AT_2245)
  await $.session.start(START)

  const ui = await $.ui.mount(band('terminal'))
  expect((await ui.find({ type: 'Text', text: /^75 %$/ }))?.props.color).toBe(CALM)
  await ui.unmount()
})

test('a window past warnAt turns only its own bar red', async ($, on) => {
  engine(on, 'claude-opus-5-5', limitsAt(12, 95), AT_2245)
  await $.session.start(START)

  const terminal = await $.ui.mount(band('terminal'))
  expect((await terminal.find({ type: 'Text', text: /^12 %$/ }))?.props.color).toBe(CALM)
  expect((await terminal.find({ type: 'Text', text: /^95 %$/ }))?.props.color).toBe(ALERT)
  await terminal.unmount()

  const desktop = await $.ui.mount(band('desktop'))
  const [five, week] = (await desktop.findAll({ type: 'Svg' })).filter(s => /consommé/.test(String(s.props.source)))
  expect(String(five?.props.source)).toContain(`fill="${CALM}"`)
  expect(String(week?.props.source)).toContain(`fill="${ALERT}"`)
  await desktop.unmount()
})

test('the time left follows the clock without a new reply', async ($, on) => {
  const { clock } = engine(on, 'claude-opus-5-5', limitsAt(50, 20), AT_2245)
  await $.session.start(START)

  const ui = await $.ui.mount(band('desktop'))
  expect((await ui.find({ type: 'Text', text: /^Reset/ }))?.text).toBe('Reset : session 1 h 15 · semaine 2 j 1 h')
  await clock.advance(40 * 60_000)
  expect((await ui.find({ type: 'Text', text: /^Reset/ }))?.text).toBe('Reset : session 35 min · semaine 2 j 0 h')
  await ui.unmount()
})

test('a window past its reset starts over at zero', async ($, on) => {
  const { clock } = engine(on, 'claude-opus-5-5', limitsAt(95, 20), AT_2245)
  await $.session.start(START)
  await clock.set(Date.parse('2099-01-01T02:00:00Z'))

  const ui = await $.ui.mount(band('desktop'))
  expect(await ui.find({ type: 'Text', text: 'Limite proche' })).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: /^95 %$/ })).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: /^0 %$/ })).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /^Reset/ }))?.text).toBe('Reset : semaine 1 j 22 h')
  await ui.unmount()

  // The engine fills in the rest of the input.
  const detail = await $.command.run({ command: 'limites' } as Parameters<typeof $.command.run>[0])
  expect(detail.text).toContain('5 h (five_hour): 0%')
  expect(detail.text).not.toContain('95%')
})

for (const reason of ['clear', 'resume'] as const) {
  test(`${reason} empties the tokens line, the context's fill too`, async ($, on) => {
    engine(on, 'claude-opus-5-5', limitsAt(5, 5), AT_2245)
    await $.session.start(START)
    await $.turn.complete(turn('t1', USAGE(1000, 500)))
    await $.session.end({ reason } as Parameters<typeof $.session.end>[0])

    const ui = await $.ui.mount(band('desktop'))
    expect(await ui.find({ type: 'Text', text: /Contexte|Session :/ })).toBeFalsy()
    await ui.unmount()
  })
}

test('a toast already shown stays shown once, through a reload', async ($, on) => {
  const { toasts } = engine(on, 'claude-opus-5-5', limitsAt(95, 5), AT_2245)
  // What the module wrote before the reload stays in the session's state.
  on('state.get', (_, e, next) =>
    e.key === 'warned' ? { value: { value: [`five_hour:${FIVE}`], version: 1 } } : next(e),
  )
  await $.session.measure({
    context: { window: 1_000_000 },
    rateLimits: limitsAt(95, 5),
    changed: ['rateLimits'],
  })
  expect(toasts).toEqual([])
})

test('a window reaching warnAt shows one toast', async ($, on) => {
  const { toasts } = engine(on, 'claude-opus-5-5', limitsAt(95, 5), AT_2245)
  const measure = { context: { window: 1_000_000 }, rateLimits: limitsAt(95, 5), changed: ['rateLimits' as const] }
  await $.session.measure(measure)
  await $.session.measure(measure)
  expect(toasts).toEqual(['Limite 5 h à 95%'])
})

test('a forced layout keeps its bar width', { options: { layout: 'wide' } }, async ($, on) => {
  engine(on, 'claude-opus-5-5', limitsAt(50, 20), AT_2245)
  await $.session.start(START)

  const ui = await $.ui.mount(band('desktop', 60))
  const bar = (await ui.findAll({ type: 'Svg' })).find(s => /consommé/.test(String(s.props.source)))
  expect(bar?.props.width).toBe(120)
  await ui.unmount()
})

test('in the automatic layout, bars keep 65 % of their room from 50 to 69 columns', async ($, on) => {
  engine(on, 'claude-opus-5-5', limitsAt(50, 20), AT_2245)
  await $.session.start(START)

  const ui = await $.ui.mount(band('desktop', 60))
  const bar = (await ui.findAll({ type: 'Svg' })).find(s => /consommé/.test(String(s.props.source)))
  expect(bar?.props.width).toBe(105)
  await ui.unmount()
})

test('the tiny layout stacks its bars with no blank row in the terminal', async ($, on) => {
  engine(on, 'claude-opus-5-5', limitsAt(50, 20), AT_2245)
  await $.session.start(START)

  const ui = await $.ui.mount(band('terminal', 30, 2))
  const root = (await ui.drawn()) as unknown as { children: { props: { gap: number; flexDirection: string } }[] }
  expect(root.children[0]?.props.flexDirection).toBe('column')
  expect(root.children[0]?.props.gap).toBe(0)
  await ui.unmount()
})

test('a line that wraps counts for its rows', async ($, on) => {
  engine(on, 'claude-opus-5-5', limitsAt(50, 20), AT_2245)
  await $.session.start(START)
  const resetLine = /^Reset/

  // The reset line is 40 cells in a band of 36: two rows, above a card of five.
  const short = await $.ui.mount(band('terminal', 40, 6))
  expect(await short.find({ type: 'Text', text: resetLine })).toBeFalsy()
  await short.unmount()

  const tall = await $.ui.mount(band('terminal', 40, 7))
  expect(await tall.find({ type: 'Text', text: resetLine })).toBeTruthy()
  await tall.unmount()
})

test('the icon and the bars say what they show: an empty alt draws nothing on the desktop', async ($, on) => {
  engine(on, 'claude-opus-5-5', limitsAt(50, 20), AT_2245)
  await $.session.start(START)

  const ui = await $.ui.mount(band('desktop'))
  const alts = (await ui.findAll({ type: 'Svg' })).filter(s => /consommé|<circle/.test(String(s.props.source))).map(s => s.props.alt)
  // 50 % used with 75 % of the 5 h window gone: there is room, so the verdict pushes.
  expect(alts).toEqual(['Pousser', '5 h : 50 %', '7 j : 20 %'])
  await ui.unmount()
})

test('near a million, tokens read in millions', async ($, on) => {
  engine(on, 'claude-opus-5-5', limitsAt(5, 5), AT_2245)
  await $.session.start(START)
  await $.turn.complete(turn('t1', USAGE(999_600, 999_500)))

  const ui = await $.ui.mount(band('desktop'))
  expect((await ui.find({ type: 'Text', text: /Dernier tour/ }))?.text).toContain('Dernier tour : entrée 1 M, sortie 1 M')
  await ui.unmount()
})

test('the tooltip of a bar reads with a space after its label', async ($, on) => {
  engine(on, 'claude-opus-5-5', limitsAt(50, 20), AT_2245)
  await $.session.start(START)

  const ui = await $.ui.mount(band('desktop'))
  const [five] = (await ui.findAll({ type: 'Svg' })).filter(s => /consommé/.test(String(s.props.source)))
  expect(String(five?.props.source)).toContain('<title>5 h : 50 % consommé')
  await ui.unmount()
})
