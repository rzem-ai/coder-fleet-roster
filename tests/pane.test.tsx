import type { AgentInfo, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const PANE = (bodyColumns = 100) => ({
  plugin: 'coder-fleet-roster',
  component: 'Pane',
  requestId: 'roster',
  props: { title: 'Roster', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const)

const SPAWN = {
  tool_use_id: 't0', prompt: 'find auth', description: 'Find the auth middleware', subagentType: 'Explore',
  provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false,
} as const

/**
 * The hooks that stand for the engine beneath the mod. `listed` is what `$.agent.list()` answers, live;
 * `nextId` names each agent a spawn starts.
 */
const engine = (on: On, listed: AgentInfo[] = [], nextId: () => string = () => 'a1') => {
  const toasts: string[] = []
  const status: Array<string | undefined> = []
  const opened: string[] = []
  on('command.register', () => ({ value: { command: 'roster' } }))
  on('ui.open', (_, e) => (opened.push(e.id), { value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.status', (_, e) => (status.push(e.text), { value: undefined }))
  on('ui.toast', (_, e) => (toasts.push(e.text), { value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: nextId() }))
  on('agent.list', () => ({ value: listed }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  return { toasts, status, opened }
}

const A1: AgentInfo = { id: 'a1', type: 'Explore', description: 'Find the auth middleware', status: 'running' }

test('a subagent shows the tool it is on, then its answer, on every surface that takes input', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const listed = [{ ...A1 }]
  const { toasts, status, opened } = engine(on, listed)
  let release = (): void => undefined
  const gate = new Promise<void>(resolve => { release = resolve })
  on('tool.call', async () => (await gate, { result: {} }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(SPAWN)
  expect(opened).toEqual(['roster'])
  const call = $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run the tests', agentId: 'a1' })
  await clock.advance(12_000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE(), surface })
    expect((await ui.find({ type: 'Text', text: /Run the tests/ }))?.text).toBe('› Bash Run the tests')
    expect((await ui.find({ type: 'Text', text: /haiku/ }))?.text).toBe('haiku-5-5 · 12s · 1 tool')
    expect((await ui.find({ type: 'Text', text: /1 running/ }))?.text).toBe('● 1 running')
    await ui.unmount()
  }
  expect(status.at(-1)).toBe('roster · 1 running · Explore: Bash Run the tests')

  release()
  await call
  await $.turn.complete({
    answer: 'It lives in app/middleware/auth.ts\nand is wired in server.ts', durationMs: 14_000, isAborted: false, turnId: 'x', reason: 'answer', agentId: 'a1',
  })
  listed[0] = { ...A1, status: 'completed' }

  const ui = await $.ui.mount({ ...PANE(), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /app\/middleware/ }))?.text).toBe('It lives in app/middleware/auth.ts')
  expect((await ui.find({ type: 'Text', text: /1 done/ }))?.text).toBe('✓ 1 done')
  // Unfolded: the call it made, and its whole answer.
  await ui.press({ key: 'select-a1' })
  expect((await ui.find({ type: 'Text', text: /^Bash Run the tests$/ }))).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /wired in server/ }))).toBeDefined()
  expect(await ui.find({ key: 'view-a1' })).toBeDefined()
  // Cleared, it is gone.
  await ui.press({ key: 'clear-finished' })
  expect(await ui.find({ type: 'Text', text: /No subagents yet/ })).toBeDefined()
  await ui.unmount()

  expect(toasts).toContain('Agent done · Explore: Find the auth middleware · 12s')
  expect(status.at(-1)).toBeUndefined()
})

test('an agent the mod never saw start joins from the engine\'s list', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  engine(on, [{ id: 'old', type: 'coder-fleet:scout', description: 'Map the hooks', status: 'waiting', name: 'scout' }])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // Nothing live: the list is checked every fifth tick.
  await clock.advance(5_000)
  const ui = await $.ui.mount({ ...PANE(), surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Map the hooks/ }))).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /@scout/ }))).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /waiting on background work/ }))).toBeDefined()
  await ui.unmount()
})

test('a failed agent toasts even at the failures level, and children nest under their parent', async ($, on) => {
  mock.clock(on, { now: 0 })
  let n = 0
  const { toasts } = engine(on, [], () => `k${++n}`)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ ...SPAWN, description: 'Lead the work', subagentType: 'general-purpose' })
  await $.agent.spawn({ ...SPAWN, description: 'Read the spec', parentAgentId: 'k1' })
  await $.turn.complete({ answer: 'API error', durationMs: 1, isAborted: false, turnId: 'y', reason: 'error', agentId: 'k2' })
  expect(toasts).toContain('Agent failed · Explore: Read the spec · 0s')
  const ui = await $.ui.mount({ ...PANE(), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '└' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /2 started|1 failed/ }))?.text).toBe('✗ 1 failed')
  await ui.unmount()
})
