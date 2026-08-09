import type { Team } from '../types/game'

export interface ShowEligibility {
  eligible: boolean
  reserveActivated: boolean
  canastaWinCondition: boolean
  handEmpty: boolean
  numCompletedCanastasOrLimpas: number
}

function completedCanastaCount(team: Team): number {
  return team.melds.filter(
    (m) =>
      m.classification === 'mixed-canasta' ||
      m.classification === 'limpa' ||
      m.classification === 'mixed-canasta-2s' ||
      m.classification === 'limpa-2s',
  ).length
}

/**
 * Section 6: a player may declare Show iff, for their TEAM:
 *   1. team_activated_reserve == true
 *   2. canasta_win_condition == true, i.e. (# completed Canastas/Limpas >= 3)
 *      - "3 Canastas" alone (any type) already satisfies this; "2 Canastas +
 *        1 Limpa" is just one way of reaching 3 with a Limpa in the mix, not
 *        an additional separate requirement.
 *   3. hand_count == 0 for the declaring player at the moment of declaring.
 */
export function evaluateShowEligibility(team: Team, declaringPlayerHandSize: number): ShowEligibility {
  const numCompletedCanastasOrLimpas = completedCanastaCount(team)
  const reserveActivated = team.pozzetto.activated
  const canastaWinCondition = numCompletedCanastasOrLimpas >= 3
  const handEmpty = declaringPlayerHandSize === 0

  return {
    eligible: reserveActivated && canastaWinCondition && handEmpty,
    reserveActivated,
    canastaWinCondition,
    handEmpty,
    numCompletedCanastasOrLimpas,
  }
}

export function unmetShowConditions(elig: ShowEligibility): string[] {
  const reasons: string[] = []
  if (!elig.reserveActivated) reasons.push('Your team has not activated its Pozzetto yet.')
  if (!elig.canastaWinCondition) {
    reasons.push(
      `Your team needs 3+ completed Canastas/Limpas (currently ${elig.numCompletedCanastasOrLimpas}).`,
    )
  }
  if (!elig.handEmpty) reasons.push('Your hand must be empty (discard or meld your last card).')
  return reasons
}
