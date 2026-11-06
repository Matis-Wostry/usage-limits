import type { History, HistoryDay } from '../types'

export const HISTORY_KEY = 'history-v1'
const KEPT_DAYS = 90

// The day a moment falls on, on the person's own clock.
export const dayKey = (ms: number) => {
  const d = new Date(ms)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

const isDay = (value: unknown): value is HistoryDay => {
  const day = value as HistoryDay | null
  return typeof day === 'object' && day !== null && typeof day.peaks === 'object' && day.peaks !== null
    && typeof day.input === 'number' && typeof day.output === 'number'
}

// What the store holds, keeping only the days that have the right shape.
export const readHistory = (stored: unknown): History => {
  if (typeof stored !== 'object' || stored === null) return {}
  return Object.fromEntries(Object.entries(stored).filter(([, day]) => isDay(day)))
}

const withDay = (history: History, day: string, change: (entry: HistoryDay) => HistoryDay): History => {
  const merged = { ...history, [day]: change(history[day] ?? { peaks: {}, input: 0, output: 0 }) }
  const kept = Object.keys(merged).sort().slice(-KEPT_DAYS)
  return Object.fromEntries(kept.map(key => [key, merged[key] as HistoryDay]))
}

export const addPeaks = (history: History, day: string, limits: readonly { kind: string; percentUsed: number }[]) =>
  withDay(history, day, entry => ({
    ...entry,
    peaks: limits.reduce(
      (peaks, l) => ({ ...peaks, [l.kind]: Math.max(peaks[l.kind] ?? 0, l.percentUsed) }),
      entry.peaks,
    ),
  }))

export const addTokens = (history: History, day: string, input: number, output: number) =>
  withDay(history, day, entry => ({ ...entry, input: entry.input + input, output: entry.output + output }))

export const newestDays = (history: History, count: number) =>
  Object.keys(history)
    .sort()
    .reverse()
    .slice(0, count)
    .map(key => ({ key, day: history[key] as HistoryDay }))
