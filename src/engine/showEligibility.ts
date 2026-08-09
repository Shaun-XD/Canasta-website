import type { Team } from '../types/game'
import { meldBonus } from './meldValidation'

/** Minimum total Canasta/Limpa bonus points required to declare Show. */
export const SHOW_MIN_CANASTA_BONUS = 300

export interface ShowEligibility {
  eligible: boolean
  /** Pozzetto claimed and activated (discarded from the reserve hand). */
  reserveActivated: boolean
  /** Team canasta/limpa bonuses alone sum to ≥ {@link SHOW_MIN_CANASTA_BONUS}. */
  canastaWinCondition: boolean
  /** Declaring player has removed all cards from hand (Show). */
  handEmpty: boolean
  /** Sum of completed Canasta/Limpa bonuses (100/200/500…), card points excluded. */
  canastaBonusPoints: number
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

/** Canasta/Limpa bonus total only — opening/card point values do not count. */
export function teamCanastaBonusPoints(team: Team): number {
  return team.melds.reduce((sum, meld) => sum + meldBonus(meld), 0)
}

/**
 * A player may declare Show iff, for their TEAM:
 *   1. Pozzetto is finished: claimed + activated (reserve was taken and at
 *      least one card was discarded from that reserve-augmented hand).
 *   2. Canasta win condition: sum of Canasta/Limpa bonuses ≥ 300
 *      (e.g. 3× Mixed Canasta = 300, or 1× Limpa + 1× Mixed = 300).
 *   3. Declaring player's hand is empty (all cards melded/discarded — Show).
 */
export function evaluateShowEligibility(team: Team, declaringPlayerHandSize: number): ShowEligibility {
  const numCompletedCanastasOrLimpas = completedCanastaCount(team)
  const canastaBonusPoints = teamCanastaBonusPoints(team)
  const reserveActivated = team.pozzetto.claimed && team.pozzetto.activated
  const canastaWinCondition = canastaBonusPoints >= SHOW_MIN_CANASTA_BONUS
  const handEmpty = declaringPlayerHandSize === 0

  return {
    eligible: reserveActivated && canastaWinCondition && handEmpty,
    reserveActivated,
    canastaWinCondition,
    handEmpty,
    canastaBonusPoints,
    numCompletedCanastasOrLimpas,
  }
}

export function unmetShowConditions(elig: ShowEligibility): string[] {
  const reasons: string[] = []
  if (!elig.reserveActivated) {
    reasons.push(
      'Pozzetto must be finished: claim the reserve, then discard at least one card from that hand (activated).',
    )
  }
  if (!elig.canastaWinCondition) {
    reasons.push(
      `Need ≥${SHOW_MIN_CANASTA_BONUS} Canasta/Limpa bonus points (currently ${elig.canastaBonusPoints}).`,
    )
  }
  if (!elig.handEmpty) {
    reasons.push('Show requires an empty hand (meld or discard every remaining card).')
  }
  return reasons
}
