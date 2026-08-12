import type { Team } from '../types/game'
import { evaluateShowEligibility } from './showEligibility'

/** Illegal empty-hand foul: fouling team loses this many points. */
export const EMPTY_HAND_FOUL_PENALTY = -150

/**
 * After Pozzetto is claimed, a player may only empty their hand when the
 * team can legally Show (reserve activated + canasta bonus ≥300). Emptying
 * to claim Pozzetto (unclaimed) is legal. Otherwise it is a foul.
 */
export function isIllegalEmptyHand(team: Team, handSizeAfterAction: number): boolean {
  if (handSizeAfterAction !== 0) return false
  if (!team.pozzetto.claimed) return false
  const elig = evaluateShowEligibility(team, 0)
  // Show path: reserve finished + canasta condition — emptying is legal.
  if (elig.reserveActivated && elig.canastaWinCondition) return false
  return true
}
