// coder-fleet-roster's state contract: the roster of this session's subagents, as the pane draws it.

/** Where an agent's loop stands, in the engine's own words (AgentStatus). */
export type RosterStatus = 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'

/** One tool call of an agent: in flight while `endedAt` is absent. */
export type RosterCall = { id: string; label: string; at: number; endedAt?: number; isError?: boolean }

export type RosterAgent = {
  /** The engine's agent id: `agent.spawn`'s `agentId`, `$.agent.list()`'s `id`. */
  id: string
  /** The agent type it was spawned as (`Explore`, `coder-fleet:coder`, ...). */
  type: string
  /** The Agent call's few words of what the task is. */
  description: string
  /** What SendMessage addresses it by, when it has a name. */
  name?: string
  /** The agent that spawned it; absent when the main loop did. */
  parentId?: string
  model?: string
  isBackground: boolean
  isTeammate: boolean
  status: RosterStatus
  startedAt: number
  /** When it last ended; absent while it is live. */
  endedAt?: number
  /** Tool calls so far, and how many of them errored or were refused. */
  tools: number
  errors: number
  /** The calls it is in the middle of, oldest first. */
  doing: RosterCall[]
  /** Its last few finished calls, newest last. */
  recent: RosterCall[]
  /** The answer of its last turn, trimmed. */
  summary?: string
}

declare module 'claude-code' {
  interface PluginState {
    'coder-fleet-roster': {
      agents: Shaped<RosterAgent[]>
      /** The clock, written once a second while an agent is live, so elapsed times tick. */
      now: number
      /** The agent whose card is unfolded. */
      selected: string | null
      showFinished: boolean
    }
  }
}
