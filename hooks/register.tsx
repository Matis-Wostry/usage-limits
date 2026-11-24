import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ContextFill, History, InUse, Limit, TokenCount } from '../types'
import { addPeaks, addTokens, dayKey, HISTORY_KEY, newestDays, readHistory } from './history'
import { SETTINGS_FR, STRINGS } from './strings'
import type { Verdict } from './strings'

const NO_TOKENS: TokenCount = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

const limitsAtom = atom({ plugin: 'usage-limits', key: 'limits' } as const, [] as Limit[])
const isHiddenAtom = atom({ plugin: 'usage-limits', key: 'isHidden' } as const, false)
const tickAtom = atom({ plugin: 'usage-limits', key: 'tick' } as const, 0)
const warnedAtom = atom({ plugin: 'usage-limits', key: 'warned' } as const, [] as string[])
const modelAtom = atom({ plugin: 'usage-limits', key: 'model' } as const, '')
const inUseAtom = atom({ plugin: 'usage-limits', key: 'inUse' } as const, null as InUse | null)
const lastTurnAtom = atom({ plugin: 'usage-limits', key: 'lastTurn' } as const, null as TokenCount | null)
const sessionTokensAtom = atom({ plugin: 'usage-limits', key: 'sessionTokens' } as const, NO_TOKENS)
const contextAtom = atom({ plugin: 'usage-limits', key: 'context' } as const, null as ContextFill | null)
const historyAtom = atom({ plugin: 'usage-limits', key: 'history' } as const, {} as History)

const HISTORY_PANE = 'usage-limits-history'
const CONFIG_PREFIX = 'usage-limits.'

// Length of each window, to know how far into it we are.
const WINDOW_MS: Record<string, number> = {
  five_hour: 5 * 3600_000,
  seven_day: 7 * 24 * 3600_000,
}

// The terminal's bar, one cell per step: used share, free share, and a tick where the clock stands.
const bar = (percent: number, elapsed: number | null, cells: number) => {
  const filled = Math.min(cells, Math.round((percent / 100) * cells))
  const tick = elapsed === null ? -1 : Math.min(cells - 1, Math.floor((elapsed / 100) * cells))
  return Array.from({ length: cells }, (_, i) => ({ isTick: i === tick, isFilled: i < filled }))
}

// One look per verdict: the accent colour (a raw colour, so the card keeps its tint
// on any theme) and the glyph drawn as the terminal's icon.
const VERDICTS: Record<Verdict, { accent: string; glyph: string }> = {
  push: { accent: '#2F7D57', glyph: '↑' },
  steady: { accent: '#2F6FDE', glyph: '=' },
  slow: { accent: '#B8570F', glyph: '↓' },
  limit: { accent: '#B3262B', glyph: '!' },
}

// A window per model (`seven_day_fable`, `seven_day_opus`...) is shown like the two known ones:
// its label is the model's name, and it keeps the length of the window it narrows.
const modelOf = (kind: string) => /^(?:five_hour|seven_day)_(.+)$/.exec(kind)?.[1]
const windowLength = (kind: string) =>
  WINDOW_MS[kind] ?? (kind.startsWith('five_hour_') ? WINDOW_MS.five_hour : kind.startsWith('seven_day_') ? WINDOW_MS.seven_day : undefined)
// The general window a kind narrows: `seven_day_fable` is a `seven_day`.
const baseOf = (kind: string) => /^(five_hour|seven_day)_/.exec(kind)?.[1] ?? kind

// A per-model window shows only while that model is selected (`/model fable`), and then
// takes the place of the general window it narrows: the Fable bar replaces the 7 j one.
const forModel = (limits: Limit[], model: string) => {
  const selected = model.toLowerCase()
  const isSelected = (l: Limit) => {
    const name = modelOf(l.kind)
    return name !== undefined && selected.includes(name.toLowerCase())
  }
  const narrowed = new Set(limits.filter(isSelected).map(l => baseOf(l.kind)))
  return limits.filter(l => (modelOf(l.kind) === undefined ? !narrowed.has(l.kind) : isSelected(l)))
}

// A model's id as `/model` names it: `claude-opus-5-5[1m]` reads « Opus 5.5 (1M) ».
// An id of another shape (an alias, a custom model) stays as it is.
const modelName = (id: string) => {
  const isWide = /\[1m\]$/i.test(id)
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/i.exec(id.replace(/\[1m\]$/i, ''))
  if (!match) return id
  const [, family = '', major = '', minor] = match
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ''}${isWide ? ' (1M)' : ''}`
}

// A window past its reset has started over, whatever the last reply reported.
const current = (l: Limit, now: number): Limit =>
  l.resetsAt && Date.parse(l.resetsAt) <= now ? { kind: l.kind, percentUsed: 0 } : l

const addTokenCounts = (a: TokenCount, b: TokenCount): TokenCount => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
})

const ICON_PATHS: Record<Verdict, string> = {
  push: '<path d="M14 20V9M9 13.5L14 8.5l5 5"/>',
  steady: '<path d="M9 11h10M9 17h10"/>',
  slow: '<path d="M14 8v11M9 14.5l5 5 5-5"/>',
  limit: '<path d="M14 8v8"/><circle cx="14" cy="20.2" r="0.6" fill="#fff"/>',
}

const iconSvg = (verdict: Verdict, tip: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">` +
  `<title>${tip}</title>` +
  `<circle cx="14" cy="14" r="14" fill="${VERDICTS[verdict].accent}"/>` +
  `<g stroke="#fff" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">` +
  ICON_PATHS[verdict] +
  `</g></svg>`

// The pixels a column of the band stands for where bars are drawn as Svg.
const PX_PER_COLUMN = 9

const childrenOf = (value: unknown): unknown[] =>
  Array.isArray(value) ? value.flatMap(childrenOf) : value === null || value === undefined || typeof value === 'boolean' ? [] : [value]

// Columns a tree takes on one row, as the band lays it out: a character a column, an Svg its
// pixels over PX_PER_COLUMN, a row's gaps, its side padding and border; a column Box as wide
// as its widest child, a Box no narrower than its minWidth.
const columnsOf = (node: unknown): number => {
  if (typeof node === 'string' || typeof node === 'number') return [...String(node)].length
  if (!node || typeof node !== 'object') return 0
  const { type, props, children } = node as { type?: unknown; props?: Record<string, unknown>; children?: unknown }
  const p = props ?? {}
  const kids = childrenOf(children ?? p.children)
  if (type === 'Svg') return Math.ceil(Number(p.width ?? 0) / PX_PER_COLUMN)
  if (type === 'Text') return kids.reduce<number>((sum, c) => sum + columnsOf(c), 0)
  const frame = 2 * Number(p.paddingX ?? 0) + (p.borderStyle ? 2 : 0)
  const widths = kids.map(columnsOf)
  const inner =
    p.flexDirection === 'column'
      ? Math.max(0, ...widths)
      : widths.reduce((sum, w) => sum + w, 0) + Number(p.gap ?? 0) * Math.max(0, kids.length - 1)
  return Math.max(Number(p.minWidth ?? 0), inner + frame)
}

// The SVG's height for a bar this thick: room for the tick above and below the track.
const barBoxHeight = (thickness: number) => Math.max(16, thickness + 6)

// A rounded track, the used share, and a tick where the clock stands in the window.
const barSvg = (percent: number, accent: string, elapsed: number | null, width: number, thickness: number, tip: string) => {
  const height = barBoxHeight(thickness)
  const top = (height - thickness) / 2
  const radius = thickness / 2
  const used = Math.max(0, Math.min(100, percent)) * (width / 100)
  const tick =
    elapsed === null
      ? ''
      : `<rect x="${Math.max(0, Math.min(width - 2.5, (elapsed / 100) * width - 1.25)).toFixed(1)}" y="1" width="2.5" height="${height - 2}" rx="1" fill="#262626" stroke="#fff" stroke-opacity="0.55" stroke-width="0.6"/>`

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<title>${tip}</title>` +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="transparent"/>` +
    `<rect x="0" y="${top}" width="${width}" height="${thickness}" rx="${radius}" fill="${accent}" fill-opacity="0.2"/>` +
    `<rect x="0" y="${top}" width="${Math.max(used, used > 0 ? thickness : 0).toFixed(1)}" height="${thickness}" rx="${radius}" fill="${accent}"/>` +
    tick +
    `</svg>`
  )
}

// One change to the history at a time: each reads the store again, so two sessions
// open side by side add up, and a failed write never gets in the way of a turn.
let historyWrites: Promise<void> = Promise.resolve()
const recordHistory = ($: EngineInterface, change: (history: History, day: string) => History) => {
  historyWrites = historyWrites
    .then(async () => {
      const now = await $.clock.now()
      const history = change(readHistory(await $.store.get(HISTORY_KEY)), dayKey(now))
      await $.store.set(HISTORY_KEY, history)
      await update($, historyAtom, () => history)
    })
    .catch(() => undefined)
  return historyWrites
}

export const register: Register = (on, options) => {
  const language = options.language === 'en' ? 'en' : 'fr'
  const t = STRINGS[language]
  const windows = String(options.windows)
  const warnAt = Number(options.warnAt)
  const cautionAt = Number(options.cautionAt)
  const paceMargin = Number(options.paceMargin)
  const showDelta = options.showDelta === true
  const showReset = options.showReset === true
  const resetAsClock = options.resetFormat === 'clock'
  const showForecast = options.showForecast !== false
  const showPaceMark = options.showPaceMark !== false
  const isCompact = options.isCompact === true
  const layout = String(options.layout)
  const showTokens = options.showTokens !== false
  const modelPosition = (['reset', 'tokens', 'main', 'line', 'off'] as const).find(p => p === options.modelPosition) ?? 'reset'
  const hasHistory = options.history === true
  const barHeight = Math.max(2, Math.min(20, Number(options.barHeight) || 6))
  const rawPadding = Number(options.bandPadding)
  const bandPadding = Number.isFinite(rawPadding) ? Math.max(0, Math.min(3, Math.round(rawPadding))) : 1

  const percentOf = (value: number) => t.percent(Math.round(value))

  const labelOf = (kind: string) => {
    const model = modelOf(kind)
    return t.labels[kind] ?? (model ? model.charAt(0).toUpperCase() + model.slice(1).replace(/_/g, ' ') : kind)
  }

  // Token counts in the language's way: 950, 2 k, 1,5 k, 12 k, 1,25 M (no trailing zeros).
  const fmtTokens = (n: number) => {
    const short = (value: number, digits: number) => String(Number(value.toFixed(digits))).replace('.', t.decimal)
    if (n < 1000) return String(n)
    // From 999 500 the thousands would round to « 1000 k ».
    if (n < 999_500) return `${short(n / 1000, n < 10_000 ? 1 : 0)} k`
    return `${short(n / 1_000_000, n < 10_000_000 ? 2 : 1)} M`
  }

  const fmtMinutes = (minutes: number) => {
    if (minutes < 60) return `${minutes} min`
    const hours = Math.floor(minutes / 60)
    return hours < 24 ? `${hours} h ${String(minutes % 60).padStart(2, '0')}` : `${Math.floor(hours / 24)} ${t.dayUnit} ${hours % 24} h`
  }

  const timeLeft = (iso: string, now: number) => fmtMinutes(Math.max(0, Math.round((Date.parse(iso) - now) / 60000)))

  // The reset's time on the person's clock, with the weekday when it isn't today.
  const clockAt = (iso: string, now: number) => {
    const at = new Date(iso)
    const time = `${t.at} ${t.clock(at.getHours(), String(at.getMinutes()).padStart(2, '0'))}`
    return at.toDateString() === new Date(now).toDateString() ? time : `${t.weekdays[at.getDay()]} ${time}`
  }

  // As the reset line writes it: « 1 h 15 » or « à 18 h 40 ».
  const resetShort = (iso: string, now: number) => (resetAsClock ? clockAt(iso, now) : timeLeft(iso, now))
  // As a sentence writes it: « reset dans 1 h 15 » or « reset à 18 h 40 ».
  const resetPhrase = (iso: string, now: number) =>
    `${t.resets} ${resetAsClock ? clockAt(iso, now) : `${t.inWord} ${timeLeft(iso, now)}`}`

  // A bar's colour follows its own usage: red, then orange. Under both it takes the
  // verdict's, or the calm blue when the verdict is another window's limit.
  const accentFor = (percent: number, verdict: Verdict) => {
    if (percent >= warnAt) return VERDICTS.limit.accent
    if (percent >= cautionAt) return VERDICTS.slow.accent
    return VERDICTS[verdict === 'limit' ? 'steady' : verdict].accent
  }

  const isShown = (l: Limit) => windows === 'both' || baseOf(l.kind) === windows || !windowLength(l.kind)

  // Compares what is used with the share of the window already elapsed.
  // Positive delta: usage is behind the clock, so there is room to push.
  const pace = (l: Limit, now: number) => {
    const length = windowLength(l.kind)
    if (!length || !l.resetsAt) return null

    const left = Math.min(length, Math.max(0, Date.parse(l.resetsAt) - now))
    const elapsed = (1 - left / length) * 100
    const delta = Math.round(elapsed - l.percentUsed)

    if (delta > paceMargin) return { glyph: '↑', delta, elapsed }
    if (delta < -paceMargin) return { glyph: '↓', delta, elapsed }
    return { glyph: '→', delta, elapsed }
  }

  // Minutes before the window fills up if usage keeps its pace, when that comes before the
  // reset. Nothing in the window's first tenth, when one big request would skew the pace.
  const minutesToLimit = (l: Limit, now: number) => {
    const length = windowLength(l.kind)
    if (!length || !l.resetsAt || l.percentUsed <= 0 || l.percentUsed >= 100) return null

    const left = Math.min(length, Math.max(0, Date.parse(l.resetsAt) - now))
    const elapsed = length - left
    if (elapsed < length * 0.1) return null

    const toLimit = ((100 - l.percentUsed) / l.percentUsed) * elapsed
    return toLimit < left ? Math.round(toLimit / 60000) : null
  }

  const forecastLine = (limits: Limit[], now: number) => {
    if (!showForecast) return ''
    const parts = limits.flatMap(l => {
      const minutes = minutesToLimit(l, now)
      return minutes === null ? [] : [t.forecastLimit(labelOf(l.kind), fmtMinutes(minutes))]
    })
    return parts.length > 0 ? t.forecast + parts.join(' · ') : ''
  }

  // Close to a limit always wins. Otherwise the 5-hour window sets the verdict; the
  // weekly one only breaks a tie (5 h on pace) or tempers a push (weekly behind the clock).
  const verdictOf = (limits: Limit[], now: number): Verdict => {
    if (limits.some(l => l.percentUsed >= warnAt)) return 'limit'

    const verdictFor = (delta: number): Verdict =>
      delta < -paceMargin ? 'slow' : delta > paceMargin ? 'push' : 'steady'

    // A model's window (Fable's) stands in for the general one it replaced.
    const session = limits.find(l => baseOf(l.kind) === 'five_hour')
    const week = limits.find(l => baseOf(l.kind) === 'seven_day')
    const sessionPace = session ? pace(session, now) : null
    const weekPace = week ? pace(week, now) : null

    if (!sessionPace) return weekPace ? verdictFor(weekPace.delta) : 'steady'

    const main = verdictFor(sessionPace.delta)
    if (main === 'steady' && weekPace) return verdictFor(weekPace.delta)
    if (main === 'push' && weekPace && verdictFor(weekPace.delta) === 'slow') return 'steady'
    return main
  }

  on('session.measure', async ($, e, next) => {
    await update($, limitsAtom, () => [...e.rateLimits])
    await update($, contextAtom, () => ({ tokens: e.context.tokens, window: e.context.window, percent: e.context.percent }))

    // Kept in the session's state: changing a setting reloads the module, and must not toast again.
    const model = await read($, modelAtom)
    const warned = await read($, warnedAtom)
    const reached = forModel(e.rateLimits, model)
      .filter(isShown)
      .filter(l => l.percentUsed >= warnAt && !warned.includes(`${l.kind}:${l.resetsAt ?? ''}`))
    for (const l of reached) {
      $.ui.toast(t.toast(labelOf(l.kind), percentOf(l.percentUsed)))
    }
    if (reached.length > 0) {
      await update($, warnedAtom, () => [...warned, ...reached.map(l => `${l.kind}:${l.resetsAt ?? ''}`)])
    }

    if (hasHistory && e.rateLimits.length > 0) {
      await recordHistory($, (history, day) => addPeaks(history, day, e.rateLimits))
    }

    return next(e)
  })

  on('session.start', async ($, e, next) => {
    $.ui.status(undefined)
    // The menu caches its labels, and the language may just have changed.
    $.ui.invalidate('config.describe')
    // Time passes between replies: this write redraws the band, its tick and its time left.
    $.clock.every(60_000, () => {
      void update($, tickAtom, count => (count ?? 0) + 1)
    })
    await $.command.register({ name: t.commands.show, description: t.commandHelp.show })
    await $.command.register({ name: t.commands.hide, description: t.commandHelp.hide })
    await $.command.register({
      name: 'usage-limits-config',
      description: t.commandHelp.config,
      argumentHint: t.configHint,
    })
    if (hasHistory) {
      await $.command.register({ name: t.commands.history, description: t.commandHelp.history })
      const stored = readHistory(await $.store.get(HISTORY_KEY))
      await update($, historyAtom, () => stored)
      void $.ui.open({ id: HISTORY_PANE, title: t.historyTitle }).catch(() => undefined)
    } else {
      // The option was just turned off: the pane goes with it. What was recorded stays.
      void $.ui.close({ id: HISTORY_PANE }).catch(() => undefined)
    }
    const { rateLimits, context } = await $.session.usage()
    await update($, limitsAtom, () => [...rateLimits])
    await update($, contextAtom, () => ({ tokens: context.tokens, window: context.window, percent: context.percent }))
    const model = await $.session.model()
    await update($, modelAtom, () => model)
    return next(e)
  })

  // The selected model decides whether a model's window (Fable's) replaces the 7 j bar:
  // read again at each turn of the main loop, so a `/model` shows from the next prompt.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const model = await $.session.model()
      await update($, modelAtom, () => model)
    }
    return next(e)
  })

  // No call reads the effort: each request of the main loop says which model and effort it
  // goes out with, so an `/effort` or a fallback model shows from the next request.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const inUse: InUse = { model: e.model, effort: e.effort === undefined ? null : String(e.effort) }
      await update($, inUseAtom, () => inUse)
    }
    return yield* next(e)
  })

  // Every turn adds to the session's totals, subagents' too; the main loop's is the last turn.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const u = e.usage
    if (u) {
      const turn: TokenCount = {
        input: u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens,
        output: u.output_tokens,
        cacheRead: u.cache_read_input_tokens,
        cacheWrite: u.cache_creation_input_tokens,
      }
      await update($, sessionTokensAtom, total => addTokenCounts(total ?? NO_TOKENS, turn))
      if (e.agentId === undefined) await update($, lastTurnAtom, () => turn)
      if (hasHistory) {
        await recordHistory($, (history, day) => addTokens(history, day, turn.input - turn.cacheRead, turn.output))
      }
    }
    return result
  })

  // `/clear` and `/resume` leave this conversation: so do the counts. No `session.start`
  // follows them, and the context's fill comes back with the next reply.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      await update($, sessionTokensAtom, () => NO_TOKENS)
      await update($, lastTurnAtom, () => null)
      await update($, contextAtom, () => null)
    }
    return next(e)
  })

  // The manifest's labels are English: in French, the /config menu reads from our table.
  if (language === 'fr') {
    on('config.describe', async ($, e, next) => {
      const field = e.key.startsWith(CONFIG_PREFIX) ? SETTINGS_FR[e.key.slice(CONFIG_PREFIX.length)] : undefined
      return next(field ? { ...e, ...field } : e)
    })
  }

  // The mod's own settings, apart from /config: no argument lists them, `name=value` changes one.
  on('command.run', { command: 'usage-limits-config' }, async ($, e) => {
    const rows = (await $.config.list()).filter(r => r.key.startsWith(CONFIG_PREFIX))
    const describe = (r: (typeof rows)[number]) =>
      `${r.key.slice(CONFIG_PREFIX.length)} = ${String(r.value)}${r.options ? ` (${r.options.join(' | ')})` : ''}`
    const args = e.args.trim()

    if (!args) {
      return { text: [t.configHeader, ...rows.map(describe)].join('\n') }
    }

    const at = args.indexOf('=')
    const name = (at < 0 ? args : args.slice(0, at)).trim()
    const raw = at < 0 ? '' : args.slice(at + 1).trim()
    const row = rows.find(r => r.key === CONFIG_PREFIX + name)
    if (!row) return { text: `${t.configUnknown(name)}\n${rows.map(describe).join('\n')}` }
    if (at < 0) return { text: describe(row) }

    let value: boolean | number | string = raw
    if (row.kind === 'boolean') {
      if (/^(true|on|oui|yes|1)$/i.test(raw)) value = true
      else if (/^(false|off|non|no|0)$/i.test(raw)) value = false
      else return { text: t.configBoolean(name) }
    } else if (row.kind === 'number') {
      value = Number(raw)
      if (raw === '' || !Number.isFinite(value)) return { text: t.configNumber(name) }
    } else if (row.options && !row.options.includes(raw)) {
      return { text: t.configChoice(name, row.options.join(' | ')) }
    }

    const result = await $.config.set({ key: row.key, value })
    return { text: result.deny ? t.configDenied(result.deny) : `${name} = ${String(value)}` }
  })

  on('command.run', { command: t.commands.hide }, async $ => {
    await update($, isHiddenAtom, () => true)
    return { text: t.hidden }
  })

  on('command.run', { command: t.commands.show }, async $ => {
    await update($, isHiddenAtom, () => false)
    let limits = await read($, limitsAtom)
    if (limits.length === 0) {
      // Nothing measured yet in this session: ask the engine for the current windows.
      limits = [...(await $.session.usage()).rateLimits]
      await update($, limitsAtom, () => limits)
    }
    const now = await $.clock.now()

    if (limits.length === 0) {
      return { text: t.noFigures }
    }

    const live = limits.map(l => current(l, now))
    const lines = live.map(l => {
      const p = pace(l, now)
      const reset = l.resetsAt ? `, ${resetPhrase(l.resetsAt, now)}` : ''
      const gap = p ? ` (${t.vsTime(`${p.delta >= 0 ? '+' : ''}${p.delta}`, p.glyph)})` : ''
      return `${labelOf(l.kind)} (${l.kind})${t.colon}${percentOf(l.percentUsed)}${reset}${gap}`
    })
    const forecast = forecastLine(live, now)

    const model = await read($, modelAtom)
    const effort = (await read($, inUseAtom))?.effort ?? null
    const last = await read($, lastTurnAtom)
    const total = await read($, sessionTokensAtom)
    const context = await read($, contextAtom)
    const shown = forModel(limits, model).map(l => labelOf(l.kind)).join(', ')
    const cached = (c: TokenCount) => (c.cacheRead || c.cacheWrite ? ` (${t.cached(fmtTokens(c.cacheRead), fmtTokens(c.cacheWrite))})` : '')
    const tokenLines = [
      ...(model ? [t.model(model, effort, shown)] : []),
      ...(last ? [`${t.lastTurn}${t.colon}${t.input} ${fmtTokens(last.input)}${cached(last)}, ${t.output} ${fmtTokens(last.output)}`] : []),
      `${t.session}${t.colon}${t.input} ${fmtTokens(total.input)}${cached(total)}, ${t.output} ${fmtTokens(total.output)}`,
      ...(context?.tokens !== undefined ? [`${t.context}${t.colon}${fmtTokens(context.tokens)} / ${fmtTokens(context.window)} (${t.percent(context.percent ?? 0)})`] : []),
    ]

    return { text: [...lines, ...(forecast ? [forecast] : []), '', ...tokenLines].join('\n') }
  })

  // The line under the band: the last turn, the session's totals, the context fill.
  // Short form for the narrow layouts, where every column counts.
  const tokenParts = (last: TokenCount | null, total: TokenCount, context: ContextFill | null, isShort: boolean) => {
    if (!last && total.input === 0 && context?.tokens === undefined) return []
    const parts: string[] = []
    if (isShort) {
      if (last) parts.push(`${t.turnShort} ↓${fmtTokens(last.input)} ↑${fmtTokens(last.output)}`)
      parts.push(`${t.session} ↓${fmtTokens(total.input)} ↑${fmtTokens(total.output)}`)
      if (context?.percent !== undefined) parts.push(`${t.contextShort} ${t.percent(context.percent)}`)
    } else {
      if (last) parts.push(`${t.lastTurn}${t.colon}${t.input} ${fmtTokens(last.input)}, ${t.output} ${fmtTokens(last.output)}`)
      parts.push(`${t.session}${t.colon}${t.input} ${fmtTokens(total.input)}, ${t.output} ${fmtTokens(total.output)}`)
      if (context?.tokens !== undefined) parts.push(`${t.context}${t.colon}${fmtTokens(context.tokens)} / ${fmtTokens(context.window)} (${t.percent(context.percent ?? 0)})`)
    }
    return parts
  }

  // Wide: everything on one row. Medium: shorter bars. Narrow: icon and the bars on one row. Tiny: no icon, the bars one above the other.
  // Columns are what the band's column offers: they set the richest layout the band may take,
  // and it takes a more compact one while its row does not fit. `layout` forces one when it misjudges.
  type Mode = 'wide' | 'medium' | 'narrow' | 'tiny'
  const MODES: readonly Mode[] = ['wide', 'medium', 'narrow', 'tiny']
  const isForced = layout === 'wide' || layout === 'medium' || layout === 'narrow'
  const modeFor = (columns: number): Mode => {
    if (isForced) return layout
    return columns >= 100 ? 'wide' : columns >= 70 ? 'medium' : columns > 32 ? 'narrow' : 'tiny'
  }

  // The first form whose every line fits, else the last resort, which wraps.
  const firstFitting = (forms: string[][], fits: (text: string) => boolean, fallback: string[]) =>
    forms.find(lines => lines.every(fits)) ?? fallback

  const tipFor = (l: Limit, p: ReturnType<typeof pace>, now: number) => {
    const parts = [t.tipUsed(labelOf(l.kind), percentOf(l.percentUsed))]
    if (p) parts.push(t.tipElapsed(percentOf(p.elapsed)))
    if (l.resetsAt) parts.push(resetPhrase(l.resetsAt, now))
    return parts.join(' · ')
  }

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Read so that the minute's tick redraws this band.
    await read($, tickAtom)
    const now = await $.clock.now()
    const model = await read($, modelAtom)
    const limits = forModel(await read($, limitsAtom), model).filter(isShown).map(l => current(l, now))

    if (e.props.hasSurvey || limits.length === 0 || (await read($, isHiddenAtom))) {
      return next(e)
    }

    // Some surfaces give no width: then keep the single-row layout of 0.9.5, and never
    // write the atom (a write while drawing would redraw again).
    const columns: unknown = e.props.bodyColumns
    const hasWidth = typeof columns === 'number' && Number.isFinite(columns) && columns > 0
    const ceiling: Mode = hasWidth ? modeFor(columns) : layout === 'medium' || layout === 'narrow' ? layout : 'wide'

    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    // The terminal has no Svg: it keeps a text icon and the line bar, with no tinted card
    // (a terminal fills any background solid, which hides the coloured text).
    const isTerminal = e.surface === 'terminal'
    // Each Svg needs a non-empty `alt`: the desktop app draws nothing for an empty one.
    const Svg = !isTerminal && 'Svg' in ui ? ui.Svg : null

    const verdict = verdictOf(limits, now)
    const { accent, glyph } = VERDICTS[verdict]
    const label = t.verdicts[verdict]

    const resets = limits
      .map(l => (l.resetsAt ? `${t.resetNames[l.kind] ?? labelOf(l.kind).toLowerCase()} ${resetShort(l.resetsAt, now)}` : ''))
      .filter(Boolean)
      .join(' · ')
    const forecast = forecastLine(limits, now)

    // The model of the last request, or the selected one before any request; its effort
    // once a request has said it. « Opus 5.5 · effort high », or « Opus 5.5 · high » for short.
    const inUse = await read($, inUseAtom)
    const name = modelName(inUse?.model || model)
    const effort = inUse?.effort ?? null
    const modelShort = name ? [name, ...(effort ? [effort] : [])].join(' · ') : ''
    const modelFull = name ? [name, ...(effort ? [`${t.effort} ${effort}`] : [])].join(' · ') : ''

    // A long prompt leaves the band few rows (maxRows): a taller tree would scroll or be cut.
    const hasRoom = typeof e.props.maxRows === 'number' && Number.isFinite(e.props.maxRows)
    const rows = hasRoom ? e.props.maxRows : Infinity

    // One layout of the card: its mode, its bars (cells on the terminal, pixels elsewhere),
    // and whether the model sits beside the verdict.
    type Layout = { mode: Mode; cells: number; barWidth: number; withModel: boolean }
    const longestLabel = Math.max(...limits.map(l => labelOf(l.kind).length))
    // Stacked bars take what their row leaves: the label, two gaps, the percentage's five
    // columns, the gap to the delta and its four, the padding and the border.
    const stackedRoom = hasWidth ? columns - longestLabel - 13 - (showDelta ? 5 : 0) : 8
    const pxFor = (mode: Mode) => {
      if (mode === 'wide') return 120
      if (mode === 'medium') return 84
      if (!hasWidth) return 150
      if (mode === 'tiny') return Math.max(40, Math.min(400, stackedRoom * PX_PER_COLUMN))
      const fit = Math.max(40, Math.min(400, Math.floor((columns - 9 - limits.length * 7) / limits.length) * PX_PER_COLUMN))
      // From 50 to 69 columns the narrow bars keep at most 65 % of the room they could take.
      return columns <= 69 && columns >= 50 ? Math.round(fit * 0.65) : fit
    }
    // The terminal's bars, longest first: narrow ones shorten before the bars stack.
    const cellsFor = (mode: Mode) =>
      mode === 'wide' ? [24] : mode === 'medium' ? [16] : mode === 'narrow' ? [8, 6, 4] : [Math.max(4, Math.min(16, stackedRoom))]
    const isBesideVerdict = (mode: Mode) => mode === 'wide' || mode === 'medium'
    const layoutsOf = (modes: readonly Mode[], withModel: boolean): Layout[] =>
      modes.flatMap(mode => (Svg ? [0] : cellsFor(mode)).map(cells => ({ mode, cells, barWidth: pxFor(mode), withModel })))

    // Beside the verdict the model stays while a layout keeps it on the row; then the
    // richest layout without it, the model going to a line of its own.
    const wantsMain = modelPosition === 'main' && modelShort !== ''
    const richest = MODES.slice(MODES.indexOf(ceiling))
    const candidates =
      hasWidth && !isForced
        ? [...(wantsMain ? layoutsOf(richest.filter(isBesideVerdict), true) : []), ...layoutsOf(richest, false)]
        : layoutsOf([ceiling], wantsMain && isBesideVerdict(ceiling)).slice(0, 1)

    const cardFor = ({ mode, cells: cellCount, barWidth, withModel }: Layout) => {
      const isTiny = mode === 'tiny'
      const isStacked = mode === 'narrow' || isTiny
      const contentRows = isTiny ? limits.length : 1
      const hasPadding = bandPadding > 0 && rows >= contentRows + 2 + bandPadding * 2
      const hasBorder = rows >= contentRows + 2

      return (
        <Box
          gap={isTiny && isTerminal ? 0 : isStacked ? 2 : 3}
          flexDirection={isTiny ? 'column' : 'row'}
          paddingX={2}
          paddingY={hasPadding ? bandPadding : 0}
          alignItems="center"
          borderStyle={hasBorder ? 'round' : undefined}
          borderColor={Svg ? `${accent}40` : accent}
          backgroundColor={Svg ? `${accent}1F` : undefined}
        >
          {isTiny ? null : <Box gap={2} alignItems="center">
            {Svg ? (
              <Svg source={iconSvg(verdict, label)} alt={label} width={28} height={28} isInteractive />
            ) : (
              <Text color={accent} bold>{glyph}</Text>
            )}
            {isStacked ? null : <Text weight="semibold" color={Svg ? undefined : accent}>{label}</Text>}
            {withModel ? <Text dimColor size="footnote">{modelShort}</Text> : null}
          </Box>}
          {isTiny ? null : <Box flexGrow={1} />}
          {limits.map(l => {
            const p = pace(l, now)
            const markAt = showPaceMark && p ? p.elapsed : null
            const cells = Svg ? [] : bar(l.percentUsed, markAt, cellCount)
            const barAccent = accentFor(l.percentUsed, verdict)

            return (
              <Box key={l.kind} gap={isStacked ? 1 : 2} alignItems="center" justifyContent={isTiny ? 'space-between' : 'flex-start'}>
                <Text dimColor size="footnote">{labelOf(l.kind)}</Text>
                {isCompact ? null : Svg ? (
                  <Svg
                    source={barSvg(l.percentUsed, barAccent, markAt, barWidth, barHeight, tipFor(l, p, now))}
                    alt={`${labelOf(l.kind)}${t.colon}${percentOf(l.percentUsed)}`}
                    isInteractive
                    width={barWidth}
                    height={barBoxHeight(barHeight)}
                  />
                ) : (
                  <Text>
                    {cells.map((c, i) => (
                      <Text key={String(i)} color={c.isTick ? undefined : c.isFilled ? barAccent : 'subtle'} bold={c.isTick}>
                        {c.isTick ? '┃' : c.isFilled ? '━' : '╌'}
                      </Text>
                    ))}
                  </Text>
                )}
                {isStacked ? <Box minWidth={5} justifyContent="flex-end"><Text weight="bold" color={isTerminal ? barAccent : undefined}>{percentOf(l.percentUsed)}</Text></Box> : <Text weight="bold" color={isTerminal ? barAccent : undefined}>{percentOf(l.percentUsed)}</Text>}
                {p && showDelta ? <Text color={barAccent} size="footnote">{p.delta >= 0 ? '+' : ''}{p.delta}</Text> : null}
              </Box>
            )
          })}
        </Box>
      )
    }

    // The first layout whose row fits the band, else the most compact.
    const fitsRow = (l: Layout) => !hasWidth || columnsOf(cardFor(l)) <= columns
    const chosen = candidates.find(fitsRow) ?? (candidates[candidates.length - 1] as Layout)
    const card = cardFor(chosen)
    const contentRows = chosen.mode === 'tiny' ? limits.length : 1
    if (rows < contentRows) {
      return next(e)
    }
    const modelAt = modelPosition === 'main' ? (chosen.withModel ? 'main' : 'line') : modelPosition

    // Each line takes the richest form that keeps to one row; with none, the shortest, which wraps.
    // A line wider than the band, less its side padding, wraps and takes more rows.
    const lineColumns = hasWidth ? Math.max(1, columns - 4) : Infinity
    const fits = (text: string) => text.length <= lineColumns
    const rowsOf = (text: string) => Math.max(1, Math.ceil(text.length / lineColumns))
    const joined = (...parts: string[]) => parts.filter(Boolean).join(' · ')

    // The model heads the reset line; too long, it drops the word « effort », then takes a
    // line of its own above the resets, where both then fit.
    const resetText = showReset && resets !== '' ? `${t.resetLine}${resets}` : ''
    const resetShortForm = [joined(modelShort, resetText)]
    const resetLines =
      modelAt === 'reset' && name
        ? firstFitting([[joined(modelFull, resetText)], resetShortForm, ...(resetText ? [[modelShort, resetText]] : [])], fits, resetShortForm)
        : resetText ? [resetText] : []

    const [last, total, context] = [await read($, lastTurnAtom), await read($, sessionTokensAtom), await read($, contextAtom)]
    const tokensLong = showTokens ? tokenParts(last, total, context, false).join(' · ') : ''
    const tokensShort = showTokens ? tokenParts(last, total, context, true).join(' · ') : ''
    const leadFull = modelAt === 'tokens' ? modelFull : ''
    const leadShort = modelAt === 'tokens' ? modelShort : ''
    // The same at the head of the tokens line, the totals going short before the model splits off.
    const tokensShortForm = [joined(leadShort, tokensShort)]
    const tokenLines = firstFitting(
      [
        [joined(leadFull, tokensLong)],
        [joined(leadShort, tokensLong)],
        tokensShortForm,
        ...(leadShort && tokensShort ? [[leadShort, tokensShort]] : []),
      ],
      fits,
      tokensShortForm,
    ).filter(Boolean)

    const modelLong = name ? t.modelLine(name, effort) : ''
    const modelText = modelAt === 'line' && name ? (fits(modelLong) ? modelLong : modelShort) : ''

    // Drop the extras one by one (model line, tokens line, reset line, forecast), then the
    // vertical padding and the border, then hide.
    const fullCard = contentRows + 2 + bandPadding * 2
    const hasForecastLine = forecast !== '' && rows >= fullCard + rowsOf(forecast)
    const forecastRows = hasForecastLine ? rowsOf(forecast) : 0
    const resetRows = resetLines.reduce((sum, line) => sum + rowsOf(line), 0)
    const hasResetLine = resetLines.length > 0 && rows >= fullCard + forecastRows + resetRows
    const shownResetRows = hasResetLine ? resetRows : 0
    const allTokenRows = tokenLines.reduce((sum, line) => sum + rowsOf(line), 0)
    const hasTokenLine = tokenLines.length > 0 && rows >= fullCard + forecastRows + shownResetRows + allTokenRows
    const tokenRows = hasTokenLine ? allTokenRows : 0
    const hasModelLine = modelText !== '' && rows >= fullCard + forecastRows + shownResetRows + tokenRows + rowsOf(modelText)

    return (
      <Box flexDirection="column" gap={0} alignItems="stretch">
        {card}
        {hasModelLine ? (
          <Box paddingX={2}>
            <Text dimColor size="footnote">{modelText}</Text>
          </Box>
        ) : null}
        {hasForecastLine ? (
          <Box paddingX={2}>
            <Text color={VERDICTS.slow.accent} size="footnote">{forecast}</Text>
          </Box>
        ) : null}
        {hasResetLine
          ? resetLines.map((line, i) => (
              <Box key={`reset-${i}`} paddingX={2}>
                <Text dimColor size="footnote">{line}</Text>
              </Box>
            ))
          : null}
        {hasTokenLine
          ? tokenLines.map((line, i) => (
              <Box key={`tokens-${i}`} paddingX={2}>
                <Text dimColor size="footnote">{line}</Text>
              </Box>
            ))
          : null}
      </Box>
    )
  })

  if (hasHistory) {
    on('command.run', { command: t.commands.history }, async $ => {
      await $.ui.open({ id: HISTORY_PANE, title: t.historyTitle })
      return { text: t.historyOpened }
    })

    // A row per day, newest first: each limit's peak and the day's tokens. A bar for the
    // limits only where the pane has the room; the figures stay at any width.
    on('ui.render', { component: 'Pane', requestId: HISTORY_PANE }, async ($, e) => {
      const { Box, Text } = $.ui.resolve(e)
      const history = await read($, historyAtom)
      const columns = e.props.bodyColumns
      const cells = columns >= 70 ? 8 : columns >= 50 ? 4 : 0
      const room = Math.max(1, (e.viewport?.rows ?? 24) - 3)
      const days = newestDays(history, room)

      if (days.length === 0) {
        return <Text dimColor>{t.historyEmpty}</Text>
      }

      return (
        <Box flexDirection="column" gap={0}>
          <Text dimColor size="footnote">{t.historyHint}</Text>
          {days.map(({ key, day }) => {
            const [, month = '', date = ''] = key.split('-')
            return (
              <Box key={key} gap={2} alignItems="center">
                <Text bold>{t.historyDate(date, month)}</Text>
                {Object.entries(day.peaks).map(([kind, peak]) => (
                  <Box key={kind} gap={1} alignItems="center">
                    <Text dimColor size="footnote">{labelOf(kind)}</Text>
                    {cells > 0 ? (
                      <Text color={accentFor(peak, 'steady')}>
                        {'━'.repeat(Math.min(cells, Math.round((peak / 100) * cells)))}
                        {'╌'.repeat(Math.max(0, cells - Math.round((peak / 100) * cells)))}
                      </Text>
                    ) : null}
                    <Text>{percentOf(peak)}</Text>
                  </Box>
                ))}
                {columns >= 50 ? <Text dimColor size="footnote">{`↓${fmtTokens(day.input)} ↑${fmtTokens(day.output)}`}</Text> : null}
              </Box>
            )
          })}
        </Box>
      )
    })
  }
}
