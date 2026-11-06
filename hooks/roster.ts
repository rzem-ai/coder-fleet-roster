// The roster's logic: who is live, what each agent is doing, and the order to draw them in. Pure: no `$`,
// so every rule here is tested without an engine.
import type { RosterAgent, RosterCall, RosterStatus } from '../types'

export const MAX_AGENTS = 100
export const MAX_RECENT = 8
/**
 * The engine's list lags its events: an agent that ended this recently and is still listed as live is taken
 * at the event's word, and one we saw start this recently is not dropped for being missing from the list.
 */
export const LIST_LAG_MS = 5000

const ACTIVE: ReadonlySet<RosterStatus> = new Set<RosterStatus>(['pending', 'running', 'waiting', 'idle'])
export const isActive = (a: { status: RosterStatus }): boolean => ACTIVE.has(a.status)

export type AgentFacts = {
  id: string
  type?: string
  description?: string
  name?: string
  parentId?: string
  model?: string
  isBackground?: boolean
  isTeammate?: boolean
}

/** An agent as `$.agent.list()` reports it, cut down to what the roster reads. */
export type ListedAgent = { id: string; type: string; description: string; status: RosterStatus; parentId?: string; name?: string }

// ─── text ────────────────────────────────────────────────────────────────────────────────────────

export const truncate = (text: string, n: number): string => (n <= 1 ? '…' : text.length > n ? `${text.slice(0, n - 1)}…` : text)

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

/** `4s`, `1m 05s`, `2h 03m`. */
export const duration = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/** `claude-haiku-5-5` → `haiku-5-5`; a date suffix goes too. */
export const shortModel = (model: string): string => model.replace(/^claude-/, '').replace(/-\d{8}$/, '')

/** `mcp__github__create_issue` → `github:create_issue`. */
export const toolName = (tool: string): string => {
  const m = /^mcp__(.+?)__(.+)$/.exec(tool)
  return m ? `${m[1]}:${m[2]}` : tool
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined)

const baseName = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path

const hostOf = (url: string | undefined): string | undefined => {
  if (!url) return undefined
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

/** What a tool call is about, in a few words: `Bash Run the tests`, `Read auth.ts`, `Grep "useAuth"`. */
export const callLabel = (tool: string, input: Readonly<Record<string, unknown>>): string => {
  const path = str(input.file_path) ?? str(input.notebook_path)
  const pattern = str(input.pattern)
  const detail =
    tool === 'Bash' ? str(input.description) ?? str(input.command)
    : path ? baseName(path)
    : tool === 'Grep' ? (pattern ? `"${pattern}"` : undefined)
    : tool === 'Glob' ? pattern
    : tool === 'WebFetch' ? hostOf(str(input.url))
    : tool === 'WebSearch' ? str(input.query)
    : tool === 'Agent' || tool === 'Task' ? str(input.description)
    : tool === 'Skill' ? str(input.skill)
    : str(input.description) ?? str(input.query) ?? str(input.path)
  return truncate(oneLine(detail ? `${toolName(tool)} ${detail}` : toolName(tool)), 120)
}

/** The first line of an answer that says something. */
export const firstLine = (answer: string): string => answer.split('\n').map(l => l.trim()).find(l => l !== '') ?? ''

// ─── the list ────────────────────────────────────────────────────────────────────────────────────

const withoutEnd = (a: RosterAgent): RosterAgent => {
  const { endedAt: _ended, ...rest } = a
  return rest
}

export const blank = (facts: AgentFacts, now: number, status: RosterStatus = 'running'): RosterAgent => ({
  id: facts.id,
  type: facts.type || 'agent',
  description: facts.description ?? '',
  ...(facts.name ? { name: facts.name } : {}),
  ...(facts.parentId ? { parentId: facts.parentId } : {}),
  ...(facts.model ? { model: facts.model } : {}),
  isBackground: facts.isBackground === true,
  isTeammate: facts.isTeammate === true,
  status,
  startedAt: now,
  ...(isActive({ status }) ? {} : { endedAt: now }),
  tools: 0,
  errors: 0,
  doing: [],
  recent: [],
})

/** What is known fills what is not: a later event's facts never blank an earlier one's. */
const merge = (a: RosterAgent, facts: AgentFacts): RosterAgent => ({
  ...a,
  type: a.type === 'agent' && facts.type ? facts.type : a.type,
  description: a.description || facts.description || '',
  ...(!a.name && facts.name ? { name: facts.name } : {}),
  ...(!a.parentId && facts.parentId ? { parentId: facts.parentId } : {}),
  ...(facts.model ? { model: facts.model } : {}),
  ...(facts.isBackground !== undefined ? { isBackground: facts.isBackground } : {}),
  ...(facts.isTeammate ? { isTeammate: true } : {}),
})

/** Past MAX_AGENTS the oldest finished agent goes first; a live one only when nothing else can. */
const cap = (list: readonly RosterAgent[]): RosterAgent[] => {
  const out = [...list]
  while (out.length > MAX_AGENTS) {
    const i = out.findIndex(a => !isActive(a))
    out.splice(i === -1 ? 0 : i, 1)
  }
  return out
}

/** Applies `fn` to one agent, adding a blank one first when the roster has never seen it (a reload, say). */
const patch = (list: readonly RosterAgent[], id: string, now: number, fn: (a: RosterAgent) => RosterAgent): RosterAgent[] =>
  list.some(a => a.id === id) ? list.map(a => (a.id === id ? fn(a) : a)) : cap([...list, fn(blank({ id }, now))])

/** An agent started, or a finished one was resumed under its id. */
export const spawned = (list: readonly RosterAgent[], facts: AgentFacts, now: number): RosterAgent[] =>
  list.some(a => a.id === facts.id)
    ? list.map(a => (a.id === facts.id ? withoutEnd({ ...merge(a, facts), status: 'running' }) : a))
    : cap([...list, blank(facts, now)])

export const turnStarted = (list: readonly RosterAgent[], id: string, now: number): RosterAgent[] =>
  patch(list, id, now, a => withoutEnd({ ...a, status: 'running' }))

export type TurnEnd = { reason: 'answer' | 'aborted' | 'refusal' | 'error'; answer: string }

/** A teammate that answered goes idle, waiting for a message; anything else that answered is done. */
export const endStatus = (reason: TurnEnd['reason'], isTeammate: boolean): RosterStatus =>
  reason === 'answer' ? (isTeammate ? 'idle' : 'completed') : reason === 'aborted' ? 'killed' : 'failed'

export const turnEnded = (list: readonly RosterAgent[], id: string, end: TurnEnd, now: number): RosterAgent[] =>
  patch(list, id, now, a => {
    const status = endStatus(end.reason, a.isTeammate)
    const summary = truncate(end.answer.trim(), 600)
    const ended: RosterAgent = { ...a, status, doing: [], ...(summary ? { summary } : {}) }
    return isActive(ended) ? withoutEnd(ended) : { ...ended, endedAt: now }
  })

export const callStarted = (list: readonly RosterAgent[], id: string, call: RosterCall, now: number): RosterAgent[] =>
  patch(list, id, now, a => ({
    ...a,
    status: isActive(a) ? (a.status === 'pending' ? 'running' : a.status) : a.status,
    tools: a.tools + 1,
    doing: [...a.doing, call],
  }))

export const callEnded = (list: readonly RosterAgent[], id: string, callId: string, isError: boolean, now: number): RosterAgent[] =>
  patch(list, id, now, a => {
    const call = a.doing.find(c => c.id === callId)
    if (!call) return a
    const done: RosterCall = { ...call, endedAt: now, ...(isError ? { isError: true } : {}) }
    return {
      ...a,
      errors: a.errors + (isError ? 1 : 0),
      doing: a.doing.filter(c => c.id !== callId),
      recent: [...a.recent, done].slice(-MAX_RECENT),
    }
  })

/**
 * Brings the roster in line with the engine's list, the authority on status: it catches what no event said
 * (a teammate gone idle, an agent killed from the tasks list, one started before this mod loaded).
 */
export const reconcile = (list: readonly RosterAgent[], listed: readonly ListedAgent[], now: number): RosterAgent[] => {
  const byId = new Map(listed.map(info => [info.id, info]))
  const out = list.map(a => {
    const info = byId.get(a.id)
    if (!info) {
      // Dropped from the list: the engine is done with it. A brand-new one may not be listed yet.
      if (!isActive(a) || now - a.startedAt < LIST_LAG_MS) return a
      return { ...a, status: 'completed' as const, doing: [], endedAt: now }
    }
    const known = merge(a, info)
    if (!isActive(a) && isActive(info) && a.endedAt !== undefined && now - a.endedAt < LIST_LAG_MS) return known
    if (known.status === info.status) return known
    return isActive(info)
      ? withoutEnd({ ...known, status: info.status })
      : { ...known, status: info.status, doing: [], endedAt: a.endedAt ?? now }
  })
  const seen = new Set(list.map(a => a.id))
  const fresh = listed.filter(info => !seen.has(info.id)).map(info => blank(info, now, info.status))
  return cap([...out, ...fresh])
}

export const clearFinished = (list: readonly RosterAgent[]): RosterAgent[] => list.filter(isActive)

export const counts = (list: readonly RosterAgent[]): Record<RosterStatus, number> => {
  const c: Record<RosterStatus, number> = { pending: 0, running: 0, waiting: 0, idle: 0, completed: 0, failed: 0, killed: 0 }
  for (const a of list) c[a.status] += 1
  return c
}

/** The status line while anything is live; undefined clears it. */
export const statusLine = (list: readonly RosterAgent[]): string | undefined => {
  const c = counts(list)
  const parts = [
    c.running + c.pending && `${c.running + c.pending} running`,
    c.waiting && `${c.waiting} waiting`,
    c.idle && `${c.idle} idle`,
  ].filter((p): p is string => typeof p === 'string')
  if (parts.length === 0) return undefined
  const live = list.filter(a => a.status === 'running' && a.doing.length > 0)
  const only = live.length === 1 && live[0] ? ` · ${live[0].type}: ${truncate(live[0].doing[0]?.label ?? '', 40)}` : ''
  return `roster · ${parts.join(' · ')}${only}`
}

export type RosterRow = { agent: RosterAgent; depth: number }

const DEPTH_LIMIT = 8

/**
 * The cards in drawing order: live roots first, then finished ones, each oldest first, every agent's children
 * nested under it. A child whose parent is not shown stands as a root.
 */
export const ordered = (list: readonly RosterAgent[], showFinished: boolean): RosterRow[] => {
  const shown = list.filter(a => showFinished || isActive(a))
  const ids = new Set(shown.map(a => a.id))
  const children = new Map<string, RosterAgent[]>()
  const ROOT = '\u0000root'
  for (const a of shown) {
    const key = a.parentId && a.parentId !== a.id && ids.has(a.parentId) ? a.parentId : ROOT
    children.set(key, [...(children.get(key) ?? []), a])
  }
  const byStart = (x: RosterAgent, y: RosterAgent): number => x.startedAt - y.startedAt
  const rows: RosterRow[] = []
  const placed = new Set<string>()
  const walk = (key: string, depth: number): void => {
    const kids = [...(children.get(key) ?? [])].sort(byStart)
    const sorted = depth === 0 ? [...kids.filter(isActive), ...kids.filter(a => !isActive(a))] : kids
    for (const a of sorted) {
      if (placed.has(a.id)) continue
      placed.add(a.id)
      rows.push({ agent: a, depth })
      if (depth < DEPTH_LIMIT) walk(a.id, depth + 1)
    }
  }
  walk(ROOT, 0)
  // A parent loop (a cycle the engine should never make) leaves agents unplaced: show them at the root.
  for (const a of shown) if (!placed.has(a.id)) rows.push({ agent: a, depth: 0 })
  return rows
}

export const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
