export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

// Tokens of one turn, or summed over the session. `input` counts the cached part too.
export type TokenCount = { input: number; output: number; cacheRead: number; cacheWrite: number }

export type ContextFill = { tokens?: number; window: number; percent?: number }

// One day of the history pane: each limit's peak, and the tokens without the cache reads.
export type HistoryDay = { peaks: Record<string, number>; input: number; output: number }

// Keyed by the local day, `YYYY-MM-DD`.
export type History = Record<string, HistoryDay>

declare module 'claude-code' {
  interface PluginState {
    'usage-limits': {
      limits: Limit[]
      isHidden: boolean
      tick: number
      warned: string[]
      model: string
      lastTurn: TokenCount | null
      sessionTokens: TokenCount
      context: ContextFill | null
      history: History
    }
  }
}
