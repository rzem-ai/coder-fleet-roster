// coder-fleet-roster: a live roster of this session's subagents in a pane beside the chat. Fed by the agents'
// own events (spawn, each tool call, each turn's start and end) and checked against `$.agent.list()` once a
// second while anything is live, which catches what no event says (a teammate gone idle, a kill from the
// tasks list, an agent that started before this mod loaded).
import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, Register, UiOpenResult } from 'claude-code'
import type { RosterAgent } from '../types'
import {
  callEnded, callLabel, callStarted, clearFinished, duration, isActive, type ListedAgent, reconcile, same, spawned, statusLine, turnEnded, turnStarted,
} from './roster'
import { RosterView, type ViewHandlers } from './view'

type $ = EngineInterface

const PANE = 'roster'
const TITLE = 'Roster'
const COMMAND = 'roster'
const POLL_MS = 1000
/** With nothing live, the list is checked every this many ticks instead of every one. */
const IDLE_EVERY = 5
/** How a subagent hands its report back: not work worth listing. */
const HANDBACK = 'SubagentHandback'

// Bump the shape when RosterAgent changes: it declines what an earlier version stored, which outlives a reload.
const agentsAtom = atom({ plugin: 'coder-fleet-roster', key: 'agents' } as const, [], { shape: 'agents-1' })
const nowAtom = atom({ plugin: 'coder-fleet-roster', key: 'now' } as const, 0)
const selectedAtom = atom({ plugin: 'coder-fleet-roster', key: 'selected' } as const, null)
const showFinishedAtom = atom({ plugin: 'coder-fleet-roster', key: 'showFinished' } as const, true)

type ToastLevel = 'all' | 'failures' | 'off'

/** Module state: settings and bookkeeping. Reset by a reload; what the pane draws lives in $.state. */
const S = {
  autoOpen: true,
  toasts: 'all' as ToastLevel,
  isInteractive: true,
  /** The person closed the pane by hand: no more opening it unasked this session. */
  dismissed: false,
  polling: false,
  ticks: 0,
  status: undefined as string | undefined,
}

const toastLevelOf = (value: unknown): ToastLevel => (value === 'failures' || value === 'off' ? value : 'all')

const listed = (info: AgentInfo): ListedAgent => ({
  id: info.id,
  type: info.type,
  description: info.description,
  status: info.status,
  ...(info.parentId ? { parentId: info.parentId } : {}),
  ...(info.name ? { name: info.name } : {}),
})

const refreshStatus = async ($: $): Promise<void> => {
  const text = statusLine(await read($, agentsAtom))
  if (text === S.status) return
  S.status = text
  $.ui.status(text)
}

const save = async ($: $, fn: (list: RosterAgent[]) => RosterAgent[]): Promise<void> => {
  await update($, agentsAtom, list => fn([...list]))
  await refreshStatus($)
}

/** One check against the engine's list; the clock is written only while something is live. */
const poll = async ($: $): Promise<void> => {
  if (S.polling) return
  S.polling = true
  try {
    const infos = await $.agent.list().catch(() => null)
    const now = await $.clock.now()
    const list = await read($, agentsAtom)
    if (infos) {
      const fresh = infos.map(listed)
      if (!same(list, reconcile(list, fresh, now))) await update($, agentsAtom, current => reconcile(current, fresh, now))
    }
    if ((await read($, agentsAtom)).some(isActive)) await update($, nowAtom, () => now)
    await refreshStatus($)
  } finally {
    S.polling = false
  }
}

const tick = async ($: $): Promise<void> => {
  S.ticks += 1
  const live = (await read($, agentsAtom)).some(isActive)
  if (live || S.ticks % IDLE_EVERY === 0) await poll($)
}

const openPane = ($: $): Promise<UiOpenResult> => $.ui.open({ id: PANE, title: TITLE })

/** Unasked: once a subagent starts, unless the person closed the pane or no one is at the prompt. */
const autoOpen = async ($: $): Promise<void> => {
  if (!S.autoOpen || !S.isInteractive || S.dismissed) return
  if ((await $.ui.panes()).some(pane => pane.id === PANE)) return
  await openPane($)
}

const label = (a: RosterAgent): string => (a.description ? `${a.type}: ${a.description}` : a.type)

const toastEnd = ($: $, a: RosterAgent): void => {
  const took = a.endedAt !== undefined ? ` · ${duration(a.endedAt - a.startedAt)}` : ''
  if (a.status === 'completed' && S.toasts === 'all') $.ui.toast(`Agent done · ${label(a)}${took}`)
  if (a.status === 'failed' && S.toasts !== 'off') $.ui.toast(`Agent failed · ${label(a)}${took}`)
}

const handlers = ($: $): ViewHandlers => ({
  select: id => void update($, selectedAtom, open => (open === id ? null : id)),
  view: id => {
    void $.ui.view({ agentId: id }).then(
      shown => shown.deny && $.ui.toast(`Can't show that transcript: ${shown.deny}`),
      () => undefined,
    )
  },
  back: () => void $.ui.view({}).catch(() => undefined),
  toggleFinished: () => void update($, showFinishedAtom, shown => !shown),
  clearFinished: () => {
    void (async () => {
      await save($, clearFinished)
      await update($, selectedAtom, () => null)
    })()
  },
})

export const register: Register = (on, options) => {
  S.autoOpen = options.autoOpen !== false
  S.toasts = toastLevelOf(options.toasts)

  // ─── session ─────────────────────────────────────────────────────────────────────────────────────

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    S.isInteractive = e.isInteractive
    await $.command.register({
      name: COMMAND,
      description: 'Show the live roster of subagents and what each is doing',
      argumentHint: '[clear | status]',
    })
    $.clock.every(POLL_MS, () => void tick($))
    void refreshStatus($)
    return started
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'clear') {
      const before = (await read($, agentsAtom)).length
      await save($, clearFinished)
      const after = (await read($, agentsAtom)).length
      return { text: `Roster: cleared ${before - after} finished agent${before - after === 1 ? '' : 's'}.` }
    }
    if (arg === 'status') {
      await poll($)
      const list = await read($, agentsAtom)
      const now = await $.clock.now()
      if (list.length === 0) return { text: 'Roster: no subagents this session.' }
      return {
        text: list
          .map(a => `${a.status.padEnd(9)} ${label(a)} · ${duration((a.endedAt ?? now) - a.startedAt)} · ${a.tools} tools${a.doing[0] ? ` · now: ${a.doing[0].label}` : ''}`)
          .join('\n'),
      }
    }
    S.dismissed = false
    const opened = await openPane($)
    if (!opened.isPlaced) return { text: `Roster: the pane is open but not shown: ${opened.reason}` }
    return { text: 'Roster opened.' }
  }).catch(() => ({ text: 'Roster: that failed; run `claude --debug` for the reason.' }))

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') S.dismissed = true
    return next(e)
  }).catch(($, e, next) => next(e))

  // ─── the agents' own events ──────────────────────────────────────────────────────────────────────

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    const id = started.agentId ?? e.resume?.agentId
    if (started.deny !== undefined || id === undefined) return started
    const now = await $.clock.now()
    await save($, list => spawned(list, {
      id,
      type: e.subagentType,
      description: e.description,
      ...(e.name ? { name: e.name } : {}),
      ...(e.parentAgentId ? { parentId: e.parentAgentId } : {}),
      ...(started.model ? { model: started.model } : {}),
      isBackground: e.background,
      isTeammate: e.isTeammate === true,
    }, now))
    // Awaited: an unasked open answers at once (placed, or waiting for a wider terminal), and a spawn's
    // answer then means the pane is up.
    if (!e.resume) await autoOpen($).catch(() => undefined)
    return started
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    const started = await next(e)
    const id = e.agentId
    if (id !== undefined) {
      const now = await $.clock.now()
      await save($, list => turnStarted(list, id, now))
    }
    return started
  }).catch(($, e, next) => next(e))

  // A subagent's tool call: what it is doing now, then how it went.
  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    const tool = String(e.tool)
    if (id === undefined || tool === HANDBACK) return next(e)
    const at = await $.clock.now()
    const call = { id: e.tool_use_id, label: callLabel(tool, e as unknown as Record<string, unknown>), at }
    await save($, list => callStarted(list, id, call, at))
    let isError = true
    try {
      const ran = await next(e)
      isError = ran.deny !== undefined || ran.isError === true
      return ran
    } finally {
      const end = await $.clock.now()
      await save($, list => callEnded(list, id, call.id, isError, end))
    }
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const id = e.agentId
    if (id === undefined) return done
    const now = await $.clock.now()
    await save($, list => turnEnded(list, id, { reason: e.reason, answer: e.answer }, now))
    const agent = (await read($, agentsAtom)).find(a => a.id === id)
    if (agent) toastEnd($, agent)
    return done
  }).catch(($, e, next) => next(e))

  // ─── the pane ────────────────────────────────────────────────────────────────────────────────────

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const el = $.ui.resolve(e)
    // Read so the pane redraws as the clock ticks; the time itself comes from the clock.
    await read($, nowAtom)
    return RosterView(el, {
      agents: await read($, agentsAtom),
      now: await $.clock.now(),
      selected: await read($, selectedAtom),
      showFinished: await read($, showFinishedAtom),
      columns: e.props.bodyColumns,
      viewing: e.props.view.agentId ?? null,
    }, handlers($))
  })
}
