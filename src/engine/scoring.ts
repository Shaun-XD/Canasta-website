import type { CardModel, RoundEndingType, RoundScoreResult, Team, TeamId, TeamRoundScore } from '../types/game'
import { cardPointValue } from './cardValues'
import { meldBonus, meldRawPoints } from './meldValidation'

function otherTeamId(teamId: TeamId): TeamId {
  return teamId === 'team-a' ? 'team-b' : 'team-a'
}

function completedCanastaOrLimpaCount(team: Team): number {
  return team.melds.filter((m) => m.classification !== 'in-progress').length
}

function teamMeldScore(team: Team): { meldPoints: number; canastaBonuses: number } {
  let meldPoints = 0
  let canastaBonuses = 0
  for (const meld of team.melds) {
    meldPoints += meldRawPoints(meld)
    canastaBonuses += meldBonus(meld)
  }
  return { meldPoints, canastaBonuses }
}

/**
 * Section 8 scoring.
 *
 * `showingTeamId` is set for a Normal Show ending, null for sudden-death.
 * `handsByTeam` maps each team to the concatenated hands of both of its
 * players at the moment the round ended (used only for the opponent-hand
 * penalty in a Normal Show ending; ignored entirely in sudden-death).
 *
 * TODO(rules): the "wrong meld detected" (-100, cards removed from
 * scoring) and "unclaimed Pozzetto" (-100) penalties are carried over from
 * an earlier tournament ruleset per the task brief; they are implemented as
 * specified since no contradicting information was given, but may need
 * confirmation from the product owner.
 */
export function scoreRound(
  round: number,
  endingType: RoundEndingType,
  teams: [Team, Team],
  handsByTeam: Record<TeamId, CardModel[]>,
  showingTeamId: TeamId | null,
  wrongMeldPenaltyByTeam: Record<TeamId, number> = { 'team-a': 0, 'team-b': 0 },
  emptyHandFoulByTeam: Record<TeamId, number> = { 'team-a': 0, 'team-b': 0 },
): RoundScoreResult {
  const result: Record<TeamId, TeamRoundScore> = {} as Record<TeamId, TeamRoundScore>

  for (const team of teams) {
    const { meldPoints, canastaBonuses } = teamMeldScore(team)
    const zeroCanastaPenalty = completedCanastaOrLimpaCount(team) === 0 ? -100 : 0
    const unclaimedPozzettoPenalty = !team.pozzetto.activated ? -100 : 0
    const showBonus = endingType === 'show' && team.id === showingTeamId ? 100 : 0

    let opponentHandPenalty = 0
    if (endingType === 'show' && showingTeamId && team.id === showingTeamId) {
      const opponentHand = handsByTeam[otherTeamId(team.id)] ?? []
      opponentHandPenalty = opponentHand.reduce((sum, c) => sum + cardPointValue(c), 0)
    }

    const wrongMeldPenalty = wrongMeldPenaltyByTeam[team.id] ?? 0
    const emptyHandFoulPenalty = emptyHandFoulByTeam[team.id] ?? 0

    const total =
      meldPoints +
      canastaBonuses +
      opponentHandPenalty +
      showBonus +
      zeroCanastaPenalty +
      unclaimedPozzettoPenalty +
      wrongMeldPenalty +
      emptyHandFoulPenalty

    result[team.id] = {
      teamId: team.id,
      meldPoints,
      canastaBonuses,
      opponentHandPenalty,
      showBonus,
      zeroCanastaPenalty,
      unclaimedPozzettoPenalty,
      wrongMeldPenalty,
      emptyHandFoulPenalty,
      total,
    }
  }

  return { round, endingType, showingTeamId, teams: result }
}
