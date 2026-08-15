import { describe, expect, it } from 'vitest'
import type { Team } from '../types/game'
import {
  attemptMeldAction,
  performDiscard,
  performDrawFromStock,
  performTopTouch,
  topDiscardMustBePlayed,
} from './turnEngine'
import { buildSequence, buildSet } from './meldValidation'
import { initialPozzettoState } from './pozzetto'
import { c, joker } from './testHelpers'

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

describe('attemptMeldAction (the unified "Meld" action - items 3, 5 & 8)', () => {
  it('creates a new Set from hand cards alone, auto-detecting the type', () => {
    const team = makeTeam('team-a')
    const hand = [c('8', 'hearts'), c('8', 'spades'), c('8', 'clubs')]
    const result = attemptMeldAction({
      hand,
      team,
      selectedHandCardIds: hand.map((card) => card.id),
      targetMeldId: null,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.kind).toBe('new-meld')
      expect(result.meld.type).toBe('set')
      expect(result.hand.length).toBe(0)
    }
  })

  it('creates a new Sequence from hand cards alone, auto-detecting the type', () => {
    const team = makeTeam('team-a')
    const hand = [c('5', 'diamonds'), c('6', 'diamonds'), c('7', 'diamonds')]
    const result = attemptMeldAction({
      hand,
      team,
      selectedHandCardIds: hand.map((card) => card.id),
      targetMeldId: null,
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.meld.type).toBe('sequence')
  })

  it('rejects a new-meld attempt with fewer than 3 candidate cards', () => {
    const team = makeTeam('team-a')
    const hand = [c('8', 'hearts'), c('8', 'spades')]
    const result = attemptMeldAction({
      hand,
      team,
      selectedHandCardIds: hand.map((card) => card.id),
      targetMeldId: null,
    })
    expect(result.ok).toBe(false)
  })

  it('appends selected hand cards to a targeted existing meld group', () => {
    const existing = buildSet([c('9', 'hearts'), c('9', 'spades'), c('9', 'clubs')], 'team-a')
    if (!existing.ok) throw new Error('setup failed')
    const team: Team = { ...makeTeam('team-a'), melds: [existing.meld] }
    const hand = [c('9', 'diamonds')]

    const result = attemptMeldAction({
      hand,
      team,
      selectedHandCardIds: [hand[0].id],
      targetMeldId: existing.meld.id,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.kind).toBe('append')
      expect(result.meld.slots.length).toBe(4)
      expect(result.hand.length).toBe(0)
    }
  })

  it('proposes a meld combining the top discard card with selected hand cards into a new meld', () => {
    const team = makeTeam('team-a')
    const hand = [c('8', 'hearts'), c('8', 'spades')]
    const discardPile = [c('A', 'hearts'), c('8', 'clubs')]
    const topCard = discardPile[discardPile.length - 1]

    const result = attemptMeldAction({
      hand,
      team,
      selectedHandCardIds: hand.map((card) => card.id),
      targetMeldId: null,
      topTouch: { discardPile, selectedDiscardIds: [topCard.id] },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.meld.slots.length).toBe(3)
      // The Top Touch card itself is never part of `hand` - only the
      // selected hand cards are removed from it.
      expect(result.hand.length).toBe(0)
      expect(result.usedDiscardCards.map((card) => card.id)).toEqual([topCard.id])
    }
  })

  it('proposes a meld combining the top discard card into a targeted existing meld', () => {
    const existing = buildSet([c('9', 'hearts'), c('9', 'spades'), c('9', 'clubs')], 'team-a')
    if (!existing.ok) throw new Error('setup failed')
    const team: Team = { ...makeTeam('team-a'), melds: [existing.meld] }
    const discardPile = [c('A', 'hearts'), c('9', 'diamonds')]
    const topCard = discardPile[discardPile.length - 1]

    const result = attemptMeldAction({
      hand: [],
      team,
      selectedHandCardIds: [],
      targetMeldId: existing.meld.id,
      topTouch: { discardPile, selectedDiscardIds: [topCard.id] },
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.meld.slots.length).toBe(4)
  })

  it('fails without granting/consuming anything when the proposed Top Touch combination is illegal', () => {
    const team = makeTeam('team-a')
    const hand = [c('3', 'hearts'), c('5', 'spades')]
    const discardPile = [c('K', 'clubs')]

    const result = attemptMeldAction({
      hand,
      team,
      selectedHandCardIds: hand.map((card) => card.id),
      targetMeldId: null,
      topTouch: { discardPile, selectedDiscardIds: [discardPile[0].id] },
    })
    expect(result.ok).toBe(false)
  })

  it('builds a legal Set from the top discard card + a second (non-top) discard card + a hand card (the user-reported 5♦/5♣ scenario)', () => {
    const team = makeTeam('team-a')
    // Pile, top-down (most recent last): ... 5♦, 5♣ - i.e. 5♣ is the actual
    // top/most-recent card, with 5♦ sitting just behind it.
    const discardPile = [c('K', 'diamonds'), c('K', 'hearts'), c('5', 'diamonds'), c('5', 'clubs')]
    const hand = [c('5', 'diamonds')]

    const result = attemptMeldAction({
      hand,
      team,
      selectedHandCardIds: [hand[0].id],
      targetMeldId: null,
      topTouch: {
        discardPile,
        selectedDiscardIds: [discardPile[2].id, discardPile[3].id], // 5♦ + 5♣, contiguous from the top
      },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.kind).toBe('new-meld')
      expect(result.meld.type).toBe('set')
      expect(result.meld.rank).toBe('5')
      expect(result.meld.slots.length).toBe(3)
      expect(result.usedDiscardCards.map((card) => card.id)).toEqual([discardPile[2].id, discardPile[3].id])
      // Both discard cards are consumed by the meld directly - neither ever
      // passes through `hand`.
      expect(result.hand.length).toBe(0)
    }
  })

  it('rejects a Top Touch selection that does not include the top/most-recent discard card', () => {
    const team = makeTeam('team-a')
    const discardPile = [c('K', 'diamonds'), c('K', 'hearts'), c('5', 'diamonds'), c('5', 'clubs')]
    const hand = [c('5', 'diamonds')]

    const result = attemptMeldAction({
      hand,
      team,
      selectedHandCardIds: [hand[0].id],
      targetMeldId: null,
      // Only the second-from-top card is selected - the actual top card
      // (5♣) is missing, which must be rejected even though 5♦+5♦ alone
      // would otherwise be a legal pair-toward-a-set.
      topTouch: { discardPile, selectedDiscardIds: [discardPile[2].id] },
    })
    expect(result.ok).toBe(false)
  })

  it('topDiscardMustBePlayed encodes the Top Touch top-card invariant', () => {
    const pile = [c('3', 'hearts'), c('9', 'spades')]
    expect(topDiscardMustBePlayed(pile, [pile[0].id]).ok).toBe(false)
    expect(topDiscardMustBePlayed(pile, [pile[1].id]).ok).toBe(true)
    expect(topDiscardMustBePlayed(pile, [pile[0].id, pile[1].id]).ok).toBe(true)
  })

  it('allows a non-contiguous Top Touch discard selection (e.g. two 6s with a gap) when the top card is included', () => {
    const team = makeTeam('team-a')
    // Pile oldest→newest: 6♠, 9♥, 6♣ (top). Player wants both 6s + joker,
    // skipping the 9 in between.
    const discardPile = [c('6', 'spades'), c('9', 'hearts'), c('6', 'clubs')]
    const hand = [joker()]

    const result = attemptMeldAction({
      hand,
      team,
      selectedHandCardIds: [hand[0].id],
      targetMeldId: null,
      topTouch: { discardPile, selectedDiscardIds: [discardPile[0].id, discardPile[2].id] },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.kind).toBe('new-meld')
      expect(result.meld.type).toBe('set')
      expect(result.meld.rank).toBe('6')
      expect(result.usedDiscardCards.map((card) => card.id)).toEqual([discardPile[0].id, discardPile[2].id])
    }
  })

  it('performs a wild-swap via the Slide mechanic when appending a natural card that matches a wild-filled slot', () => {
    const built = buildSequence([c('5', 'diamonds'), joker(), c('7', 'diamonds')], 'team-a')
    if (!built.ok) throw new Error('setup failed')
    const displacedWild = built.meld.slots.find((s) => s.isWildFill)!.card
    const team: Team = { ...makeTeam('team-a'), melds: [built.meld] }
    const natural6 = c('6', 'diamonds')

    // A single natural hand-card append (no Top Touch card involved) still
    // surfaces the slide-choice prompt rather than silently auto-resolving.
    const proposal = attemptMeldAction({
      hand: [natural6],
      team,
      selectedHandCardIds: [natural6.id],
      targetMeldId: built.meld.id,
    })
    expect(proposal.ok).toBe(false)
    if (proposal.ok) return
    expect(proposal.needsSlideChoice?.displacedWildCardId).toBe(displacedWild.id)

    const resolved = attemptMeldAction({
      hand: [natural6],
      team,
      selectedHandCardIds: [natural6.id],
      targetMeldId: built.meld.id,
      slideEdge: 'top',
    })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    const sixSlot = resolved.meld.slots.find((s) => s.slotRank === '6')
    expect(sixSlot?.isWildFill).toBe(false)
    // The freed wild stays in the meld, now sitting at an edge - ready to
    // be repositioned via Move Wild (item 7, Sets only).
    const wildStillPresent = resolved.meld.slots.some((s) => s.card.id === displacedWild.id)
    expect(wildStillPresent).toBe(true)
  })

  it('appends several cards onto a canasta even if selected high-then-low', () => {
    const built = buildSequence(
      [c('5', 'spades'), c('6', 'spades'), c('7', 'spades'), c('8', 'spades'), c('9', 'spades'), c('10', 'spades'), c('J', 'spades')],
      'team-a',
    )
    if (!built.ok) throw new Error('setup failed')
    const queen = c('Q', 'spades')
    const king = c('K', 'spades')
    const team: Team = { ...makeTeam('team-a'), melds: [built.meld] }
    const result = attemptMeldAction({
      hand: [king, queen],
      team,
      selectedHandCardIds: [king.id, queen.id],
      targetMeldId: built.meld.id,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.meld.slots.map((s) => s.slotRank)).toEqual(['5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'])
    expect(result.hand).toEqual([])
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
