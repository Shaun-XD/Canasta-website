import { describe, expect, it } from 'vitest'
import type { Meld, Team } from '../types/game'
import { evaluateShowEligibility, SHOW_MIN_CANASTA_BONUS } from './showEligibility'
import { initialPozzettoState } from './pozzetto'

function fakeMeld(classification: Meld['classification']): Meld {
  return {
    id: `m-${Math.random()}`,
    type: 'set',
    ownerTeamId: 'team-a',
    rank: '8',
    suit: null,
    slots: [],
    wildCount: 0,
    canBecomeLimpa: true,
    classification,
    isCanasta: classification !== 'in-progress',
  }
}

function makeTeam(overrides: Partial<Team>): Team {
  return {
    id: 'team-a',
    name: 'Team A',
    playerIds: [],
    melds: [],
    score: 0,
    hasGoneOut: false,
    pozzetto: initialPozzettoState(),
    ...overrides,
  }
}

describe('evaluateShowEligibility', () => {
  it('is ineligible when Pozzetto is claimed but not activated', () => {
    const team = makeTeam({
      melds: [fakeMeld('mixed-canasta'), fakeMeld('mixed-canasta'), fakeMeld('mixed-canasta')],
      pozzetto: { claimed: true, claimedByPlayerId: 'p1', activated: false },
    })
    const elig = evaluateShowEligibility(team, 0)
    expect(elig.eligible).toBe(false)
    expect(elig.reserveActivated).toBe(false)
    expect(elig.canastaBonusPoints).toBe(300)
  })

  it('is ineligible when canasta bonuses are under 300 (e.g. two Mixed = 200)', () => {
    const team = makeTeam({
      melds: [fakeMeld('mixed-canasta'), fakeMeld('mixed-canasta')],
      pozzetto: { claimed: true, claimedByPlayerId: 'p1', activated: true },
    })
    const elig = evaluateShowEligibility(team, 0)
    expect(elig.eligible).toBe(false)
    expect(elig.canastaWinCondition).toBe(false)
    expect(elig.canastaBonusPoints).toBe(200)
  })

  it('is ineligible when the declaring player still has cards', () => {
    const team = makeTeam({
      melds: [fakeMeld('mixed-canasta'), fakeMeld('mixed-canasta'), fakeMeld('mixed-canasta')],
      pozzetto: { claimed: true, claimedByPlayerId: 'p1', activated: true },
    })
    const elig = evaluateShowEligibility(team, 2)
    expect(elig.eligible).toBe(false)
    expect(elig.handEmpty).toBe(false)
  })

  it(`is eligible at exactly ${SHOW_MIN_CANASTA_BONUS} via 3 Mixed Canastas + finished Pozzetto + empty hand`, () => {
    const team = makeTeam({
      melds: [fakeMeld('mixed-canasta'), fakeMeld('mixed-canasta'), fakeMeld('mixed-canasta')],
      pozzetto: { claimed: true, claimedByPlayerId: 'p1', activated: true },
    })
    const elig = evaluateShowEligibility(team, 0)
    expect(elig.canastaBonusPoints).toBe(300)
    expect(elig.eligible).toBe(true)
  })

  it('is eligible with 1 Limpa (200) + 1 Mixed Canasta (100) = 300', () => {
    const team = makeTeam({
      melds: [fakeMeld('limpa'), fakeMeld('mixed-canasta')],
      pozzetto: { claimed: true, claimedByPlayerId: 'p1', activated: true },
    })
    const elig = evaluateShowEligibility(team, 0)
    expect(elig.canastaBonusPoints).toBe(300)
    expect(elig.eligible).toBe(true)
  })

  it('is eligible with a single Limpa of 2s (500) alone', () => {
    const team = makeTeam({
      melds: [fakeMeld('limpa-2s')],
      pozzetto: { claimed: true, claimedByPlayerId: 'p1', activated: true },
    })
    const elig = evaluateShowEligibility(team, 0)
    expect(elig.canastaBonusPoints).toBe(500)
    expect(elig.eligible).toBe(true)
  })

  it('ignores in-progress melds for the 300 bonus threshold', () => {
    const team = makeTeam({
      melds: [fakeMeld('mixed-canasta'), fakeMeld('mixed-canasta'), fakeMeld('in-progress')],
      pozzetto: { claimed: true, claimedByPlayerId: 'p1', activated: true },
    })
    const elig = evaluateShowEligibility(team, 0)
    expect(elig.canastaBonusPoints).toBe(200)
    expect(elig.eligible).toBe(false)
  })
})
