import { describe, expect, it } from 'vitest'
import {
  AI_WEIGHTS,
  planAiAppends,
  planAiDraw,
  planAiMelds,
  planAiTurn,
  pickAiDiscard,
  scoreNewMeld,
  scoreTopTouchUnlock,
} from './aiPlayer'
import { buildSequence, buildSet } from './meldValidation'
import { c, joker } from './testHelpers'
describe('scoreNewMeld (plus-sum)', () => {
  it('scores larger / higher-point melds higher', () => {
    const small = [c('5', 'hearts'), c('5', 'spades'), c('5', 'clubs')]
    const big = [c('K', 'hearts'), c('K', 'spades'), c('K', 'clubs'), c('K', 'diamonds')]
    expect(scoreNewMeld(big)).toBeGreaterThan(scoreNewMeld(small))
  })

  it('penalizes spending a wild relative to an all-natural meld of the same size', () => {
    const natural = [c('8', 'hearts'), c('8', 'spades'), c('8', 'clubs')]
    const withWild = [c('8', 'hearts'), c('8', 'spades'), joker()]
    expect(scoreNewMeld(natural)).toBeGreaterThan(scoreNewMeld(withWild))
    expect(scoreNewMeld(withWild)).toBeGreaterThan(0)
  })
})

describe('planAiMelds — always meld when legal', () => {
  it('lays a natural set of 3+', () => {
    const hand = [c('9', 'hearts'), c('9', 'spades'), c('9', 'clubs'), c('3', 'diamonds')]
    const { plans, remainingHand } = planAiMelds(hand, 'team-a')
    expect(plans).toHaveLength(1)
    expect(plans[0].kind).toBe('set')
    expect(plans[0].cardIds).toHaveLength(3)
    expect(remainingHand).toHaveLength(1)
  })

  it('lays a same-suit sequence when available', () => {
    const hand = [c('5', 'clubs'), c('6', 'clubs'), c('7', 'clubs'), c('A', 'hearts')]
    const { plans } = planAiMelds(hand, 'team-a')
    expect(plans.some((p) => p.kind === 'sequence')).toBe(true)
  })

  it('prefers an all-natural set over the same set that burns a wild', () => {
    const hand = [
      c('10', 'hearts'),
      c('10', 'spades'),
      c('10', 'clubs'),
      c('10', 'diamonds'),
      joker(),
    ]
    const { plans } = planAiMelds(hand, 'team-a')
    expect(plans.length).toBeGreaterThanOrEqual(1)
    // First lay should be the four naturals (or at least not require the joker).
    const first = plans[0]
    expect(first.cardIds).not.toContain(hand[4].id)
  })

  it('uses a wild to complete a set when naturals alone are insufficient', () => {
    const hand = [c('Q', 'hearts'), c('Q', 'spades'), joker(), c('4', 'clubs')]
    const { plans } = planAiMelds(hand, 'team-a')
    expect(plans).toHaveLength(1)
    expect(plans[0].cardIds).toContain(hand[2].id)
  })
})

describe('planAiMelds — merge same-rank sets', () => {
  it('does not open a second set of a rank the team already has (append instead)', () => {
    const existing = buildSet([c('Q', 'hearts'), c('Q', 'spades'), joker()], 'team-a')
    if (!existing.ok) throw new Error('setup')
    const hand = [c('Q', 'clubs'), c('Q', 'diamonds'), c('Q', 'hearts'), c('3', 'spades')]
    const { plans, remainingHand } = planAiMelds(hand, 'team-a', [existing.meld])
    expect(plans.filter((p) => p.kind === 'set')).toHaveLength(0)
    // Queens left in hand for appends.
    expect(remainingHand.filter((c) => c.rank === 'Q')).toHaveLength(3)
  })

  it('lays every natural of a rank in one set (never splits 5 Queens into two melds)', () => {
    const hand = [
      c('Q', 'hearts'),
      c('Q', 'spades'),
      c('Q', 'clubs'),
      c('Q', 'diamonds'),
      c('Q', 'hearts'),
      joker(),
    ]
    const { plans } = planAiMelds(hand, 'team-a', [])
    const queenSets = plans.filter((p) => p.kind === 'set')
    expect(queenSets).toHaveLength(1)
    expect(queenSets[0].cardIds).toHaveLength(5) // all naturals, joker conserved
  })

  it('holds a 9♠ for append onto an existing spade run instead of opening a set of 9s', () => {
    // Repro: 10-J-Q-(Joker as K)-A♠ on the table; hand has three 9s including 9♠.
    const run = buildSequence(
      [c('10', 'spades'), c('J', 'spades'), c('Q', 'spades'), joker(), c('A', 'spades')],
      'team-a',
    )
    if (!run.ok) throw new Error('setup')
    const nineS = c('9', 'spades')
    const hand = [c('9', 'diamonds'), c('9', 'hearts'), nineS, c('3', 'clubs')]
    const { plans, remainingHand } = planAiMelds(hand, 'team-a', [run.meld])
    expect(plans.filter((p) => p.kind === 'set')).toHaveLength(0)
    expect(remainingHand.some((card) => card.id === nineS.id)).toBe(true)

    const { plans: appends } = planAiAppends(remainingHand, [run.meld])
    expect(appends.some((p) => p.cardId === nineS.id && p.meldId === run.meld.id)).toBe(true)
  })

  it('prefers a longer sequence that absorbs 9♠ over opening a competing set of 9s', () => {
    // 9♠-10-J-Q is a better sequence than leaving 9♠ for a set with 9♦/9♥.
    const nineS = c('9', 'spades')
    const hand = [
      c('10', 'spades'),
      c('J', 'spades'),
      c('Q', 'spades'),
      c('9', 'diamonds'),
      c('9', 'hearts'),
      nineS,
    ]
    const { plans, remainingHand } = planAiMelds(hand, 'team-a', [])
    const seq = plans.find((p) => p.kind === 'sequence')
    expect(seq).toBeTruthy()
    expect(seq!.cardIds).toContain(nineS.id)
    expect(plans.filter((p) => p.kind === 'set')).toHaveLength(0)
    expect(remainingHand.filter((card) => card.rank === '9')).toHaveLength(2)
  })
})

describe('planAiAppends — feed existing melds', () => {
  it('appends a matching natural onto a team set', () => {
    const built = buildSet([c('7', 'hearts'), c('7', 'spades'), c('7', 'clubs')], 'team-a')
    if (!built.ok) throw new Error('setup')
    const hand = [c('7', 'diamonds'), c('3', 'spades')]
    const { plans, remainingHand } = planAiAppends(hand, [built.meld])
    expect(plans).toHaveLength(1)
    expect(plans[0].cardId).toBe(hand[0].id)
    expect(remainingHand.map((c) => c.id)).toEqual([hand[1].id])
  })

  it('prefers appending onto a longer meld (canasta progress)', () => {
    const short = buildSet([c('5', 'hearts'), c('5', 'spades'), c('5', 'clubs')], 'team-a')
    const long = buildSequence(
      [c('3', 'diamonds'), c('4', 'diamonds'), c('5', 'diamonds'), c('6', 'diamonds'), c('7', 'diamonds')],
      'team-a',
    )
    if (!short.ok || !long.ok) throw new Error('setup')
    // Card that can only append to the long diamond run.
    const hand = [c('8', 'diamonds')]
    const { plans } = planAiAppends(hand, [short.meld, long.meld])
    expect(plans).toHaveLength(1)
    expect(plans[0].meldId).toBe(long.meld.id)
  })

  it('Slides 7♠ into a wild-filled 7 slot instead of spending it on a new set of 7s', () => {
    // 6-★(2)-8-9-10♠ — natural 7♠ should Slide into the wild slot.
    // Other 7s may still open a set; 7♠ itself must be reserved for the run.
    const run = buildSequence(
      [c('6', 'spades'), c('2', 'hearts'), c('8', 'spades'), c('9', 'spades'), c('10', 'spades')],
      'team-a',
    )
    if (!run.ok) throw new Error('setup')
    const sevenS = c('7', 'spades')
    const hand = [sevenS, c('7', 'clubs'), c('7', 'diamonds'), c('7', 'hearts')]
    const melds = planAiMelds(hand, 'team-a', [run.meld])
    for (const plan of melds.plans) {
      expect(plan.cardIds).not.toContain(sevenS.id)
    }
    expect(melds.remainingHand.some((card) => card.id === sevenS.id)).toBe(true)
    const { plans } = planAiAppends(melds.remainingHand, [run.meld])
    expect(plans.some((p) => p.cardId === sevenS.id && p.meldId === run.meld.id)).toBe(true)
  })
})

describe('planAiDraw — Top Touch only when plus-sum positive', () => {
  it('draws from stock when the discard top does not unlock a meld', () => {
    const hand = [c('3', 'hearts'), c('8', 'spades'), c('J', 'clubs')]
    const pile = [c('K', 'diamonds')]
    const plan = planAiDraw(hand, [], pile, 'team-a')
    expect(plan.source).toBe('stock')
    expect(plan.score).toBe(0)
  })

  it('Top Touches to unlock when a deeper pile card can Slide onto an existing meld', () => {
    const run = buildSequence(
      [c('6', 'spades'), c('2', 'hearts'), c('8', 'spades'), c('9', 'spades'), c('10', 'spades')],
      'team-a',
    )
    if (!run.ok) throw new Error('setup')
    // Deep 7♠ feeds the wild slot; top is a junk card that still unlocks via hand set.
    const deepSeven = c('7', 'spades')
    const top = c('4', 'clubs')
    const pile = [deepSeven, c('3', 'hearts'), top]
    const hand = [c('4', 'hearts'), c('4', 'spades')] // unlock top as a set of 4s
    const plan = planAiDraw(hand, [run.meld], pile, 'team-a')
    expect(plan.source).toBe('top-touch')
    expect(plan.selectedDiscardIds).toContain(top.id)
    // Must leave 7♠ in the remainder (not burn it into the unlocking set).
    expect(plan.selectedDiscardIds).not.toContain(deepSeven.id)
  })

  it('Top Touches by Sliding 7♠ onto an existing run instead of opening a set of 7s', () => {
    const run = buildSequence(
      [c('6', 'spades'), c('2', 'hearts'), c('8', 'spades'), c('9', 'spades'), c('10', 'spades')],
      'team-a',
    )
    if (!run.ok) throw new Error('setup')
    const sevenS = c('7', 'spades')
    const hand = [c('7', 'clubs'), c('7', 'diamonds'), c('3', 'hearts')]
    const plan = planAiDraw(hand, [run.meld], [sevenS], 'team-a')
    expect(plan.source).toBe('top-touch')
    expect(plan.kind).toBe('append')
    expect(plan.targetMeldId).toBe(run.meld.id)
    expect(plan.selectedDiscardIds).toEqual([sevenS.id])
  })

  it('Top Touches when top discard + hand form a legal set', () => {
    const a = c('9', 'hearts')
    const b = c('9', 'spades')
    const top = c('9', 'clubs')
    const buried = c('4', 'diamonds')
    const plan = planAiDraw([a, b, c('2', 'hearts')], [], [buried, top], 'team-a')
    expect(plan.source).toBe('top-touch')
    expect(plan.kind).toBe('set')
    expect(plan.selectedDiscardIds).toContain(top.id)
    expect(plan.handCardIds).toEqual(expect.arrayContaining([a.id, b.id]))
    expect(plan.score).toBeGreaterThan(0)
  })

  it('Top Touches to append the top card onto an existing meld', () => {
    const built = buildSequence([c('5', 'spades'), c('6', 'spades'), c('7', 'spades')], 'team-a')
    if (!built.ok) throw new Error('setup')
    const top = c('8', 'spades')
    const plan = planAiDraw([c('3', 'hearts')], [built.meld], [top], 'team-a')
    expect(plan.source).toBe('top-touch')
    expect(plan.kind).toBe('append')
    expect(plan.targetMeldId).toBe(built.meld.id)
  })

  it('scores a rich remainder pile higher than a barren one for the same unlock', () => {
    const a = c('6', 'hearts')
    const b = c('6', 'spades')
    const top = c('6', 'clubs')
    const rich = scoreTopTouchUnlock({
      meldCards: [a, b, top],
      remainderPile: [c('3', 'diamonds'), c('4', 'diamonds'), c('5', 'diamonds')],
      kind: 'set',
    })
    const poor = scoreTopTouchUnlock({
      meldCards: [a, b, top],
      remainderPile: [],
      kind: 'set',
    })
    expect(rich).toBeGreaterThan(poor)
    expect(rich - poor).toBeGreaterThanOrEqual(3 * AI_WEIGHTS.pileRemainderCard)
  })
})

describe('pickAiDiscard', () => {
  it('avoids discarding wilds when a natural exists', () => {
    const hand = [joker(), c('4', 'clubs')]
    expect(pickAiDiscard(hand)?.rank).toBe('4')
  })

  it('prefers discarding a singleton over breaking a pair', () => {
    const pairA = c('K', 'hearts')
    const pairB = c('K', 'spades')
    const singleton = c('3', 'clubs')
    const pick = pickAiDiscard([pairA, pairB, singleton])
    expect(pick?.id).toBe(singleton.id)
  })
})

describe('planAiTurn', () => {
  it('plans meld + discard after a stock draw when no Top Touch is available', () => {
    const hand = [c('8', 'hearts'), c('8', 'spades'), c('8', 'clubs'), c('3', 'diamonds'), c('4', 'clubs')]
    const turn = planAiTurn(hand, [], [c('A', 'spades')], 'team-a')
    expect(turn.draw.source).toBe('stock')
    expect(turn.newMelds.length).toBeGreaterThanOrEqual(1)
    expect(turn.discardCardId).toBeTruthy()
  })

  it('plans Top Touch then further melds when the pile unlocks a set', () => {
    const hand = [c('5', 'hearts'), c('5', 'spades'), c('Q', 'clubs'), c('Q', 'diamonds'), c('Q', 'spades')]
    const top = c('5', 'clubs')
    const turn = planAiTurn(hand, [], [c('2', 'hearts'), top], 'team-a')
    expect(turn.draw.source).toBe('top-touch')
    // After picking up, the three Queens should still be planned as a meld.
    expect(turn.newMelds.some((p) => p.kind === 'set' && p.cardIds.length >= 3)).toBe(true)
  })
})

describe('engine legality still gates every plan', () => {
  it('never proposes a meld the rules engine would reject', () => {
    const hand = [
      c('3', 'hearts'),
      c('5', 'spades'),
      c('7', 'clubs'),
      c('9', 'diamonds'),
      joker(),
    ]
    const { plans } = planAiMelds(hand, 'team-a')
    for (const plan of plans) {
      const cards = hand.filter((c) => plan.cardIds.includes(c.id))
      const built =
        plan.kind === 'set' ? buildSet(cards, 'team-a') : buildSequence(cards, 'team-a')
      expect(built.ok).toBe(true)
    }
  })
})
