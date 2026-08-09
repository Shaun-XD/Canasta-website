import { describe, expect, it } from 'vitest'
import type { Team } from '../types/game'
import { performDiscard, performDrawFromStock, performTopTouch } from './turnEngine'
import { buildSet } from './meldValidation'
import { initialPozzettoState } from './pozzetto'
import { c } from './testHelpers'

function makeTeam(id: 'team-a' | 'team-b'): Team {
  return {
    id,
    name: id,
    playerIds: [],
    melds: [],
    score: 0,
    hasGoneOut: false,
    pozzetto: initialPozzettoState(),
  }
}

describe('performDrawFromStock', () => {
  it('moves the top card from stock to hand', () => {
    const stock = [c('3', 'hearts'), c('4', 'hearts')]
    const result = performDrawFromStock(stock, [])
    expect(result.hand.length).toBe(1)
    expect(result.stock.length).toBe(1)
    expect(result.drawnCard).not.toBeNull()
  })

  it('returns unchanged state when stock is empty', () => {
    const result = performDrawFromStock([], [c('3', 'hearts')])
    expect(result.drawnCard).toBeNull()
    expect(result.hand.length).toBe(1)
  })
})

describe('performTopTouch', () => {
  it('succeeds when the top card completes a new meld with hand cards', () => {
    const team = makeTeam('team-a')
    const hand = [c('8', 'hearts'), c('8', 'spades')]
    const discardPile = [c('A', 'hearts'), c('8', 'clubs')]

    const result = performTopTouch({
      hand,
      discardPile,
      team,
      opposingTeamId: 'team-b',
      plan: { kind: 'newSet', handCardIds: [hand[0].id, hand[1].id] },
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.melds.length).toBe(1)
      expect(result.melds[0].slots.length).toBe(3)
      // The rest of the pile (everything except the top card) goes to hand.
      expect(result.hand.length).toBe(1)
      expect(result.discardPile.length).toBe(0)
    }
  })

  it('succeeds when the top card is appended to an existing team meld', () => {
    const existing = buildSet([c('9', 'hearts'), c('9', 'spades'), c('9', 'clubs')], 'team-a')
    if (!existing.ok) throw new Error('setup failed')
    const team: Team = { ...makeTeam('team-a'), melds: [existing.meld] }

    const result = performTopTouch({
      hand: [],
      discardPile: [c('A', 'hearts'), c('9', 'diamonds')],
      team,
      opposingTeamId: 'team-b',
      plan: { kind: 'append', targetMeldId: existing.meld.id },
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.melds[0].slots.length).toBe(4)
      expect(result.hand.length).toBe(1) // rest of pile drawn into hand
    }
  })

  it('fails and awards +150 penalty to the opposing team when the top card cannot be played', () => {
    const team = makeTeam('team-a')
    const hand = [c('3', 'hearts'), c('5', 'spades')]
    const discardPile = [c('K', 'clubs')]

    const result = performTopTouch({
      hand,
      discardPile,
      team,
      opposingTeamId: 'team-b',
      plan: { kind: 'newSet', handCardIds: [hand[0].id, hand[1].id] },
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.penaltyTeamId).toBe('team-b')
      // Cards are returned to the discard pile untouched.
      expect(result.discardPile).toEqual(discardPile)
    }
  })

  it('fails when attempting to append to a meld the team does not own', () => {
    const team = makeTeam('team-a')
    const result = performTopTouch({
      hand: [],
      discardPile: [c('5', 'hearts')],
      team,
      opposingTeamId: 'team-b',
      plan: { kind: 'append', targetMeldId: 'nonexistent' },
    })
    expect(result.success).toBe(false)
  })
})

describe('performDiscard', () => {
  it('removes the card from hand and appends it to the discard pile', () => {
    const hand = [c('3', 'hearts'), c('4', 'spades')]
    const result = performDiscard(hand, hand[0].id, [])
    expect(result).not.toBeNull()
    expect(result?.hand.length).toBe(1)
    expect(result?.discardPile.length).toBe(1)
    expect(result?.handSizeBeforeDiscard).toBe(2)
  })

  it('returns null for a card not in hand', () => {
    const result = performDiscard([], 'missing', [])
    expect(result).toBeNull()
  })
})
