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
  const commands: string[] = []
  const opened: string[] = []
  const closed: string[] = []
  on('command.register', (_, e) => {
    commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.open', (_, e) => {
    opened.push(`${e.id}:${e.title}`)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 110_000, window: 1_000_000, percent: 11 }, rateLimits: limits } }))
  on('session.model', () => ({ value: model }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: 'session' }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('turn.complete', (_, e) => ({ text: e.answer, usage: e.usage }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  return { clock: mock.clock(on, { now: Date.parse(now) }), toasts, commands, opened, closed }
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
  expect(detail.text).toContain('5 h (five_hour) : 0 %')
  expect(detail.text).not.toContain('95 %')
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
  expect(toasts).toEqual(['Limite 5 h à 95 %'])
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

// ---- Forecast ----

// At 22:45, 3 h 45 of the 5 h window are gone: 90 % used leaves 10 %, at 24 % an hour: 25 min.
test('the band says when the limit comes at this pace', async ($, on) => {
  engine(on, 'claude-opus-5-5', limitsAt(90, 5), AT_2245)
  await $.session.start(START)

  const ui = await $.ui.mount(band('desktop'))
  expect((await ui.find({ type: 'Text', text: /rythme/ }))?.text).toBe('À ce rythme : limite 5 h dans 25 min')
  await ui.unmount()
})

test('no forecast when the reset comes first', async ($, on) => {
  engine(on, 'claude-opus-5-5', limitsAt(50, 20), AT_2245)
  await $.session.start(START)

  const ui = await $.ui.mount(band('desktop'))
  expect(await ui.find({ type: 'Text', text: /rythme/ })).toBeFalsy()
  await ui.unmount()
})

test('no forecast in the first tenth of a window', async ($, on) => {
  engine(on, 'claude-opus-5-5', [{ kind: 'five_hour', percentUsed: 40, resetsAt: FIVE }], '2098-12-31T19:20:00Z')
  await $.session.start(START)

  const ui = await $.ui.mount(band('desktop'))
  expect(await ui.find({ type: 'Text', text: /rythme/ })).toBeFalsy()
  await ui.unmount()
})

test('showForecast off hides the forecast', { options: { showForecast: false } }, async ($, on) => {
  engine(on, 'claude-opus-5-5', limitsAt(90, 5), AT_2245)
  await $.session.start(START)

  const ui = await $.ui.mount(band('desktop'))
  expect(await ui.find({ type: 'Text', text: /rythme/ })).toBeFalsy()
  await ui.unmount()
})

test('when rows run short, the forecast stays before the reset line', async ($, on) => {
  engine(on, 'claude-opus-5-5', limitsAt(90, 5), AT_2245)
  await $.session.start(START)

  const six = await $.ui.mount(band('terminal', 120, 6))
  expect(await six.find({ type: 'Text', text: /rythme/ })).toBeTruthy()
  expect(await six.find({ type: 'Text', text: /^Reset/ })).toBeFalsy()
  await six.unmount()

  const seven = await $.ui.mount(band('terminal', 120, 7))
  expect(await seven.find({ type: 'Text', text: /^Reset/ })).toBeTruthy()
  await seven.unmount()
})

// ---- Reset format ----

// 2099-01-01 is a Thursday, the 3rd a Saturday. Local times: the display follows the person's clock.
const CLOCK_NOW = new Date(2099, 0, 1, 18, 0).toISOString()
const CLOCK_LIMITS: Limit[] = [
  { kind: 'five_hour', percentUsed: 50, resetsAt: new Date(2099, 0, 1, 18, 40).toISOString() },
  { kind: 'seven_day', percentUsed: 20, resetsAt: new Date(2099, 0, 3, 21, 5).toISOString() },
]

test('resetFormat clock writes the time of the reset', { options: { resetFormat: 'clock' } }, async ($, on) => {
  engine(on, 'claude-opus-5-5', CLOCK_LIMITS, CLOCK_NOW)
  await $.session.start(START)

  const ui = await $.ui.mount(band('desktop'))
  expect((await ui.find({ type: 'Text', text: /^Reset/ }))?.text).toBe('Reset : session à 18 h 40 · semaine sam. à 21 h 05')
  const [five] = (await ui.findAll({ type: 'Svg' })).filter(s => /consommé/.test(String(s.props.source)))
  expect(String(five?.props.source)).toContain('reset à 18 h 40')
  await ui.unmount()

  const detail = await $.command.run({ command: 'limites' } as Parameters<typeof $.command.run>[0])
  expect(detail.text).toContain('reset à 18 h 40')
})

test('resetFormat clock, in English', { options: { resetFormat: 'clock', language: 'en' } }, async ($, on) => {
  engine(on, 'claude-opus-5-5', CLOCK_LIMITS, CLOCK_NOW)
  await $.session.start(START)

  const ui = await $.ui.mount(band('desktop'))
  expect((await ui.find({ type: 'Text', text: /^Reset/ }))?.text).toBe('Reset: session at 18:40 · week Sat at 21:05')
  await ui.unmount()
})

// ---- Languages ----

test('in French, the commands are French', async ($, on) => {
  const { commands } = engine(on, 'claude-opus-5-5', limitsAt(50, 20), AT_2245)
  await $.session.start(START)
  expect(commands).toEqual(['limites', 'limites-masquer', 'usage-limits-config'])
})

test('in English, the commands are English', { options: { language: 'en' } }, async ($, on) => {
  const { commands } = engine(on, 'claude-opus-5-5', limitsAt(50, 20), AT_2245)
  await $.session.start(START)
  expect(commands).toEqual(['limits', 'limits-hide', 'usage-limits-config'])
})

test('in English, the band is English', { options: { language: 'en' } }, async ($, on) => {
  engine(on, 'claude-opus-5-5', limitsAt(90, 5), AT_2245)
  await $.session.start(START)
  await $.turn.complete(turn('t1', USAGE(400, 1200)))

  const ui = await $.ui.mount(band('desktop'))
  expect(await ui.find({ type: 'Text', text: 'Near limit' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^7 d$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^90%$/ })).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /pace/ }))?.text).toBe('At this pace: 5 h limit in 25 min')
  expect((await ui.find({ type: 'Text', text: /^Reset/ }))?.text).toBe('Reset: session 1 h 15 · week 2 d 1 h')
  expect((await ui.find({ type: 'Text', text: /Last turn/ }))?.text).toBe('Last turn: input 400, output 1.2 k · Session: input 400, output 1.2 k · Context: 110 k / 1 M (11%)')
  const [five] = (await ui.findAll({ type: 'Svg' })).filter(s => /used/.test(String(s.props.source)))
  expect(String(five?.props.source)).toContain('<title>5 h: 90% used · 75% of the time elapsed (black mark) · resets in 1 h 15')
  expect(five?.props.alt).toBe('5 h: 90%')
  await ui.unmount()
})

test('/limites reads entirely in French', async ($, on) => {
  engine(on, 'claude-opus-5-5', limitsAt(90, 5), AT_2245)
  await $.session.start(START)
  await $.turn.complete(turn('t1', USAGE(400, 1200, 9000)))

  const detail = await $.command.run({ command: 'limites' } as Parameters<typeof $.command.run>[0])
  expect(detail.text).toBe([
    '5 h (five_hour) : 90 %, reset dans 1 h 15 (-15 pts par rapport au temps, ↓)',
    '7 j (seven_day) : 5 %, reset dans 2 j 1 h (+66 pts par rapport au temps, ↑)',
    'À ce rythme : limite 5 h dans 25 min',
    '',
    'Modèle : claude-opus-5-5 (bande : 5 h, 7 j)',
    'Dernier tour : entrée 9,4 k (dont cache lu 9 k, écrit 0), sortie 1,2 k',
    'Session : entrée 9,4 k (dont cache lu 9 k, écrit 0), sortie 1,2 k',
    'Contexte : 110 k / 1 M (11 %)',
  ].join('\n'))
})

test('/limits reads entirely in English', { options: { language: 'en' } }, async ($, on) => {
  engine(on, 'claude-opus-5-5', limitsAt(90, 5), AT_2245)
  await $.session.start(START)
  await $.turn.complete(turn('t1', USAGE(400, 1200, 9000)))

  const detail = await $.command.run({ command: 'limits' } as Parameters<typeof $.command.run>[0])
  expect(detail.text).toBe([
    '5 h (five_hour): 90%, resets in 1 h 15 (-15 pts vs time, ↓)',
    '7 d (seven_day): 5%, resets in 2 d 1 h (+66 pts vs time, ↑)',
    'At this pace: 5 h limit in 25 min',
    '',
    'Model: claude-opus-5-5 (band: 5 h, 7 d)',
    'Last turn: input 9.4 k (cached read 9 k, written 0), output 1.2 k',
    'Session: input 9.4 k (cached read 9 k, written 0), output 1.2 k',
    'Context: 110 k / 1 M (11%)',
  ].join('\n'))
})

test('hiding the band answers in the language chosen', { options: { language: 'en' } }, async ($, on) => {
  engine(on, 'claude-opus-5-5', limitsAt(50, 20), AT_2245)
  await $.session.start(START)
  const answer = await $.command.run({ command: 'limits-hide' } as Parameters<typeof $.command.run>[0])
  expect(answer.text).toBe('Band hidden. /limits brings it back.')
})

test('the toast speaks English too', { options: { language: 'en' } }, async ($, on) => {
  const { toasts } = engine(on, 'claude-opus-5-5', limitsAt(95, 5), AT_2245)
  await $.session.measure({ context: { window: 1_000_000 }, rateLimits: limitsAt(95, 5), changed: ['rateLimits'] })
  expect(toasts).toEqual(['5 h limit at 95%'])
})

const CONFIG_ROW = { key: 'usage-limits.warnAt', label: 'Alert threshold (%)', description: 'The bar turns red.', isHidden: false }
const describeRow = ($: Parameters<TestBody>[0]) =>
  $.config.describe({ ...CONFIG_ROW, provider: { plugin: 'engine', tier: 'core' } } as Parameters<typeof $.config.describe>[0])
const describedAsIs = (on: Parameters<TestBody>[1]) =>
  on('config.describe', (_, e) => ({ label: e.label, description: e.description, isHidden: e.isHidden }))

test('in French, the /config menu is French', async ($, on) => {
  describedAsIs(on)
  expect((await describeRow($)).label).toBe('Seuil d’alerte (%)')
})

test('in English, the /config menu keeps the manifest words', { options: { language: 'en' } }, async ($, on) => {
  describedAsIs(on)
  expect((await describeRow($)).label).toBe('Alert threshold (%)')
})

const configRows = (on: Parameters<TestBody>[1]) => {
  on('config.list', () => ({
    value: [
      { key: 'usage-limits.warnAt', label: 'x', kind: 'number', value: 90, provider: { plugin: 'usage-limits', tier: 'user' }, isLocked: false },
      { key: 'usage-limits.showDelta', label: 'x', kind: 'boolean', value: false, provider: { plugin: 'usage-limits', tier: 'user' }, isLocked: false },
    ],
  } as never))
}
const runConfig = ($: Parameters<TestBody>[0], args: string) =>
  $.command.run({ command: 'usage-limits-config', args } as Parameters<typeof $.command.run>[0])

test('/usage-limits-config reads in French', async ($, on) => {
  configRows(on)
  expect((await runConfig($, '')).text).toBe('Réglages de usage-limits (change avec /usage-limits-config réglage=valeur) :\nwarnAt = 90\nshowDelta = false')
  expect((await runConfig($, 'nope=1')).text).toBe('Réglage inconnu : nope\nwarnAt = 90\nshowDelta = false')
  expect((await runConfig($, 'warnAt=abc')).text).toBe('warnAt attend un nombre.')
  expect((await runConfig($, 'showDelta=abc')).text).toBe('showDelta attend true ou false.')
})

test('/usage-limits-config reads in English', { options: { language: 'en' } }, async ($, on) => {
  configRows(on)
  expect((await runConfig($, '')).text).toBe('usage-limits settings (change with /usage-limits-config setting=value):\nwarnAt = 90\nshowDelta = false')
  expect((await runConfig($, 'nope=1')).text).toBe('Unknown setting: nope\nwarnAt = 90\nshowDelta = false')
  expect((await runConfig($, 'warnAt=abc')).text).toBe('warnAt expects a number.')
  expect((await runConfig($, 'showDelta=abc')).text).toBe('showDelta expects true or false.')
})

// ---- History ----

const PANE = (bodyColumns = 80) => ({
  plugin: 'usage-limits',
  component: 'Pane',
  requestId: 'usage-limits-history',
  surface: 'desktop',
  props: { title: 'x', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
}) as const
// Local noon on Friday the 2nd of January 2099.
const JAN_2 = new Date(2099, 0, 2, 12, 0).toISOString()
const measureAt = (five: number) => ({ context: { window: 1_000_000 }, rateLimits: limitsAt(five, 5), changed: ['rateLimits' as const] })

test('history off: nothing recorded, no command, no pane', async ($, on) => {
  const stored: string[] = []
  const { commands, opened } = engine(on, 'claude-opus-5-5', limitsAt(50, 20), JAN_2)
  on('store.set', (_, e) => {
    stored.push(e.key)
    return { value: undefined }
  })
  await $.session.start(START)
  await $.session.measure(measureAt(40))
  await $.turn.complete(turn('t1', USAGE(100, 200)))
  expect(stored).toEqual([])
  expect(opened).toEqual([])
  expect(commands).not.toContain('limites-historique')
})

test('history off closes a pane left open', async ($, on) => {
  const { closed } = engine(on, 'claude-opus-5-5', limitsAt(50, 20), JAN_2)
  await $.session.start(START)
  expect(closed).toEqual(['usage-limits-history'])
})

test('history on: the pane opens at start and its command is there', { options: { history: true } }, async ($, on) => {
  const { commands, opened } = engine(on, 'claude-opus-5-5', limitsAt(50, 20), JAN_2)
  mock.store(on)
  await $.session.start(START)
  expect(opened).toEqual(['usage-limits-history:Historique'])
  expect(commands).toContain('limites-historique')
  const answer = await $.command.run({ command: 'limites-historique' } as Parameters<typeof $.command.run>[0])
  expect(answer.text).toBe('Panneau d’historique ouvert.')
})

test('the pane shows each day’s peak and its tokens without the cache read', { options: { history: true } }, async ($, on) => {
  engine(on, 'claude-opus-5-5', limitsAt(50, 20), JAN_2)
  mock.store(on)
  await $.session.start(START)
  await $.session.measure(measureAt(40))
  await $.session.measure(measureAt(60))
  await $.session.measure(measureAt(55))
  await $.turn.complete(turn('t1', USAGE(1000, 300, 90_000)))
  await $.turn.complete(turn('t2', USAGE(200, 100), 'agent-1'))

  const ui = await $.ui.mount(PANE())
  expect(await ui.find({ type: 'Text', text: /^02\/01$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^60 %$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^55 %$/ })).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: /^↓1,2 k ↑400$/ })).toBeTruthy()
  await ui.unmount()
})

test('the pane keeps earlier sessions, newest day first', { options: { history: true } }, async ($, on) => {
  engine(on, 'claude-opus-5-5', limitsAt(50, 20), JAN_2)
  mock.store(on, { 'history-v1': { '2099-01-01': { peaks: { five_hour: 33 }, input: 1000, output: 2000 } } })
  await $.session.start(START)
  await $.session.measure(measureAt(40))

  const ui = await $.ui.mount(PANE())
  const dates = (await ui.findAll({ type: 'Text', text: /^\d\d\/\d\d$/ })).map(t => t.text)
  expect(dates).toEqual(['02/01', '01/01'])
  expect(await ui.find({ type: 'Text', text: /^33 %$/ })).toBeTruthy()
  await ui.unmount()
})

test('the store keeps ninety days at most', { options: { history: true } }, async ($, on) => {
  engine(on, 'claude-opus-5-5', limitsAt(50, 20), JAN_2)
  const old: Record<string, unknown> = {}
  for (let day = 1; day <= 95; day++) {
    old[`2098-0${1 + Math.floor((day - 1) / 31)}-${String(1 + ((day - 1) % 31)).padStart(2, '0')}`] = { peaks: {}, input: 0, output: 0 }
  }
  let saved: unknown = old
  on('store.get', () => ({ value: saved }))
  on('store.set', (_, e) => {
    saved = e.value
    return { value: undefined }
  })
  await $.session.start(START)
  await $.session.measure(measureAt(40))

  const days = Object.keys(saved as Record<string, unknown>).sort()
  expect(days).toHaveLength(90)
  expect(days.at(-1)).toBe('2099-01-02')
})

test('a stored value of the wrong shape starts over', { options: { history: true } }, async ($, on) => {
  engine(on, 'claude-opus-5-5', limitsAt(50, 20), JAN_2)
  mock.store(on, { 'history-v1': 'oops' })
  await $.session.start(START)

  const ui = await $.ui.mount(PANE())
  expect(await ui.find({ type: 'Text', text: 'Pas encore de données.' })).toBeTruthy()
  await ui.unmount()
})

test('the pane speaks English, month first', { options: { history: true, language: 'en' } }, async ($, on) => {
  const { commands, opened } = engine(on, 'claude-opus-5-5', limitsAt(50, 20), JAN_2)
  mock.store(on)
  await $.session.start(START)
  expect(opened).toEqual(['usage-limits-history:History'])
  expect(commands).toContain('limits-history')
  await $.session.measure(measureAt(60))
  await $.turn.complete(turn('t1', USAGE(1500, 300)))

  const ui = await $.ui.mount(PANE())
  expect(await ui.find({ type: 'Text', text: /^01\/02$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^60%$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^↓1\.5 k ↑300$/ })).toBeTruthy()
  await ui.unmount()
})

test('band and pane draw on every surface, at every width', { options: { history: true, language: 'en', resetFormat: 'clock' } }, async ($, on) => {
  engine(on, 'claude-opus-5-5', [...limitsAt(90, 20), { kind: 'spend_limit', percentUsed: 104 }], JAN_2)
  mock.store(on)
  await $.session.start(START)
  await $.session.measure(measureAt(60))
  await $.turn.complete(turn('t1', USAGE(1500, 300)))

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    for (const columns of [1, 20, 33, 50, 70, 100, 200]) {
      const bandUi = await $.ui.mount({ ...BAND, surface, props: { ...BAND.props, bodyColumns: columns } })
      expect(await bandUi.drawn()).toBeTruthy()
      await bandUi.unmount()
      const paneUi = await $.ui.mount({ ...PANE(columns), surface })
      expect(await paneUi.drawn()).toBeTruthy()
      await paneUi.unmount()
    }
  }
})

test('a narrow pane drops its bars, then keeps the figures',{ options: { history: true } }, async ($, on) => {
  engine(on, 'claude-opus-5-5', limitsAt(50, 20), JAN_2)
  mock.store(on)
  await $.session.start(START)
  await $.session.measure(measureAt(60))

  const ui = await $.ui.mount(PANE(30))
  expect(await ui.find({ type: 'Text', text: /^60 %$/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /━|╌/ })).toBeFalsy()
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
