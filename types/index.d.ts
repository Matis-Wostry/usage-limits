export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

// Tokens of one turn, or summed over the session. `input` counts the cached part too.
export type TokenCount = { input: number; output: number; cacheRead: number; cacheWrite: number }

export type ContextFill = { tokens?: number; window: number; percent?: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-limits': {
      limits: Limit[]
      isHidden: boolean
      width: number
      model: string
      lastTurn: TokenCount | null
      sessionTokens: TokenCount
      context: ContextFill | null
    }
  }
}
