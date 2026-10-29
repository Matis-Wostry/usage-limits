import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Limit } from '../types'

const limitsAtom = atom({ plugin: 'usage-limits', key: 'limits' } as const, [] as Limit[])
const isHiddenAtom = atom({ plugin: 'usage-limits', key: 'isHidden' } as const, false)
const widthAtom = atom({ plugin: 'usage-limits', key: 'width' } as const, 0)

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

// A rounded track, the used share, and a tick where the clock stands in the window.
const barSvg = (percent: number, accent: string, elapsed: number | null, width: number, tip: string) => {
  const used = Math.max(0, Math.min(100, percent)) * (width / 100)
  const tick =
    elapsed === null
      ? ''
      : `<rect x="${Math.max(0, Math.min(width - 2.5, (elapsed / 100) * width - 1.25)).toFixed(1)}" y="1" width="2.5" height="14" rx="1" fill="#262626" stroke="#fff" stroke-opacity="0.55" stroke-width="0.6"/>`

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="16" viewBox="0 0 ${width} 16">` +
    `<title>${tip}</title>` +
    `<rect x="0" y="0" width="${width}" height="16" fill="transparent"/>` +
    `<rect x="0" y="5" width="${width}" height="6" rx="3" fill="${accent}" fill-opacity="0.2"/>` +
    `<rect x="0" y="5" width="${Math.max(used, used > 0 ? 6 : 0).toFixed(1)}" height="6" rx="3" fill="${accent}"/>` +
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
  const isCompact = options.isCompact === true
  const layout = String(options.layout)

  const warned = new Set<string>()

  // Theme keys follow the user's theme: calm, then caution, then alert.
  const colorFor = (percent: number) =>
    percent >= warnAt ? 'error' : percent >= cautionAt ? 'warning' : 'claude'

  const isShown = (l: Limit) => windows === 'both' || l.kind === windows || !WINDOW_MS[l.kind]

  // Compares what is used with the share of the window already elapsed.
  // Positive delta: usage is behind the clock, so there is room to push.
  const pace = (l: Limit, now: number) => {
    const length = WINDOW_MS[l.kind]
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

    const session = limits.find(l => l.kind === 'five_hour')
    const week = limits.find(l => l.kind === 'seven_day')
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

    for (const l of e.rateLimits.filter(isShown)) {
      const key = `${l.kind}:${l.resetsAt ?? ''}`
      if (l.percentUsed >= warnAt && !warned.has(key)) {
        warned.add(key)
        $.ui.toast(`Limite ${LABELS[l.kind] ?? l.kind} à ${Math.round(l.percentUsed)}%`)
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
    const { rateLimits } = await $.session.usage()
    await update($, limitsAtom, () => [...rateLimits])
    return next(e)
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
      return `${LABELS[l.kind] ?? l.kind}: ${Math.round(l.percentUsed)}%${reset ? `, resets in ${reset}` : ''}${gap}`
    })

    const width = await read($, widthAtom)
    return { text: [...lines, ...(width ? [`Largeur de la bande : ${width} colonnes`] : [])].join('\n') }
  })

  // Wide: everything on one row. Medium: shorter bars. Narrow: icon and both bars on one row. Tiny: no icon, the bars one above the other.
  // Columns are what the band's column offers; `layout` forces one when it misjudges.
  const modeFor = (columns: number): 'wide' | 'medium' | 'narrow' | 'tiny' => {
    if (layout === 'wide' || layout === 'medium' || layout === 'narrow') return layout
    return columns >= 100 ? 'wide' : columns >= 70 ? 'medium' : columns > 32 ? 'narrow' : 'tiny'
  }

  const tipFor = (l: Limit, p: ReturnType<typeof pace>, now: number) => {
    const parts = [`${LABELS[l.kind] ?? l.kind} : ${Math.round(l.percentUsed)} % consommé`]
    if (p) parts.push(`${Math.round(p.elapsed)} % du temps écoulé (repère noir)`)
    if (l.resetsAt) parts.push(`reset dans ${resetIn(l.resetsAt, now)}`)
    return parts.join(' · ')
  }

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const limits = (await read($, limitsAtom)).filter(isShown)

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

    // A long prompt leaves the band few rows (maxRows): a taller tree would scroll or be cut.
    // Drop the extras one by one (debug line, reset line, vertical padding, border), then hide.
    const contentRows = isTiny ? limits.length : 1
    const hasRoom = typeof e.props.maxRows === 'number' && Number.isFinite(e.props.maxRows)
    const rows = hasRoom ? e.props.maxRows : Infinity
    const hasReset = showReset
    const hasResetLine = hasReset && rows >= contentRows + 4 + 1
    const hasPadding = rows >= contentRows + 4
    const hasBorder = rows >= contentRows + 2
    if (rows < contentRows) {
      return next(e)
    }

    const now = await $.clock.now()
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    // The terminal has no Svg: it keeps a text icon and the line bar, with no tinted card
    // (a terminal fills any background solid, which hides the coloured text).
    const isTerminal = e.surface === 'terminal'
    const Svg = !isTerminal && 'Svg' in ui ? ui.Svg : null
    const cellCount = mode === 'wide' ? 24 : mode === 'medium' ? 16 : 8

    const verdict = verdictOf(limits, now)
    const { label, accent, glyph } = VERDICTS[verdict]
    const resets = limits
      .map(l => (l.resetsAt ? `${RESET_NAMES[l.kind] ?? l.kind} ${resetIn(l.resetsAt, now)}` : ''))
      .filter(Boolean)
      .join(' · ')

    return (
      <Box flexDirection="column" gap={0} alignItems="stretch">
        <Box
          gap={isStacked ? 2 : 3}
          flexDirection={isTiny ? 'column' : 'row'}
          paddingX={2}
          paddingY={hasPadding ? 1 : 0}
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
            const cells = Svg ? [] : bar(l.percentUsed, p ? p.elapsed : null, cellCount)

            return (
              <Box key={l.kind} gap={isStacked ? 1 : 2} alignItems="center" justifyContent={isTiny ? 'space-between' : 'flex-start'}>
                <Text dimColor size="footnote">{LABELS[l.kind] ?? l.kind}</Text>
                {isCompact ? null : Svg ? (
                  <Svg
                    source={barSvg(l.percentUsed, accent, p ? p.elapsed : null, barWidth, tipFor(l, p, now))}
                    alt=""
                    isInteractive
                    width={barWidth}
                    height={16}
                  />
                ) : (
                  <Text>
                    {cells.map((c, i) => (
                      <Text key={i} color={c.isTick ? undefined : c.isFilled ? accent : 'subtle'} bold={c.isTick}>
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
        {hasResetLine && resets ? (
          <Box justifyContent="space-between" flexDirection={isStacked ? 'column' : 'row'} paddingX={2}>
            <Text dimColor size="footnote">Reset : {resets}</Text>
          </Box>
        ) : null}
      </Box>
    )
  })
}
