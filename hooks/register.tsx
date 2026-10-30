import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { ContextFill, Limit, TokenCount } from '../types'

const NO_TOKENS: TokenCount = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

const limitsAtom = atom({ plugin: 'usage-limits', key: 'limits' } as const, [] as Limit[])
const isHiddenAtom = atom({ plugin: 'usage-limits', key: 'isHidden' } as const, false)
const widthAtom = atom({ plugin: 'usage-limits', key: 'width' } as const, 0)
const modelAtom = atom({ plugin: 'usage-limits', key: 'model' } as const, '')
const lastTurnAtom = atom({ plugin: 'usage-limits', key: 'lastTurn' } as const, null as TokenCount | null)
const sessionTokensAtom = atom({ plugin: 'usage-limits', key: 'sessionTokens' } as const, NO_TOKENS)
const contextAtom = atom({ plugin: 'usage-limits', key: 'context' } as const, null as ContextFill | null)

const LABELS: Record<string, string> = {
  five_hour: '5 h',
  seven_day: '7 j',
  spend_limit: 'Budget',
}

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

type Verdict = 'push' | 'steady' | 'slow' | 'limit'

// One look per verdict: the accent colour (a raw colour, so the card keeps its tint
// on any theme) and the word, the glyph drawn in the icon and the terminal fallback.
const VERDICTS: Record<Verdict, { label: string; accent: string; glyph: string }> = {
  push: { label: 'Pousser', accent: '#2F7D57', glyph: '↑' },
  steady: { label: 'Rythme normal', accent: '#2F6FDE', glyph: '=' },
  slow: { label: 'Ralentir', accent: '#B8570F', glyph: '↓' },
  limit: { label: 'Limite proche', accent: '#B3262B', glyph: '!' },
}

const ADVICE: Record<Verdict, string> = {
  push: 'Vous avez de la marge : lancez une grosse tâche.',
  steady: 'Vous êtes dans le rythme : continuez normalement.',
  slow: 'Vous consommez plus vite que le temps : ralentissez un peu.',
  limit: 'Limite proche : gardez le reste pour l’essentiel.',
}

const RESET_NAMES: Record<string, string> = {
  five_hour: 'session',
  seven_day: 'semaine',
  spend_limit: 'budget',
}

// A window per model (`seven_day_fable`, `seven_day_opus`...) is shown like the two known ones:
// its label is the model's name, and it keeps the length of the window it narrows.
const modelOf = (kind: string) => /^(?:five_hour|seven_day)_(.+)$/.exec(kind)?.[1]
const labelOf = (kind: string) => {
  const model = modelOf(kind)
  return LABELS[kind] ?? (model ? model.charAt(0).toUpperCase() + model.slice(1).replace(/_/g, ' ') : kind)
}
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

// Token counts the French way: 950, 2 k, 12,3 k, 1,25 M (no trailing zeros).
const fmtTokens = (n: number) => {
  const short = (value: number, digits: number) => String(Number(value.toFixed(digits))).replace('.', ',')
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${short(n / 1000, n < 10_000 ? 1 : 0)} k`
  return `${short(n / 1_000_000, n < 10_000_000 ? 2 : 1)} M`
}

const addTokens = (a: TokenCount, b: TokenCount): TokenCount => ({
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

const resetIn = (iso: string | undefined, now: number) => {
  if (!iso) return ''
  const minutes = Math.max(0, Math.round((Date.parse(iso) - now) / 60000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours} h ${String(minutes % 60).padStart(2, '0')}` : `${Math.floor(hours / 24)} j ${hours % 24} h`
}

export const register: Register = (on, options) => {
  const windows = String(options.windows)
  const warnAt = Number(options.warnAt)
  const cautionAt = Number(options.cautionAt)
  const paceMargin = Number(options.paceMargin)
  const showDelta = options.showDelta === true
  const showReset = options.showReset === true
  const showPaceMark = options.showPaceMark !== false
  const isCompact = options.isCompact === true
  const layout = String(options.layout)
  const showTokens = options.showTokens !== false
  const barHeight = Math.max(2, Math.min(20, Number(options.barHeight) || 6))
  const rawPadding = Number(options.bandPadding)
  const bandPadding = Number.isFinite(rawPadding) ? Math.max(0, Math.min(3, Math.round(rawPadding))) : 1

  const warned = new Set<string>()

  // Theme keys follow the user's theme: calm, then caution, then alert.
  const colorFor = (percent: number) =>
    percent >= warnAt ? 'error' : percent >= cautionAt ? 'warning' : 'claude'

  const isShown = (l: Limit) => windows === 'both' || baseOf(l.kind) === windows || !windowLength(l.kind)

  // Compares what is used with the share of the window already elapsed.
  // Positive delta: usage is behind the clock, so there is room to push.
  const pace = (l: Limit, now: number) => {
    const length = windowLength(l.kind)
    if (!length || !l.resetsAt) return null

    const left = Math.min(length, Math.max(0, Date.parse(l.resetsAt) - now))
    const elapsed = (1 - left / length) * 100
    const delta = Math.round(elapsed - l.percentUsed)

    if (delta > paceMargin) return { glyph: '↑', color: 'success', delta, elapsed }
    if (delta < -paceMargin) return { glyph: '↓', color: 'error', delta, elapsed }
    return { glyph: '→', color: 'subtle', delta, elapsed }
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

    const model = await read($, modelAtom)
    for (const l of forModel(e.rateLimits, model).filter(isShown)) {
      const key = `${l.kind}:${l.resetsAt ?? ''}`
      if (l.percentUsed >= warnAt && !warned.has(key)) {
        warned.add(key)
        $.ui.toast(`Limite ${labelOf(l.kind)} à ${Math.round(l.percentUsed)}%`)
      }
    }

    return next(e)
  })

  on('session.start', async ($, e, next) => {
    $.ui.status(undefined)
    await $.command.register({
      name: 'limites',
      description: 'Show the usage limits in detail and bring the band back',
    })
    await $.command.register({
      name: 'limites-masquer',
      description: 'Hide the usage limits band (/limites brings it back)',
    })
    await $.command.register({
      name: 'usage-limits-config',
      description: 'Show or change the usage-limits settings',
      argumentHint: '[réglage=valeur]',
    })
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
      await update($, sessionTokensAtom, total => addTokens(total ?? NO_TOKENS, turn))
      if (e.agentId === undefined) await update($, lastTurnAtom, () => turn)
    }
    return result
  })

  // `/clear` starts the conversation over: so do the counts.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, sessionTokensAtom, () => NO_TOKENS)
      await update($, lastTurnAtom, () => null)
    }
    return next(e)
  })

  // The mod's own settings, apart from /config: no argument lists them, `name=value` changes one.
  on('command.run', { command: 'usage-limits-config' }, async ($, e) => {
    const prefix = 'usage-limits.'
    const rows = (await $.config.list()).filter(r => r.key.startsWith(prefix))
    const describe = (r: (typeof rows)[number]) =>
      `${r.key.slice(prefix.length)} = ${String(r.value)}${r.options ? ` (${r.options.join(' | ')})` : ''}`
    const args = e.args.trim()

    if (!args) {
      return {
        text: [
          'Réglages de usage-limits (change avec /usage-limits-config réglage=valeur) :',
          ...rows.map(describe),
        ].join('\n'),
      }
    }

    const at = args.indexOf('=')
    const name = (at < 0 ? args : args.slice(0, at)).trim()
    const raw = at < 0 ? '' : args.slice(at + 1).trim()
    const row = rows.find(r => r.key === prefix + name)
    if (!row) return { text: `Réglage inconnu : ${name}\n${rows.map(describe).join('\n')}` }
    if (at < 0) return { text: describe(row) }

    let value: boolean | number | string = raw
    if (row.kind === 'boolean') {
      if (/^(true|on|oui|1)$/i.test(raw)) value = true
      else if (/^(false|off|non|0)$/i.test(raw)) value = false
      else return { text: `${name} attend true ou false.` }
    } else if (row.kind === 'number') {
      value = Number(raw)
      if (raw === '' || !Number.isFinite(value)) return { text: `${name} attend un nombre.` }
    } else if (row.options && !row.options.includes(raw)) {
      return { text: `${name} attend : ${row.options.join(' | ')}` }
    }

    const result = await $.config.set({ key: row.key, value })
    return { text: result.deny ? `Refusé : ${result.deny}` : `${name} = ${String(value)}` }
  })

  on('command.run', { command: 'limites-masquer' }, async $ => {
    await update($, isHiddenAtom, () => true)
    return { text: 'Band hidden. /limites brings it back.' }
  })

  on('command.run', { command: 'limites' }, async $ => {
    await update($, isHiddenAtom, () => false)
    let limits = await read($, limitsAtom)
    if (limits.length === 0) {
      // Nothing measured yet in this session: ask the engine for the current windows.
      limits = [...(await $.session.usage()).rateLimits]
      await update($, limitsAtom, () => limits)
    }
    const now = await $.clock.now()

    if (limits.length === 0) {
      return { text: 'No usage figure reported yet.' }
    }

    const lines = limits.map(l => {
      const p = pace(l, now)
      const reset = resetIn(l.resetsAt, now)
      const gap = p ? ` (${p.delta >= 0 ? '+' : ''}${p.delta} pts vs time, ${p.glyph})` : ''
      return `${labelOf(l.kind)} (${l.kind}): ${Math.round(l.percentUsed)}%${reset ? `, resets in ${reset}` : ''}${gap}`
    })

    const model = await read($, modelAtom)
    const last = await read($, lastTurnAtom)
    const total = await read($, sessionTokensAtom)
    const context = await read($, contextAtom)
    const shown = forModel(limits, model).map(l => labelOf(l.kind)).join(', ')
    const cached = (t: TokenCount) => (t.cacheRead || t.cacheWrite ? ` (dont cache lu ${fmtTokens(t.cacheRead)}, écrit ${fmtTokens(t.cacheWrite)})` : '')
    const tokenLines = [
      ...(model ? [`Modèle : ${model} (bande : ${shown})`] : []),
      ...(last ? [`Dernier tour : entrée ${fmtTokens(last.input)}${cached(last)}, sortie ${fmtTokens(last.output)}`] : []),
      `Session : entrée ${fmtTokens(total.input)}${cached(total)}, sortie ${fmtTokens(total.output)}`,
      ...(context?.tokens !== undefined ? [`Contexte : ${fmtTokens(context.tokens)} / ${fmtTokens(context.window)} (${context.percent ?? 0} %)`] : []),
    ]

    const width = await read($, widthAtom)
    return { text: [...lines, '', ...tokenLines, ...(width ? [`Largeur de la bande : ${width} colonnes`] : [])].join('\n') }
  })

  // The line under the band: the last turn, the session's totals, the context fill.
  // Short form for the narrow layouts, where every column counts.
  const tokensLine = (last: TokenCount | null, total: TokenCount, context: ContextFill | null, isShort: boolean) => {
    if (!last && total.input === 0 && context?.tokens === undefined) return ''
    const parts: string[] = []
    if (isShort) {
      if (last) parts.push(`Tour ↓${fmtTokens(last.input)} ↑${fmtTokens(last.output)}`)
      parts.push(`Session ↓${fmtTokens(total.input)} ↑${fmtTokens(total.output)}`)
      if (context?.percent !== undefined) parts.push(`Ctx ${context.percent} %`)
    } else {
      if (last) parts.push(`Dernier tour : entrée ${fmtTokens(last.input)}, sortie ${fmtTokens(last.output)}`)
      parts.push(`Session : entrée ${fmtTokens(total.input)}, sortie ${fmtTokens(total.output)}`)
      if (context?.tokens !== undefined) parts.push(`Contexte : ${fmtTokens(context.tokens)} / ${fmtTokens(context.window)} (${context.percent ?? 0} %)`)
    }
    return parts.join(' · ')
  }

  // Wide: everything on one row. Medium: shorter bars. Narrow: icon and both bars on one row. Tiny: no icon, the bars one above the other.
  // Columns are what the band's column offers; `layout` forces one when it misjudges.
  const modeFor = (columns: number): 'wide' | 'medium' | 'narrow' | 'tiny' => {
    if (layout === 'wide' || layout === 'medium' || layout === 'narrow') return layout
    return columns >= 100 ? 'wide' : columns >= 70 ? 'medium' : columns > 32 ? 'narrow' : 'tiny'
  }

  const tipFor = (l: Limit, p: ReturnType<typeof pace>, now: number) => {
    const parts = [`${labelOf(l.kind)} :${Math.round(l.percentUsed)} % consommé`]
    if (p) parts.push(`${Math.round(p.elapsed)} % du temps écoulé (repère noir)`)
    if (l.resetsAt) parts.push(`reset dans ${resetIn(l.resetsAt, now)}`)
    return parts.join(' · ')
  }

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const model = await read($, modelAtom)
    const limits = forModel(await read($, limitsAtom), model).filter(isShown)

    if (e.props.hasSurvey || limits.length === 0 || (await read($, isHiddenAtom))) {
      return next(e)
    }

    // Some surfaces give no width: then keep the single-row layout of 0.9.5, and never
    // write the atom (a write while drawing would redraw again).
    const columns: unknown = e.props.bodyColumns
    const hasWidth = typeof columns === 'number' && Number.isFinite(columns) && columns > 0
    const mode = hasWidth ? modeFor(columns) : layout === 'medium' || layout === 'narrow' ? layout : 'wide'
    const isTiny = mode === 'tiny'
    const isStacked = mode === 'narrow' || isTiny
    const fitWidth = mode === 'wide' ? 120 : mode === 'medium' ? 84 : isTiny && hasWidth ? Math.max(40, Math.min(400, (columns - 15) * 9)) : hasWidth ? Math.max(40, Math.min(400, Math.floor((columns - 9 - limits.length * 7) / limits.length) * 9)) : 150
    // From 50 to 69 columns the bars keep at most 65 % of the room they could take.
    const barWidth = hasWidth && columns <= 69 && columns >= 50 ? Math.round(fitWidth * 0.65) : fitWidth

    const now = await $.clock.now()
    const resets = limits
      .map(l => (l.resetsAt ? `${RESET_NAMES[l.kind] ?? labelOf(l.kind).toLowerCase()} ${resetIn(l.resetsAt, now)}` : ''))
      .filter(Boolean)
      .join(' · ')
    const tokens = showTokens
      ? tokensLine(await read($, lastTurnAtom), await read($, sessionTokensAtom), await read($, contextAtom), isStacked)
      : ''

    // A long prompt leaves the band few rows (maxRows): a taller tree would scroll or be cut.
    // Drop the extras one by one (tokens line, reset line, vertical padding, border), then hide.
    const contentRows = isTiny ? limits.length : 1
    const hasRoom = typeof e.props.maxRows === 'number' && Number.isFinite(e.props.maxRows)
    const rows = hasRoom ? e.props.maxRows : Infinity
    const fullCard = contentRows + 2 + bandPadding * 2
    const hasResetLine = showReset && resets !== '' && rows >= fullCard + 1
    const hasTokenLine = tokens !== '' && rows >= fullCard + (hasResetLine ? 1 : 0) + 1
    const hasPadding = bandPadding > 0 && rows >= fullCard
    const hasBorder = rows >= contentRows + 2
    if (rows < contentRows) {
      return next(e)
    }

    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    // The terminal has no Svg: it keeps a text icon and the line bar, with no tinted card
    // (a terminal fills any background solid, which hides the coloured text).
    const isTerminal = e.surface === 'terminal'
    const Svg = !isTerminal && 'Svg' in ui ? ui.Svg : null
    const cellCount = mode === 'wide' ? 24 : mode === 'medium' ? 16 : 8

    const verdict = verdictOf(limits, now)
    const { label, accent, glyph } = VERDICTS[verdict]

    return (
      <Box flexDirection="column" gap={0} alignItems="stretch">
        <Box
          gap={isStacked ? 2 : 3}
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
              <Svg source={iconSvg(verdict, label)} alt="" width={28} height={28} isInteractive />
            ) : (
              <Text color={accent} bold>{glyph}</Text>
            )}
            {isStacked ? null : <Text weight="semibold" color={Svg ? undefined : accent}>{label}</Text>}
          </Box>}
          {isTiny ? null : <Box flexGrow={1} />}
          {limits.map(l => {
            const p = pace(l, now)
            const markAt = showPaceMark && p ? p.elapsed : null
            const cells = Svg ? [] : bar(l.percentUsed, markAt, cellCount)

            return (
              <Box key={l.kind} gap={isStacked ? 1 : 2} alignItems="center" justifyContent={isTiny ? 'space-between' : 'flex-start'}>
                <Text dimColor size="footnote">{labelOf(l.kind)}</Text>
                {isCompact ? null : Svg ? (
                  <Svg
                    source={barSvg(l.percentUsed, accent, markAt, barWidth, barHeight, tipFor(l, p, now))}
                    alt=""
                    isInteractive
                    width={barWidth}
                    height={barBoxHeight(barHeight)}
                  />
                ) : (
                  <Text>
                    {cells.map((c, i) => (
                      <Text key={String(i)} color={c.isTick ? undefined : c.isFilled ? accent : 'subtle'} bold={c.isTick}>
                        {c.isTick ? '┃' : c.isFilled ? '━' : '╌'}
                      </Text>
                    ))}
                  </Text>
                )}
                {isStacked ? <Box minWidth={5} justifyContent="flex-end"><Text weight="bold" color={isTerminal ? accent : undefined}>{Math.round(l.percentUsed)} %</Text></Box> : <Text weight="bold" color={isTerminal ? accent : undefined}>{Math.round(l.percentUsed)} %</Text>}
                {p && showDelta ? <Text color={accent} size="footnote">{p.delta >= 0 ? '+' : ''}{p.delta}</Text> : null}
              </Box>
            )
          })}
        </Box>
        {hasResetLine ? (
          <Box justifyContent="space-between" flexDirection={isStacked ? 'column' : 'row'} paddingX={2}>
            <Text dimColor size="footnote">Reset : {resets}</Text>
          </Box>
        ) : null}
        {hasTokenLine ? (
          <Box paddingX={2}>
            <Text dimColor size="footnote">{tokens}</Text>
          </Box>
        ) : null}
      </Box>
    )
  })
}
