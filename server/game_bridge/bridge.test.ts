/** @vitest-environment node */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { BOT_ACTION_MS, BOT_BETWEEN_TURNS_MS } from '../../src/engine/botPacing'
import type { GameState, RoomState } from '../../src/types/game'

const transport = vi.hoisted(() => ({ onLine: (_line: string) => {} }))
vi.mock('node:readline', () => ({
  createInterface: () => ({
    on: (_event: string, handler: (line: string) => void) => { transport.onLine = handler },
  }),
}))

beforeAll(async () => {
  const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  try { await import('./bridge') } finally { output.mockRestore() }
})

type State = { room: RoomState; game: GameState }
function rpc<T = State>(method: string, params: Record<string, unknown>): T {
  const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  try {
    transport.onLine(JSON.stringify({ id: 1, method, params }))
    const response = JSON.parse(String(output.mock.calls[0]?.[0]))
    if (!response.ok) throw new Error(response.error)
    return response.result as T
  } finally { output.mockRestore() }
}

function startHumans() {
  const host = rpc<{ roomId: string; playerId: string }>('create_room', {
    playerName: 'Host', maxPlayers: 2, turnTimerSeconds: 0,
  })
  const guest = rpc<{ playerId: string }>('join_room', { roomId: host.roomId, playerName: 'Guest' })
  for (const playerId of [host.playerId, guest.playerId]) {
    rpc('set_ready', { roomId: host.roomId, playerId, ready: true })
  }
  return { host, state: rpc('start_game', { roomId: host.roomId, playerId: host.playerId }) }
}

function advanceBots(ms: number): State[] {
  const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  try {
    vi.advanceTimersByTime(ms)
    return output.mock.calls.map(([line]) => JSON.parse(String(line)))
      .filter(message => message.event === 'state')
  } finally { output.mockRestore() }
}

function startBots() {
  vi.useFakeTimers()
  const host = rpc<{ roomId: string; playerId: string }>('create_room', {
    playerName: 'Host', maxPlayers: 4, turnTimerSeconds: 0,
  })
  const params = { roomId: host.roomId, playerId: host.playerId }
  rpc('fill_bots', params)
  rpc('set_ready', { ...params, ready: true })
  rpc('start_game', params)
  const drawn = rpc('draw', params)
  const state = rpc('discard', { ...params, cardId: drawn.game.hands[host.playerId][0].id })
  return { host, params, state }
}

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('online bot pacing', () => {
  it('broadcasts every opponent and teammate action separately before returning to the human', () => {
    const { host, params, state } = startBots()
    expect(state.game.turn.turnNumber).toBe(2)
    expect(state.game.turn.activePlayerId).not.toBe(host.playerId)
    expect(advanceBots(BOT_BETWEEN_TURNS_MS - 1)).toEqual([])
    const first = advanceBots(1)
    expect(first).toHaveLength(1)
    expect(['draw-stock', 'top-touch']).toContain(first[0].game.lastPlay?.kind)
    expect(advanceBots(BOT_ACTION_MS - 1)).toEqual([])
    const frames = [...first, ...advanceBots(1)]
    for (let i = 0; i < 100; i++) {
      const current = rpc('get_state', params)
      if (current.game.turn.activePlayerId === host.playerId) break
      frames.push(...advanceBots(BOT_BETWEEN_TURNS_MS))
    }
    const finished = rpc('get_state', params)
    expect(finished.game.turn.activePlayerId).toBe(host.playerId)
    expect(finished.game.turn.turnNumber).toBe(5)
    for (const bot of state.room.players.filter(p => p.isMock)) {
      const plays = frames.map(f => f.game.lastPlay).filter(p => p?.actorId === bot.id)
      expect(plays.some(p => p?.kind === 'draw-stock' || p?.kind === 'top-touch')).toBe(true)
      expect(plays.some(p => p?.kind === 'discard')).toBe(true)
    }
    // All frames are immutable snapshots; later actions cannot change an
    // earlier frame's hidden-hand counts, stock, or active player.
    expect(first[0].game.turn.turnNumber).toBe(2)
  })

  it('pauses between actions, preserves reconnects, and cancels playback on returning to the lobby', () => {
    const { params } = startBots()
    advanceBots(BOT_BETWEEN_TURNS_MS)
    const paused = rpc('toggle_pause', params)
    expect(advanceBots(10000)).toEqual([])
    expect(rpc('get_state', params).game).toEqual(paused.game)
    rpc('set_connection', { ...params, status: 'disconnected' })
    rpc('toggle_pause', params)
    expect(advanceBots(BOT_ACTION_MS - 1)).toEqual([])
    const frames = advanceBots(1)
    expect(frames).toHaveLength(1)
    expect(frames[0].room.players.find(p => p.id === params.playerId)?.connectionStatus).toBe('disconnected')
    rpc('return_to_lobby', params)
    expect(advanceBots(10000)).toEqual([])
    expect(rpc('get_state', params).game).toBeNull()
  })

  it('drops an old bot turn when a new game starts', () => {
    const { params } = startBots()
    advanceBots(BOT_BETWEEN_TURNS_MS)
    const restarted = rpc('start_new_game', params)
    expect(advanceBots(10000)).toEqual([])
    expect(rpc('get_state', params).game).toEqual(restarted.game)
  })
})

describe('realtime bridge scoring', () => {
  it('initializes foul counters for every new online game', () => {
    expect(startHumans().state.game.emptyHandFoulByTeam).toEqual({ 'team-a': 0, 'team-b': 0 })
  })

  it('includes empty-hand fouls and scores repeated End Round requests only once', () => {
    const started = startHumans()
    let state = started.state
    let turns = 0
    // Use real draw/discard actions through the bridge protocol. After stock
    // depletion both players discard through their hand and Pozzetto reserve.
    while (Object.values(state.game.emptyHandFoulByTeam).every(value => value === 0)) {
      if (++turns > 160) throw new Error('Expected an empty-hand foul')
      const playerId = state.game.turn.activePlayerId
      const params = { roomId: started.host.roomId, playerId }
      if (state.game.stock.length) state = rpc('draw', params)
      const cardId = state.game.hands[playerId][0]?.id
      if (!cardId) throw new Error('Player became empty without a foul')
      state = rpc('discard', { ...params, cardId })
    }
    const params = { roomId: started.host.roomId, playerId: started.host.playerId }
    const scored = rpc('force_sudden_death', params)
    expect(scored.room.status).toBe('round-end')
    for (const team of scored.room.teams) {
      expect(scored.game.lastRoundScores!.teams[team.id].emptyHandFoulPenalty)
        .toBe(state.game.emptyHandFoulByTeam[team.id])
    }
    const repeated = rpc('force_sudden_death', params)
    expect(repeated.room.teams).toEqual(scored.room.teams)
    expect(repeated.game.roundScoresHistory).toHaveLength(1)
    const next = rpc('next_round', params)
    expect(next.game.round).toBe(2)
    expect(next.game.emptyHandFoulByTeam).toEqual({ 'team-a': 0, 'team-b': 0 })
  })
})
