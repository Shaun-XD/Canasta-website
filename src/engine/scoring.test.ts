import { describe, expect, it } from 'vitest'
import type { Team } from '../types/game'
import { appendToMeld, buildSet } from './meldValidation'
import { initialPozzettoState } from './pozzetto'
import { scoreRound } from './scoring'
import { c, joker } from './testHelpers'

function makeTeam(id: 'team-a' | 'team-b', overrides: Partial<Team> = {}): Team {
  return {
    id,
    name: id,
    playerIds: [],
    melds: [],
    score: 0,
    hasGoneOut: false,
    pozzetto: initialPozzettoState(),
    ...overrides,
  }
}

describe('scoreRound - Normal Show ending', () => {
  it('adds meld points + bonuses + opponent hand penalty + show bonus, and applies zero-canasta/unclaimed-pozzetto penalties', () => {
    const meldA = buildSet([c('8', 'hearts'), c('8', 'spades'), c('8', 'clubs')], 'team-a')
    if (!meldA.ok) throw new Error('setup')
    const teamA = makeTeam('team-a', {
      melds: [meldA.meld],
      pozzetto: { claimed: true, claimedByPlayerId: 'p1', activated: true },
    })
    const teamB = makeTeam('team-b') // no melds, no activated pozzetto

    const opponentHand = [c('K', 'hearts'), c('Q', 'spades')] // 10 + 10 = 20

    const result = scoreRound(
      1,
      'show',
      [teamA, teamB],
      { 'team-a': [], 'team-b': opponentHand },
      'team-a',
    )

    // team-a: 3x8 (10 each) = 30 meld points, +0 bonus (not a canasta yet),
    // +20 opponent hand penalty, +100 show bonus, -100 zero canasta (only 1
    // in-progress meld, no completed canasta/limpa) => 30+0+20+100-100 = 50
    expect(result.teams['team-a'].total).toBe(50)
    expect(result.teams['team-a'].opponentHandPenalty).toBe(20)
    expect(result.teams['team-a'].showBonus).toBe(100)

    // team-b: 0 meld points, 0 leftover from winner (empty hand),
    // -100 zero canasta, -100 unclaimed pozzetto
    expect(result.teams['team-b'].total).toBe(-200)
    expect(result.teams['team-b'].opponentHandPenalty).toBe(0)
    expect(result.teams['team-b'].zeroCanastaPenalty).toBe(-100)
    expect(result.teams['team-b'].unclaimedPozzettoPenalty).toBe(-100)
  })

  it('mirrors leftover-hand points to the losing team from the showing team remaining cards', () => {
    const teamA = makeTeam('team-a', {
      pozzetto: { claimed: true, claimedByPlayerId: 'p1', activated: true },
    })
    const teamB = makeTeam('team-b', {
      pozzetto: { claimed: true, claimedByPlayerId: 'p2', activated: true },
    })

    // Ace 15, K-8 10, 7-3 5, 2 10, Joker 30 → 15+10+10+5+5+10+30 = 85
    const winningRemainder = [
      c('A', 'hearts'),
      c('K', 'spades'),
      c('8', 'clubs'),
      c('7', 'diamonds'),
      c('3', 'hearts'),
      c('2', 'spades'),
      joker(),
    ]
    const losingRemainder = [c('Q', 'hearts')] // 10

    const result = scoreRound(
      1,
      'show',
      [teamA, teamB],
      { 'team-a': winningRemainder, 'team-b': losingRemainder },
      'team-a',
    )

    expect(result.teams['team-a'].opponentHandPenalty).toBe(10)
    expect(result.teams['team-b'].opponentHandPenalty).toBe(85)
    // both teams: leftover cards + zero-canasta (−100)
    expect(result.teams['team-a'].total).toBe(10 + 100 - 100)
    expect(result.teams['team-b'].total).toBe(85 - 100)
  })

  it('does not apply the zero-canasta penalty when a team has completed a canasta', () => {
    const built = buildSet([c('7', 'hearts'), c('7', 'spades'), joker()], 'team-a')
    if (!built.ok) throw new Error('setup')
    let meld = built.meld
    for (const suit of ['clubs', 'diamonds', 'hearts', 'spades'] as const) {
      const appended = appendToMeld(meld, c('7', suit))
      if (!appended.ok) throw new Error(appended.error)
      meld = appended.meld
    }
    expect(meld.isCanasta).toBe(true)
    const teamA = makeTeam('team-a', {
      melds: [meld],
      pozzetto: { claimed: true, claimedByPlayerId: 'p1', activated: true },
    })
    const teamB = makeTeam('team-b', { pozzetto: { claimed: true, claimedByPlayerId: 'p2', activated: true } })

    const result = scoreRound(1, 'show', [teamA, teamB], { 'team-a': [], 'team-b': [] }, 'team-a')
    expect(result.teams['team-a'].zeroCanastaPenalty).toBe(0)
    expect(result.teams['team-a'].canastaBonuses).toBeGreaterThan(0)
  })
})

describe('scoreRound - sudden-death ending', () => {
  it('ignores leftover hand cards entirely (no bonus, no penalty)', () => {
    const teamA = makeTeam('team-a')
    const teamB = makeTeam('team-b')
    const leftoverHands = {
      'team-a': [c('K', 'hearts')],
      'team-b': [c('A', 'spades'), c('A', 'clubs')],
    }

    const result = scoreRound(1, 'sudden-death', [teamA, teamB], leftoverHands, null)
    expect(result.teams['team-a'].opponentHandPenalty).toBe(0)
    expect(result.teams['team-b'].opponentHandPenalty).toBe(0)
    expect(result.teams['team-a'].showBonus).toBe(0)
    // still zero-canasta and unclaimed-pozzetto penalized
    expect(result.teams['team-a'].zeroCanastaPenalty).toBe(-100)
    expect(result.teams['team-a'].unclaimedPozzettoPenalty).toBe(-100)
    expect(result.teams['team-a'].emptyHandFoulPenalty).toBe(0)
  })
})

describe('scoreRound - empty-hand foul', () => {
  it('applies accumulated empty-hand foul penalties to the fouling team', () => {
    const teamA = makeTeam('team-a', {
      pozzetto: { claimed: true, claimedByPlayerId: 'p1', activated: true },
    })
    const teamB = makeTeam('team-b', {
      pozzetto: { claimed: true, claimedByPlayerId: 'p2', activated: true },
    })
    const result = scoreRound(
      1,
      'sudden-death',
      [teamA, teamB],
      { 'team-a': [], 'team-b': [] },
      null,
      { 'team-a': 0, 'team-b': 0 },
      { 'team-a': -150, 'team-b': 0 },
    )
    expect(result.teams['team-a'].emptyHandFoulPenalty).toBe(-150)
    // activated pozzetto → no unclaimed penalty; zero canasta −100; foul −150
    expect(result.teams['team-a'].unclaimedPozzettoPenalty).toBe(0)
    expect(result.teams['team-a'].zeroCanastaPenalty).toBe(-100)
    expect(result.teams['team-a'].total).toBe(-250)
  })
})
