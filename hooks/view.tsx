// The Roster pane: a header of counts, then one card per agent, children nested under the agent that spawned
// them. Every handler is passed in, so this file holds no state.
import type { RosterAgent, RosterCall, RosterStatus } from '../types'
import { counts, duration, isActive, ordered, plural, type RosterRow, shortModel, truncate } from './roster'
import { COLOR, Fold, type Look, Mark, type PaneElements, Row } from './ui'

export type ViewData = {
  agents: readonly RosterAgent[]
  now: number
  selected: string | null
  showFinished: boolean
  columns: number
  /** The agent whose transcript is in the main view; null for the main conversation. */
  viewing: string | null
}

export type ViewHandlers = {
  select: (id: string) => void
  view: (id: string) => void
  back: () => void
  toggleFinished: () => void
  clearFinished: () => void
}

export const STATUS_LOOK: Record<RosterStatus, Look & { word: string }> = {
  pending: { icon: '◌', color: COLOR.muted, word: 'starting' },
  running: { icon: '●', color: COLOR.busy, word: 'running' },
  waiting: { icon: '◐', color: COLOR.hold, word: 'waiting' },
  idle: { icon: '○', color: COLOR.info, word: 'idle' },
  completed: { icon: '✓', color: COLOR.ok, word: 'done' },
  failed: { icon: '✗', color: COLOR.bad, word: 'failed' },
  killed: { icon: '■', color: COLOR.muted, word: 'stopped' },
}

const CALL_LOOK = { ok: { icon: '✓', color: COLOR.ok }, bad: { icon: '✗', color: COLOR.bad } } as const

/** What a live agent with no tool in flight is up to. */
const BETWEEN: Partial<Record<RosterStatus, string>> = {
  pending: 'starting',
  running: 'thinking',
  waiting: 'waiting on background work or an approval',
  idle: 'idle, waiting for a message',
}

const ORDER: readonly RosterStatus[] = ['running', 'pending', 'waiting', 'idle', 'completed', 'failed', 'killed']

const Header = (el: PaneElements, data: ViewData, on: ViewHandlers) => {
  const { Text, Button } = el
  const c = counts(data.agents)
  const finished = c.completed + c.failed + c.killed
  return Row(el, 'header', [
    <Text key="title" bold color={COLOR.brand}>Roster</Text>,
    ...ORDER.filter(s => c[s] > 0).map(s => Mark(el, `count-${s}`, STATUS_LOOK[s], ` ${c[s]} ${STATUS_LOOK[s].word}`)),
    finished > 0 && (
      <Button key="toggle-finished" plain hotkey="f" label={data.showFinished ? 'hide finished' : `show ${finished} finished`} onPress={on.toggleFinished} />
    ),
    finished > 0 && <Button key="clear-finished" plain hotkey="c" label="clear finished" onPress={on.clearFinished} />,
    data.viewing !== null && <Button key="back" plain hotkey="m" label="back to main" onPress={on.back} />,
  ], { gap: 2 })
}

const elapsedOf = (a: RosterAgent, now: number): string => duration((a.endedAt ?? now) - a.startedAt)

/** The line under a card's title: the tool it is on, what it is waiting for, or how it ended. */
const NowLine = (el: PaneElements, data: ViewData, a: RosterAgent, k: (p: string) => string, width: number) => {
  const { Text } = el
  const first = a.doing[0]
  if (first) {
    const more = a.doing.length > 1 ? ` +${a.doing.length - 1} more` : ''
    return Row(el, k('now'), [
      <Text key={k('now-call')} color={COLOR.busy}>{`› ${truncate(first.label, Math.max(10, width - 14 - more.length))}`}</Text>,
      <Text key={k('now-for')} dimColor>{`${duration(data.now - first.at)}${more}`}</Text>,
    ], { indent: 1, wrap: false })
  }
  if (isActive(a)) return Row(el, k('now'), [<Text key={k('now-between')} dimColor italic>{BETWEEN[a.status] ?? a.status}</Text>], { indent: 1 })
  const said = a.summary ? truncate(a.summary.split('\n')[0] ?? '', width - 2) : a.status === 'completed' ? '(no answer)' : ''
  if (!said) return null
  return Row(el, k('now'), [
    <Text key={k('now-said')} color={a.status === 'failed' ? COLOR.bad : undefined} dimColor={a.status !== 'failed'}>{said}</Text>,
  ], { indent: 1, wrap: false })
}

const CallLine = (el: PaneElements, k: (p: string) => string, call: RosterCall, width: number) => {
  const { Text } = el
  const ck = (p: string): string => k(`${p}-${call.id}`)
  return Row(el, ck('call'), [
    Mark(el, ck('call-mark'), call.isError ? CALL_LOOK.bad : CALL_LOOK.ok),
    <Text key={ck('call-label')}>{truncate(call.label, Math.max(10, width - 12))}</Text>,
    call.endedAt !== undefined && <Text key={ck('call-took')} dimColor>{duration(call.endedAt - call.at)}</Text>,
  ], { indent: 2, wrap: false })
}

/** An unfolded card: its last calls, its whole answer, and the button that opens its transcript. */
const Detail = (el: PaneElements, data: ViewData, on: ViewHandlers, a: RosterAgent, k: (p: string) => string, width: number) => {
  const { Box, Text, Button } = el
  return (
    <Box key={k('detail')} flexDirection="column">
      {a.recent.length === 0
        ? Row(el, k('no-calls'), [<Text key={k('no-calls-text')} dimColor>no finished tool calls yet</Text>], { indent: 2 })
        : a.recent.map(call => CallLine(el, k, call, width))}
      {a.summary && a.summary.includes('\n') && (
        <Box key={k('answer')} flexDirection="column" paddingLeft={4} marginTop={1}>
          {a.summary.split('\n').slice(0, 12).map((line, i) => <Text key={k(`answer-${i}`)} dimColor>{truncate(line, width - 4) || ' '}</Text>)}
        </Box>
      )}
      {Row(el, k('actions'), [
        data.viewing === a.id
          ? <Button key={k('back')} label="back to main" onPress={on.back} />
          : <Button key={k('view')} label="view transcript" onPress={() => on.view(a.id)} />,
        <Text key={k('id')} dimColor>{a.id}</Text>,
      ], { indent: 2 })}
    </Box>
  )
}

const Card = (el: PaneElements, data: ViewData, on: ViewHandlers, row: RosterRow) => {
  const { Box, Text } = el
  const a = row.agent
  const k = (p: string): string => `${p}-${a.id}`
  const open = data.selected === a.id
  const isViewing = data.viewing === a.id
  const width = Math.max(20, data.columns - 2 * row.depth - (isViewing ? 4 : 2))
  const meta = [
    a.model ? shortModel(a.model) : null,
    elapsedOf(a, data.now),
    plural(a.tools, 'tool'),
    a.errors > 0 ? `${a.errors} errored` : null,
    a.isTeammate ? 'teammate' : a.isBackground ? 'background' : null,
  ].filter((p): p is string => p !== null).join(' · ')
  const frame = isViewing ? { borderStyle: 'round', borderColor: COLOR.brand, paddingX: 1 } : {}
  return (
    <Box key={k('card')} flexDirection="column" {...(row.depth ? { marginLeft: 2 * row.depth } : {})} {...frame}>
      {Row(el, k('title'), [
        row.depth > 0 && <Text key={k('branch')} dimColor>└</Text>,
        Mark(el, k('mark'), STATUS_LOOK[a.status]),
        Fold(el, k('select'), open, a.type, () => on.select(a.id)),
        a.name && <Text key={k('name')} color={COLOR.info}>{`@${a.name}`}</Text>,
        a.description && <Text key={k('desc')} bold>{truncate(a.description, Math.max(12, width - a.type.length - 10))}</Text>,
        <Text key={k('meta')} dimColor>{meta}</Text>,
        isViewing && <Text key={k('in-view')} color={COLOR.brand}>in view</Text>,
      ])}
      {NowLine(el, data, a, k, width)}
      {open && Detail(el, data, on, a, k, width)}
    </Box>
  )
}

export const RosterView = (el: PaneElements, data: ViewData, on: ViewHandlers) => {
  const { Box, Text } = el
  const rows = ordered(data.agents, data.showFinished)
  const hidden = data.agents.length - rows.length
  return (
    <Box key="roster" flexDirection="column" gap={1}>
      {Header(el, data, on)}
      {data.agents.length === 0 && (
        <Text key="empty" dimColor>No subagents yet. When one starts it shows up here, with the tool it is on and how long it has taken.</Text>
      )}
      {data.agents.length > 0 && rows.length === 0 && (
        <Text key="all-finished" dimColor>{`Nothing live. ${plural(hidden, 'finished agent')} hidden (f shows them).`}</Text>
      )}
      {rows.length > 0 && (
        <Box key="cards" flexDirection="column" gap={1}>
          {rows.map(row => Card(el, data, on, row))}
        </Box>
      )}
    </Box>
  )
}
