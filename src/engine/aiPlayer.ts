import type { CardModel, Meld, TeamId } from '../types/game'
import { buildSet, canAppendToMeld } from './meldValidation'

/**
 * Lightweight AI planner for the mock/placeholder players. It reuses the
 * exact same validation functions as human play (`buildSet`,
 * `canAppendToMeld`) so AI moves are always legal per the real rules
 * engine - there is no separate "fake" AI logic path.
 *
 * The strategy is intentionally simple (greedy, not optimal play): meld any
 * same-rank group of 3+ natural cards it can find, append single cards to
 * existing team melds where possible, then discard a low-value card to end
 * the turn.
 */
export interface AiMeldPlan {
  cardIds: string[]
}

export interface AiAppendPlan {
  meldId: string
  cardId: string
}

export interface AiTurnPlan {
  newMelds: AiMeldPlan[]
  appends: AiAppendPlan[]
  discardCardId: string | null
}

export function planAiMelds(hand: CardModel[], teamId: TeamId): { plans: AiMeldPlan[]; remainingHand: CardModel[] } {
  const plans: AiMeldPlan[] = []
  let remaining = [...hand]

  const naturalRanks = new Set(
    remaining.filter((c) => c.rank !== 'JOKER' && c.rank !== '2').map((c) => c.rank),
  )

  for (const rank of naturalRanks) {
    const group = remaining.filter((c) => c.rank === rank)
    if (group.length >= 3) {
      const attempt = buildSet(group, teamId)
      if (attempt.ok) {
        plans.push({ cardIds: group.map((c) => c.id) })
        remaining = remaining.filter((c) => !group.some((g) => g.id === c.id))
      }
    }
  }

  return { plans, remainingHand: remaining }
}

export function planAiAppends(hand: CardModel[], melds: Meld[]): { plans: AiAppendPlan[]; remainingHand: CardModel[] } {
  const plans: AiAppendPlan[] = []
  let remaining = [...hand]

  for (const meld of melds) {
    const cardIndex = remaining.findIndex((c) => canAppendToMeld(meld, c))
    if (cardIndex >= 0) {
      const card = remaining[cardIndex]
      plans.push({ meldId: meld.id, cardId: card.id })
      remaining = remaining.filter((c) => c.id !== card.id)
    }
  }

  return { plans, remainingHand: remaining }
}

/** Picks a discard: prefers a non-wild card so wilds are kept for melding. */
export function pickAiDiscard(hand: CardModel[]): CardModel | null {
  if (hand.length === 0) return null
  const nonWild = hand.filter((c) => c.rank !== 'JOKER' && c.rank !== '2')
  const pool = nonWild.length > 0 ? nonWild : hand
  return pool[Math.floor(Math.random() * pool.length)]
}
