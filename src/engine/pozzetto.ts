import type { PozzettoState } from '../types/game'

export function initialPozzettoState(): PozzettoState {
  return { claimed: false, claimedByPlayerId: null, activated: false }
}

/**
 * Section 5, trigger #1: "End-of-turn empty (normal pickup)". A player's
 * hand reached 0 cards specifically because they discarded their last card
 * (hand was down to 1 before the final discard). They claim their team's
 * reserve immediately, but their turn ends right there.
 */
export function shouldClaimPozzettoOnDiscard(handSizeBeforeDiscard: number, alreadyClaimed: boolean): boolean {
  return !alreadyClaimed && handSizeBeforeDiscard === 1
}

/**
 * Section 5, trigger #2: "Running Turn activation (mid-turn pickup)". A
 * player empties their hand to 0 purely via melding in Phase 2 (no discard
 * needed). The reserve is added immediately mid-turn and the same turn
 * continues.
 */
export function shouldClaimPozzettoOnMeldEmpty(handSizeAfterMeld: number, alreadyClaimed: boolean): boolean {
  return !alreadyClaimed && handSizeAfterMeld === 0
}
