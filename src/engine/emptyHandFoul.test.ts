import { describe, expect, it } from 'vitest'
import type { Team } from '../types/game'
import { EMPTY_HAND_FOUL_PENALTY, isIllegalEmptyHand } from './emptyHandFoul'
import { buildSet } from './meldValidation'
import { initialPozzettoState } from './pozzetto'
import { c, joker } from './testHelpers'

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team-a',
    name: 'A',
    playerIds: [],
    melds: [],
    score: 0,
    hasGoneOut: false,
    pozzetto: initialPozzettoState(),
    ...overrides,
  }
}

describe('isIllegalEmptyHand', () => {
  it('is not a foul before Pozzetto is claimed (emptying claims the reserve)', () => {
    expect(isIllegalEmptyHand(makeTeam(), 0)).toBe(false)
  })

  it('is a foul after Pozzetto claimed without Show readiness', () => {
    const team = makeTeam({
      pozzetto: { claimed: true, claimedByPlayerId: 'p1', activated: true },
    })
    expect(isIllegalEmptyHand(team, 0)).toBe(true)
    expect(EMPTY_HAND_FOUL_PENALTY).toBe(-150)
  })

  it('is legal when Show conditions are met (activated + ≥300 bonus)', () => {
    // Three mixed canastas = 300.
    const melds = []
    for (const rank of ['7', '8', '9'] as const) {
      const built = buildSet([c(rank, 'hearts'), c(rank, 'spades'), joker()], 'team-a')
      if (!built.ok) throw new Error('setup')
      let meld = built.meld
      for (const suit of ['clubs', 'diamonds', 'hearts', 'spades'] as const) {
        // append via re-import would need appendToMeld — inflate slots directly for bonus
        meld = {
          ...meld,
          slots: [
            ...meld.slots,
            { card: c(rank, suit), slotRank: rank, isWildFill: false },
          ],
          isCanasta: true,
          classification: 'mixed-canasta',
          wildCount: 1,
        }
      }
      melds.push(meld)
    }
    const team = makeTeam({
      melds,
      pozzetto: { claimed: true, claimedByPlayerId: 'p1', activated: true },
    })
    expect(isIllegalEmptyHand(team, 0)).toBe(false)
  })

  it('ignores non-empty hands', () => {
    const team = makeTeam({
      pozzetto: { claimed: true, claimedByPlayerId: 'p1', activated: true },
    })
    expect(isIllegalEmptyHand(team, 1)).toBe(false)
  })
})
