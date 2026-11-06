import { describe, expect, test } from 'claude-code/testing'
import {
  callEnded, callLabel, callStarted, duration, LIST_LAG_MS, ordered, reconcile, spawned, statusLine, turnEnded,
} from '../hooks/roster'

describe('roster logic', () => {
  test('a call reads as the tool and what it is about', () => {
    expect(callLabel('Bash', { command: 'npm test', description: 'Run the tests' })).toBe('Bash Run the tests')
    expect(callLabel('Bash', { command: 'ls  -la\n /tmp' })).toBe('Bash ls -la /tmp')
    expect(callLabel('Read', { file_path: '/repo/app/middleware/auth.ts' })).toBe('Read auth.ts')
    expect(callLabel('Grep', { pattern: 'useAuth' })).toBe('Grep "useAuth"')
    expect(callLabel('WebFetch', { url: 'https://docs.example.com/a/b' })).toBe('WebFetch docs.example.com')
    expect(callLabel('mcp__github__create_issue', {})).toBe('github:create_issue')
  })

  test('durations read short', () => {
    expect(duration(4_200)).toBe('4s')
    expect(duration(65_000)).toBe('1m 05s')
    expect(duration(3_780_000)).toBe('1h 03m')
  })

  test('children nest under their parent; live roots before finished ones', () => {
    let list = spawned([], { id: 'old', type: 'Explore', description: 'old' }, 0)
    list = turnEnded(list, 'old', { reason: 'answer', answer: 'done' }, 10)
    list = spawned(list, { id: 'lead', type: 'general-purpose', description: 'lead' }, 20)
    list = spawned(list, { id: 'kid', type: 'Explore', description: 'kid', parentId: 'lead' }, 30)
    expect(ordered(list, true).map(r => `${r.depth}:${r.agent.id}`)).toEqual(['0:lead', '1:kid', '0:old'])
    expect(ordered(list, false).map(r => r.agent.id)).toEqual(['lead', 'kid'])
  })

  test('a call moves from doing to recent, and an error counts', () => {
    let list = spawned([], { id: 'a', type: 'Explore', description: 'x' }, 0)
    list = callStarted(list, 'a', { id: 't1', label: 'Bash ls', at: 5 }, 5)
    expect(list[0]?.doing.map(c => c.label)).toEqual(['Bash ls'])
    expect(statusLine(list)).toBe('roster · 1 running · Explore: Bash ls')
    list = callEnded(list, 'a', 't1', true, 9)
    expect(list[0]?.doing).toEqual([])
    expect(list[0]?.recent[0]).toEqual({ id: 't1', label: 'Bash ls', at: 5, endedAt: 9, isError: true })
    expect(list[0]?.errors).toBe(1)
  })

  test("the engine's list wins, except just after an end it has not caught up with", () => {
    let list = spawned([], { id: 'a', type: 'Explore', description: 'x' }, 0)
    list = turnEnded(list, 'a', { reason: 'answer', answer: 'ok' }, 1000)
    const stillRunning = [{ id: 'a', type: 'Explore', description: 'x', status: 'running' as const }]
    expect(reconcile(list, stillRunning, 1000 + LIST_LAG_MS - 1)[0]?.status).toBe('completed')
    // Resumed meanwhile: the list says so once the lag is past.
    expect(reconcile(list, stillRunning, 1000 + LIST_LAG_MS + 1)[0]?.status).toBe('running')
    // A teammate that answered is idle, not done.
    const team = turnEnded(spawned([], { id: 't', type: 'teammate', isTeammate: true }, 0), 't', { reason: 'answer', answer: '' }, 5)
    expect(team[0]?.status).toBe('idle')
    // Dropped from the list while live: over.
    const gone = reconcile(spawned([], { id: 'b', type: 'Explore' }, 0), [], LIST_LAG_MS + 1)
    expect(gone[0]?.status).toBe('completed')
  })
})
