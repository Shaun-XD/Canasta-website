/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { shouldRetryOnlineAction, shouldSkipOnlineSnapshot } from './onlineInvariants'
import type { GameState } from '../types/game'

function game(partial: Partial<GameState> & Pick<GameState, 'stock' | 'hands'>): GameState {
  return {
    roomId: 'ABCDE',
    discardPile: { cards: [] },
    pozzettoStacks: { 'team-a': [], 'team-b': [] },
    turn: {
      activePlayerId: 'p1',
      phase: 'draw',
      turnNumber: 1,
      hasDrawnThisTurn: false,
      startedAt: 0,
      isPaused: false,
      pausedAt: null,
    },
    round: 1,
    roundScoresHistory: [],
    lastRoundScores: null,
    pendingSlide: null,
    lastTopTouchFailure: null,
    gameOverTeamId: null,
    lastAcquired: null,
    lastPlay: null,
    emptyHandFoulByTeam: { 'team-a': 0, 'team-b': 0 },
    ...partial,
  }
}

const play = { at: 1000, actorId: 'p1', kind: 'draw-stock' as const, cardIds: [], fromDiscardIds: [], count: 1 }

describe('shouldRetryOnlineAction', () => {
  it('retries only when the socket lost its room mapping', () => {
    expect(shouldRetryOnlineAction('Not in a room.')).toBe(true)
  })

  it('does not retry timeouts (successful stock draw + retry → Already drew)', () => {
    expect(shouldRetryOnlineAction('operation has timed out')).toBe(false)
    expect(shouldRetryOnlineAction('The server did not respond')).toBe(false)
    expect(shouldRetryOnlineAction('Lost connection to the server')).toBe(false)
  })
})

describe('shouldSkipOnlineSnapshot', () => {
  it('does not skip a stock draw when stock shrinks or the local hand grows', () => {
    const prev = game({
      stock: [{ id: 's1', rank: '4', suit: 'clubs' }],
      hands: { p1: [] },
      lastPlay: play,
    })
    const next = game({
      stock: [],
      hands: { p1: [{ id: 's1', rank: '4', suit: 'clubs' }] },
      lastPlay: play,
      lastAcquired: { playerId: 'p1', cardIds: ['s1'], at: 1000 },
      turn: { ...prev.turn, phase: 'action', hasDrawnThisTurn: true },
    })
    expect(shouldSkipOnlineSnapshot({ prevGame: prev, nextGame: next, localPlayerId: 'p1' })).toBe(false)
  })

  it('skips a true duplicate ack+broadcast of the same lastPlay with no pile change', () => {
    const prev = game({
      stock: [{ id: 's1', rank: '4', suit: 'clubs' }],
      hands: { p1: [{ id: 'c1', rank: '5', suit: 'hearts' }] },
      lastPlay: play,
    })
    expect(shouldSkipOnlineSnapshot({ prevGame: prev, nextGame: prev, localPlayerId: 'p1' })).toBe(true)
  })

  it('does not skip when a wild-slide prompt appears (same lastPlay)', () => {
    const prev = game({
      stock: [{ id: 's1', rank: '4', suit: 'clubs' }],
      hands: { p1: [{ id: 'c1', rank: '6', suit: 'diamonds' }] },
      lastPlay: play,
      pendingSlide: null,
    })
    const next = {
      ...prev,
      pendingSlide: { teamId: 'team-a' as const, meldId: 'm1', displacedWildCardId: 'w1' },
    }
    expect(shouldSkipOnlineSnapshot({ prevGame: prev, nextGame: next, localPlayerId: 'p1' })).toBe(false)
  })

  it('does not skip when lastPlay is missing (guest fallback path)', () => {
    const prev = game({ stock: [{ id: 's1', rank: '4', suit: 'clubs' }], hands: { p1: [] } })
    const next = { ...prev, stock: [] as GameState['stock'] }
    expect(shouldSkipOnlineSnapshot({ prevGame: prev, nextGame: next, localPlayerId: 'p1' })).toBe(false)
  })
})
