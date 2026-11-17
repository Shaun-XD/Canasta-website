/** @vitest-environment node */
import { beforeAll, describe, expect, it, vi } from 'vitest'
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
