import { describe, expect, it } from 'vitest'
import { appendToMeld, appendToSet, buildSequence, buildSet, canAppendToMeld, canAppendToSet } from './meldValidation'
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

    it('extends the low end with the wild when the high end is capped at K (Q,K + Joker -> J,Q,K)', () => {
      const result = buildSequence([c('Q', 'hearts'), c('K', 'hearts'), joker()], 'team-a')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.meld.slots.map((s) => s.slotRank)).toEqual(['J', 'Q', 'K'])
        const wildSlot = result.meld.slots.find((s) => s.isWildFill)
        expect(wildSlot?.slotRank).toBe('J')
      }
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
