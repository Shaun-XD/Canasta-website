import { describe, expect, it } from 'vitest'
import {
  appendToMeld,
  appendToSet,
  buildSequence,
  buildSet,
  canAppendToMeld,
  canAppendToSet,
  getWildMoveInfo,
  moveWildEdgeInSet,
  moveWildInMeld,
  wildEdgeInSet,
} from './meldValidation'
import { c, joker } from './testHelpers'

describe('buildSet', () => {
  it('accepts 3 natural cards of the same rank', () => {
    const result = buildSet([c('8', 'hearts'), c('8', 'spades'), c('8', 'clubs')], 'team-a')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.meld.rank).toBe('8')
      expect(result.meld.wildCount).toBe(0)
      expect(result.meld.type).toBe('set')
    }
  })

  it('accepts 1 wild substituting for a missing natural', () => {
    const result = buildSet([c('8', 'hearts'), c('8', 'spades'), joker()], 'team-a')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.meld.wildCount).toBe(1)
  })

  it('rejects more than 1 wild card', () => {
    const result = buildSet([c('8', 'hearts'), joker(), joker()], 'team-a')
    expect(result.ok).toBe(false)
  })

  it('rejects 3 jokers alone (illegal opener)', () => {
    const result = buildSet([joker(), joker(), joker()], 'team-a')
    expect(result.ok).toBe(false)
  })

  it('rejects 2 jokers + one 2 (illegal opener)', () => {
    const result = buildSet([joker(), joker(), c('2', 'hearts')], 'team-a')
    expect(result.ok).toBe(false)
  })

  it('allows a "2s meld" of three natural 2s with no wild', () => {
    const result = buildSet([c('2', 'hearts'), c('2', 'spades'), c('2', 'clubs')], 'team-a')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.meld.rank).toBe('2')
      expect(result.meld.wildCount).toBe(0)
    }
  })

  it('allows a 2s meld with exactly 1 joker as wild', () => {
    const result = buildSet([c('2', 'hearts'), c('2', 'spades'), joker()], 'team-a')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.meld.wildCount).toBe(1)
  })

  it('rejects mixed ranks', () => {
    const result = buildSet([c('8', 'hearts'), c('9', 'spades'), c('8', 'clubs')], 'team-a')
    expect(result.ok).toBe(false)
  })

  it('allows a Joker to be appended as an extra wild to an existing set (subject to the 1-wild cap)', () => {
    const built = buildSet([c('8', 'hearts'), c('8', 'spades'), c('8', 'clubs')], 'team-a')
    if (!built.ok) throw new Error('setup failed')
    expect(canAppendToSet(built.meld, joker())).toBe(true)
    const appended = appendToSet(built.meld, joker())
    expect(appended.ok).toBe(true)
    if (appended.ok) expect(appended.meld.wildCount).toBe(1)
  })
})

describe('buildSequence', () => {
  it('accepts 3 consecutive same-suit naturals', () => {
    const result = buildSequence([c('5', 'diamonds'), c('6', 'diamonds'), c('7', 'diamonds')], 'team-a')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.meld.suit).toBe('diamonds')
      expect(result.meld.wildCount).toBe(0)
    }
  })

  it('fills a 1-rank gap with a single wild', () => {
    const result = buildSequence([c('5', 'diamonds'), joker(), c('7', 'diamonds')], 'team-a')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.meld.wildCount).toBe(1)
      expect(result.meld.slots.map((s) => s.slotRank)).toEqual(['5', '6', '7'])
    }
  })

  it('rejects a gap larger than 1 rank', () => {
    const result = buildSequence([c('5', 'diamonds'), joker(), c('8', 'diamonds')], 'team-a')
    expect(result.ok).toBe(false)
  })

  it('rejects mixed suits', () => {
    const result = buildSequence([c('5', 'diamonds'), c('6', 'hearts'), c('7', 'diamonds')], 'team-a')
    expect(result.ok).toBe(false)
  })

  it('rejects wild cards alone (illegal opener, no suit established)', () => {
    const result = buildSequence([joker(), joker(), joker()], 'team-a')
    expect(result.ok).toBe(false)
  })

  it('treats a same-suit 2 in its own slot as a natural, not a wild', () => {
    const result = buildSequence([c('A', 'clubs'), c('2', 'clubs'), c('3', 'clubs')], 'team-a')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.meld.wildCount).toBe(0)
  })

  it('treats an off-suit 2 as a wild substitute', () => {
    const result = buildSequence([c('5', 'diamonds'), c('2', 'hearts'), c('7', 'diamonds')], 'team-a')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.meld.wildCount).toBe(1)
      expect(result.meld.canBecomeLimpa).toBe(false)
    }
  })

  describe('a same-suit 2 that could be natural-in-slot OR a wild elsewhere', () => {
    it('treats 2♣+6♣+7♣ as a wild extending the run (natural-in-slot would leave a 3,4,5 gap)', () => {
      // Natural-in-slot forces naturals [2,6,7], a 3-rank gap - illegal. The
      // only legal reading is the 2♣ as a wild: naturals 6,7 have no
      // interior gap, so (per the existing open-end-extension preference,
      // shared with Jokers) the wild extends the top edge to 8, producing
      // the legal run 6-7-8.
      const result = buildSequence([c('2', 'clubs'), c('6', 'clubs'), c('7', 'clubs')], 'team-a')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.meld.slots.map((s) => s.slotRank)).toEqual(['6', '7', '8'])
        expect(result.meld.wildCount).toBe(1)
        const wildSlot = result.meld.slots.find((s) => s.isWildFill)
        expect(wildSlot?.slotRank).toBe('8')
        expect(wildSlot?.card.rank).toBe('2')
        expect(wildSlot?.card.suit).toBe('clubs')
        // Same-suit wild-fill 2 should not disqualify a future Limpa, same
        // as a plain natural gap-fill would behave once naturalized.
        expect(result.meld.canBecomeLimpa).toBe(true)
      }
    })

    it('treats 2♣+5♣+6♣ as a wild filling the gap-free run, extending down when at the low edge already', () => {
      // A more literal match for the "5-wild-6-7" style repro: naturals 5,6
      // with the 2♣ as wild extending upward to 7, since the existing
      // preference is "extend upward first".
      const result = buildSequence([c('2', 'clubs'), c('5', 'clubs'), c('6', 'clubs')], 'team-a')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.meld.wildCount).toBe(1)
        expect(result.meld.slots.map((s) => s.slotRank)).toEqual(['5', '6', '7'])
        const wildSlot = result.meld.slots.find((s) => s.isWildFill)
        expect(wildSlot?.card.rank).toBe('2')
      }
    })

    it('still prefers natural-in-own-slot when that is how a valid run is formed (2♣,3♣,4♣)', () => {
      const result = buildSequence([c('2', 'clubs'), c('3', 'clubs'), c('4', 'clubs')], 'team-a')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.meld.wildCount).toBe(0)
        expect(result.meld.slots.map((s) => s.slotRank)).toEqual(['2', '3', '4'])
      }
    })

    it('still prefers natural-in-own-slot for A♣,2♣,3♣', () => {
      const result = buildSequence([c('A', 'clubs'), c('2', 'clubs'), c('3', 'clubs')], 'team-a')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.meld.wildCount).toBe(0)
        expect(result.meld.slots.map((s) => s.slotRank)).toEqual(['A', '2', '3'])
      }
    })

    it('defaults to natural-in-slot when both interpretations would be legal (2♣ + 3♣,4♣ + Joker)', () => {
      // Natural-in-slot: naturals 2,3,4 (contiguous, no gap) + Joker extends
      // the open end to 5 -> legal. All-wild: naturals 3,4 + wildPool [2♣,
      // Joker] -> 2 wilds, illegal (only 1 wild allowed). So natural-in-slot
      // is actually the ONLY legal interpretation here, which also confirms
      // the fallback correctly leaves the default in place without a false
      // ambiguity crash.
      const result = buildSequence([c('2', 'clubs'), c('3', 'clubs'), c('4', 'clubs'), joker()], 'team-a')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.meld.wildCount).toBe(1)
        expect(result.meld.slots.map((s) => s.slotRank)).toEqual(['2', '3', '4', '5'])
        const wildSlot = result.meld.slots.find((s) => s.isWildFill)
        expect(wildSlot?.card.rank).toBe('JOKER')
      }
    })

    it('rejects a same-suit 2 plus naturals that cannot form a legal run under either interpretation', () => {
      // Natural-in-slot: naturals 2,9,10 -> gap of 6 ranks, illegal.
      // All-wild: naturals 9,10 + wildPool [2♣] -> no gap, wild must extend
      // an end, giving 9,10,11(2♣) - but rank 11 doesn't exist, so it tries
      // extending down to 8,9,10 - that IS a legal 3-span... use a case that
      // truly fails both ways instead: naturals 9,10 with 2 EXTRA same-suit
      // 2s (so wildPool always has 2+, always illegal).
      const result = buildSequence(
        [c('2', 'clubs'), c('2', 'clubs'), c('9', 'clubs'), c('10', 'clubs')],
        'team-a',
      )
      expect(result.ok).toBe(false)
    })

    it('rejects when even the wild interpretation leaves a gap too large', () => {
      // Natural-in-slot: naturals 2,9,K -> huge gap, illegal. All-wild:
      // naturals 9,K -> missing 10,11,12 (3 ranks), still too large a gap
      // even with the 2♣ as the sole wild. Neither interpretation is legal.
      const result = buildSequence([c('2', 'clubs'), c('9', 'clubs'), c('K', 'clubs')], 'team-a')
      expect(result.ok).toBe(false)
    })
  })

  describe('trailing/leading Joker extends an open end (no interior gap)', () => {
    it('accepts 2 contiguous naturals + a trailing Joker, filling the next-higher rank', () => {
      const result = buildSequence([c('4', 'clubs'), c('5', 'clubs'), joker()], 'team-a')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.meld.suit).toBe('clubs')
        expect(result.meld.wildCount).toBe(1)
        expect(result.meld.slots.map((s) => s.slotRank)).toEqual(['4', '5', '6'])
        const wildSlot = result.meld.slots.find((s) => s.isWildFill)
        expect(wildSlot?.slotRank).toBe('6')
        expect(wildSlot?.card.rank).toBe('JOKER')
      }
    })

    it('accepts another contiguous-naturals-plus-trailing-Joker combo (7,8 + Joker -> 9)', () => {
      const result = buildSequence([c('7', 'spades'), c('8', 'spades'), joker()], 'team-a')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.meld.slots.map((s) => s.slotRank)).toEqual(['7', '8', '9'])
      }
    })

    it('extends upward to Ace when the high end is open (Q,K + Joker -> Q,K,A)', () => {
      const result = buildSequence([c('Q', 'hearts'), c('K', 'hearts'), joker()], 'team-a')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.meld.slots.map((s) => s.slotRank)).toEqual(['Q', 'K', 'A'])
        const wildSlot = result.meld.slots.find((s) => s.isWildFill)
        expect(wildSlot?.slotRank).toBe('A')
      }
    })

    it('accepts a natural Q-K-A sequence (Ace high)', () => {
      const result = buildSequence([c('Q', 'spades'), c('K', 'spades'), c('A', 'spades')], 'team-a')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.meld.slots.map((s) => s.slotRank)).toEqual(['Q', 'K', 'A'])
        expect(result.meld.wildCount).toBe(0)
      }
    })

    it('still rejects wrapping K-A-3 (Ace cannot sit between King and a low rank)', () => {
      // K+A+2 same-suit can legally read as Q(wild)-K-A; K-A-3 cannot wrap.
      const result = buildSequence([c('K', 'spades'), c('A', 'spades'), c('3', 'spades')], 'team-a')
      expect(result.ok).toBe(false)
    })

    it('the Joker is exempt from the single-suit check (does not cause a false "must be a single suit" rejection)', () => {
      const result = buildSequence([c('4', 'clubs'), c('5', 'clubs'), joker()], 'team-a')
      expect(result.ok).toBe(true)
    })

    it('still rejects 2 wild cards even with no interior gap (only 1 wild allowed)', () => {
      const result = buildSequence([c('4', 'clubs'), c('5', 'clubs'), joker(), joker()], 'team-a')
      expect(result.ok).toBe(false)
    })

    it('still rejects genuinely mixed-suit naturals even when a Joker is present', () => {
      const result = buildSequence([c('4', 'clubs'), c('5', 'hearts'), joker()], 'team-a')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toBe('A sequence must be a single suit.')
    })

    it('still rejects a non-consecutive gap of >1 rank even with a wild available', () => {
      const result = buildSequence([c('4', 'clubs'), c('9', 'clubs'), joker()], 'team-a')
      expect(result.ok).toBe(false)
    })

    it('cannot extend past both ends when the naturals already span the full A-K range (edge case)', () => {
      // Not a realistic hand, but exercises the "nowhere left to extend" fallback.
      const naturals = Array.from({ length: 13 }, (_, i) => {
        const rank = ([
          'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K',
        ] as const)[i]
        return c(rank, 'diamonds')
      })
      const result = buildSequence([...naturals, joker()], 'team-a')
      expect(result.ok).toBe(false)
    })
  })
})

describe('append + classification', () => {
  it('classifies a 7-card wild-free sequence as a Limpa (200 bonus context)', () => {
    let m = buildSequence([c('3', 'clubs'), c('4', 'clubs'), c('5', 'clubs')], 'team-a')
    if (!m.ok) throw new Error('setup failed')
    for (const rank of ['6', '7', '8', '9'] as const) {
      const res = appendToMeld(m.meld, c(rank, 'clubs'))
      if (!res.ok) throw new Error(res.error)
      m = { ok: true, meld: res.meld }
    }
    expect(m.meld.slots.length).toBe(7)
    expect(m.meld.classification).toBe('limpa')
  })

  it('classifies a 7-card sequence containing 1 wild as Mixed Canasta', () => {
    let m = buildSequence([c('3', 'clubs'), c('4', 'clubs'), c('5', 'clubs')], 'team-a')
    if (!m.ok) throw new Error('setup failed')
    for (const rank of ['6', '7', '8'] as const) {
      const res = appendToMeld(m.meld, c(rank, 'clubs'))
      if (!res.ok) throw new Error(res.error)
      m = { ok: true, meld: res.meld }
    }
    const withWild = appendToMeld(m.meld, joker())
    if (!withWild.ok) throw new Error(withWild.error)
    expect(withWild.meld.slots.length).toBe(7)
    expect(withWild.meld.classification).toBe('mixed-canasta')
  })

  it('classifies a 7-card meld of natural 2s (no jokers) as Limpa of 2s (500 bonus)', () => {
    const suits: Array<'hearts' | 'diamonds' | 'clubs' | 'spades'> = ['hearts', 'diamonds', 'clubs', 'spades']
    let m = buildSet([c('2', suits[0]), c('2', suits[1]), c('2', suits[2])], 'team-a')
    if (!m.ok) throw new Error('setup failed')
    for (let i = 0; i < 4; i += 1) {
      const res = appendToMeld(m.meld, c('2', suits[i % suits.length]))
      if (!res.ok) throw new Error(res.error)
      m = { ok: true, meld: res.meld }
    }
    expect(m.meld.slots.length).toBe(7)
    expect(m.meld.classification).toBe('limpa-2s')
  })

  it('classifies a 7-card meld of 2s containing a joker as Mixed Canasta of 2s (200 bonus)', () => {
    let m = buildSet([c('2', 'hearts'), c('2', 'diamonds'), joker()], 'team-a')
    if (!m.ok) throw new Error('setup failed')
    for (let i = 0; i < 4; i += 1) {
      const res = appendToMeld(m.meld, c('2', 'clubs'))
      if (!res.ok) throw new Error(res.error)
      m = { ok: true, meld: res.meld }
    }
    expect(m.meld.slots.length).toBe(7)
    expect(m.meld.classification).toBe('mixed-canasta-2s')
  })

  it('rejects appending a 2nd wild card to a meld that already has 1', () => {
    const built = buildSet([c('8', 'hearts'), c('8', 'spades'), joker()], 'team-a')
    if (!built.ok) throw new Error('setup failed')
    expect(canAppendToMeld(built.meld, c('2', 'clubs'))).toBe(false)
  })
})

describe('moveWildEdgeInSet (item 7 - Move Wild)', () => {
  it('reports no movable wild edge for a wild-free set', () => {
    const built = buildSet([c('8', 'hearts'), c('8', 'spades'), c('8', 'clubs')], 'team-a')
    if (!built.ok) throw new Error('setup failed')
    expect(wildEdgeInSet(built.meld)).toBeNull()
  })

  it('reports "back" when the wild is the last slot (e.g. 6-7-2)', () => {
    const built = buildSet([c('8', 'hearts'), c('8', 'spades'), joker()], 'team-a')
    if (!built.ok) throw new Error('setup failed')
    expect(wildEdgeInSet(built.meld)).toBe('back')
  })

  it('reports "front" when the wild is the first slot (e.g. 2-6-7)', () => {
    const built = buildSet([joker(), c('8', 'hearts'), c('8', 'spades')], 'team-a')
    if (!built.ok) throw new Error('setup failed')
    expect(wildEdgeInSet(built.meld)).toBe('front')
  })

  it('toggles the wild from back to front', () => {
    const built = buildSet([c('8', 'hearts'), c('8', 'spades'), joker()], 'team-a')
    if (!built.ok) throw new Error('setup failed')
    const moved = moveWildEdgeInSet(built.meld)
    expect(moved.ok).toBe(true)
    if (!moved.ok) return
    expect(moved.meld.slots[0].isWildFill).toBe(true)
    expect(moved.meld.slots[moved.meld.slots.length - 1].isWildFill).toBe(false)
    expect(wildEdgeInSet(moved.meld)).toBe('front')
  })

  it('toggles the wild from front back to back', () => {
    const built = buildSet([joker(), c('8', 'hearts'), c('8', 'spades')], 'team-a')
    if (!built.ok) throw new Error('setup failed')
    const moved = moveWildEdgeInSet(built.meld)
    expect(moved.ok).toBe(true)
    if (!moved.ok) return
    expect(wildEdgeInSet(moved.meld)).toBe('back')
  })

  it('does not change legality, wild count, or card membership - purely reorders', () => {
    const built = buildSet([c('8', 'hearts'), c('8', 'spades'), joker()], 'team-a')
    if (!built.ok) throw new Error('setup failed')
    const moved = moveWildEdgeInSet(built.meld)
    expect(moved.ok).toBe(true)
    if (!moved.ok) return
    expect(moved.meld.wildCount).toBe(1)
    expect(moved.meld.slots.map((s) => s.card.id).sort()).toEqual(built.meld.slots.map((s) => s.card.id).sort())
  })

  it('set-only helper still rejects Sequences (use moveWildInMeld for sequence relocation)', () => {
    const built = buildSequence([c('5', 'diamonds'), c('6', 'diamonds'), joker()], 'team-a')
    if (!built.ok) throw new Error('setup failed')
    expect(wildEdgeInSet(built.meld)).toBeNull()
    const moved = moveWildEdgeInSet(built.meld)
    expect(moved.ok).toBe(false)
  })

  it('rejects moving a wild that sits in the middle (not at an edge)', () => {
    const m = buildSet([c('8', 'hearts'), c('8', 'spades'), joker()], 'team-a')
    if (!m.ok) throw new Error('setup failed')
    // Force the wild into the middle slot manually for this structural test.
    const slots = [...m.meld.slots]
    const wildIdx = slots.findIndex((s) => s.isWildFill)
    const [wild] = slots.splice(wildIdx, 1)
    slots.splice(1, 0, wild)
    const midWildMeld = { ...m.meld, slots }
    expect(wildEdgeInSet(midWildMeld)).toBeNull()
    expect(moveWildEdgeInSet(midWildMeld).ok).toBe(false)
  })
})

describe('moveWildInMeld on Sequences (reinterpret natural 2 as wild)', () => {
  it('offers Move Wild for a 2-3-4 same-suit run where the 2 is natural', () => {
    const built = buildSequence([c('2', 'diamonds'), c('3', 'diamonds'), c('4', 'diamonds')], 'team-a')
    if (!built.ok) throw new Error('setup failed')
    expect(built.meld.wildCount).toBe(0)
    expect(getWildMoveInfo(built.meld)).not.toBeNull()
  })

  it('relocates the natural 2♦ to a wild 5-slot so a 6♦ can then be appended', () => {
    const built = buildSequence([c('2', 'diamonds'), c('3', 'diamonds'), c('4', 'diamonds')], 'team-a')
    if (!built.ok) throw new Error('setup failed')

    // Before moving, 6♦ cannot append (gap at 5).
    expect(canAppendToMeld(built.meld, c('6', 'diamonds'))).toBe(false)

    const moved = moveWildInMeld(built.meld)
    expect(moved.ok).toBe(true)
    if (!moved.ok) return
    // 3-4-5[2 as wild]
    expect(moved.meld.slots.map((s) => s.slotRank)).toEqual(['3', '4', '5'])
    expect(moved.meld.wildCount).toBe(1)
    expect(moved.meld.slots[2].isWildFill).toBe(true)
    expect(moved.meld.slots[2].card.rank).toBe('2')

    expect(canAppendToMeld(moved.meld, c('6', 'diamonds'))).toBe(true)
    const appended = appendToMeld(moved.meld, c('6', 'diamonds'))
    expect(appended.ok).toBe(true)
    if (!appended.ok) return
    expect(appended.meld.slots.map((s) => s.slotRank)).toEqual(['3', '4', '5', '6'])
  })

  it('cycles a sequence wild back toward the natural-2 placement', () => {
    const built = buildSequence([c('2', 'diamonds'), c('3', 'diamonds'), c('4', 'diamonds')], 'team-a')
    if (!built.ok) throw new Error('setup failed')
    const once = moveWildInMeld(built.meld)
    expect(once.ok).toBe(true)
    if (!once.ok) return
    const twice = moveWildInMeld(once.meld)
    expect(twice.ok).toBe(true)
    if (!twice.ok) return
    // Back to natural 2-3-4 (or another legal end — at minimum still 3 cards, 1 movable).
    expect(twice.meld.slots.length).toBe(3)
    expect(getWildMoveInfo(twice.meld)).not.toBeNull()
  })
})

describe('append wild onto Ace-high-capped sequences', () => {
  it('places an off-suit 2 as a wild below Jack on an A-K-Q-J run (not above Ace)', () => {
    const built = buildSequence(
      [c('J', 'spades'), c('Q', 'spades'), c('K', 'spades'), c('A', 'spades')],
      'team-a',
    )
    if (!built.ok) throw new Error('setup failed')
    expect(built.meld.slots.map((s) => s.slotRank)).toEqual(['J', 'Q', 'K', 'A'])

    const twoDiamonds = c('2', 'diamonds')
    expect(canAppendToMeld(built.meld, twoDiamonds)).toBe(true)

    // Even when the caller prefers "top" (UI / Top Touch default), Ace caps
    // that end so the wild must fall back to the low end.
    const appended = appendToMeld(built.meld, twoDiamonds, 'top')
    expect(appended.ok).toBe(true)
    if (!appended.ok) return
    expect(appended.meld.slots.map((s) => s.slotRank)).toEqual(['10', 'J', 'Q', 'K', 'A'])
    expect(appended.meld.slots[0].isWildFill).toBe(true)
    expect(appended.meld.slots[0].card.rank).toBe('2')
    expect(appended.meld.wildCount).toBe(1)
  })

  it('places a Joker below Jack on an A-K-Q-J run when Ace caps the high end', () => {
    const built = buildSequence(
      [c('J', 'hearts'), c('Q', 'hearts'), c('K', 'hearts'), c('A', 'hearts')],
      'team-a',
    )
    if (!built.ok) throw new Error('setup failed')
    const appended = appendToMeld(built.meld, joker())
    expect(appended.ok).toBe(true)
    if (!appended.ok) return
    expect(appended.meld.slots[0].slotRank).toBe('10')
    expect(appended.meld.slots[0].isWildFill).toBe(true)
  })

  it('still prefers extending upward when the high end is open', () => {
    const built = buildSequence([c('J', 'clubs'), c('Q', 'clubs'), c('K', 'clubs')], 'team-a')
    if (!built.ok) throw new Error('setup failed')
    const appended = appendToMeld(built.meld, c('2', 'diamonds'))
    expect(appended.ok).toBe(true)
    if (!appended.ok) return
    // High end open → wild takes Ace slot above King.
    expect(appended.meld.slots.map((s) => s.slotRank)).toEqual(['J', 'Q', 'K', 'A'])
    expect(appended.meld.slots[3].isWildFill).toBe(true)
  })
})

describe('the Slide mechanic', () => {
  it('requests a slide edge choice, then moves the displaced wild to the chosen edge', () => {
    const built = buildSequence([c('5', 'diamonds'), joker(), c('7', 'diamonds')], 'team-a')
    if (!built.ok) throw new Error('setup failed')
    const displacedWild = built.meld.slots.find((s) => s.isWildFill)!.card

    const natural6 = c('6', 'diamonds')
    const firstAttempt = appendToMeld(built.meld, natural6)
    expect(firstAttempt.ok).toBe(false)
    if (firstAttempt.ok) return
    expect(firstAttempt.needsSlideChoice?.displacedWildCardId).toBe(displacedWild.id)

    const slid = appendToMeld(built.meld, natural6, 'top')
    expect(slid.ok).toBe(true)
    if (!slid.ok) return
    const sixSlot = slid.meld.slots.find((s) => s.slotRank === '6')
    expect(sixSlot?.isWildFill).toBe(false)
    // Wild now sits at the top edge (rank 8) and the run is still playable there.
    const topSlot = slid.meld.slots[slid.meld.slots.length - 1]
    expect(topSlot.card.id).toBe(displacedWild.id)
    expect(topSlot.slotRank).toBe('8')
    expect(slid.meld.wildCount).toBe(1)
  })

  it('slides to the bottom edge when requested', () => {
    const built = buildSequence([c('5', 'diamonds'), joker(), c('7', 'diamonds')], 'team-a')
    if (!built.ok) throw new Error('setup failed')
    const displacedWild = built.meld.slots.find((s) => s.isWildFill)!.card

    const slid = appendToMeld(built.meld, c('6', 'diamonds'), 'bottom')
    expect(slid.ok).toBe(true)
    if (!slid.ok) return
    const bottomSlot = slid.meld.slots[0]
    expect(bottomSlot.card.id).toBe(displacedWild.id)
    expect(bottomSlot.slotRank).toBe('4')
  })
})
