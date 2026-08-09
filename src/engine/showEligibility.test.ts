import { describe, expect, it } from 'vitest'
import type { Meld, Team } from '../types/game'
import { evaluateShowEligibility } from './showEligibility'
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
  it('is ineligible when reserve is not activated', () => {
    const team = makeTeam({
      melds: [fakeMeld('mixed-canasta'), fakeMeld('mixed-canasta'), fakeMeld('limpa')],
    })
    const elig = evaluateShowEligibility(team, 0)
    expect(elig.eligible).toBe(false)
    expect(elig.reserveActivated).toBe(false)
  })

  it('is ineligible when fewer than 3 canastas/limpas are completed', () => {
    const team = makeTeam({
      melds: [fakeMeld('mixed-canasta')],
      pozzetto: { claimed: true, claimedByPlayerId: 'p1', activated: true },
    })
    const elig = evaluateShowEligibility(team, 0)
    expect(elig.eligible).toBe(false)
    expect(elig.canastaWinCondition).toBe(false)
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

  it('is eligible once all 3 conditions hold, with any mix of Canasta/Limpa types', () => {
    const team = makeTeam({
      melds: [fakeMeld('mixed-canasta'), fakeMeld('mixed-canasta'), fakeMeld('limpa')],
      pozzetto: { claimed: true, claimedByPlayerId: 'p1', activated: true },
    })
    const elig = evaluateShowEligibility(team, 0)
    expect(elig.eligible).toBe(true)
  })

  it('is eligible with 3 Mixed Canastas alone (no Limpa required)', () => {
    const team = makeTeam({
      melds: [fakeMeld('mixed-canasta'), fakeMeld('mixed-canasta'), fakeMeld('mixed-canasta')],
      pozzetto: { claimed: true, claimedByPlayerId: 'p1', activated: true },
    })
    const elig = evaluateShowEligibility(team, 0)
    expect(elig.eligible).toBe(true)
  })
})
