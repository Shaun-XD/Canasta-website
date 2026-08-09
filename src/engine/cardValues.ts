import type { CardModel, Rank } from '../types/game'

/**
 * Numeric rank order used for Sequence adjacency (A=1 ... K=13). Sequences
 * do not wrap around (no K-A-2 wraparound) per the given ruleset.
 */
export const RANK_ORDER: Record<Rank, number> = {
  A: 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  J: 11,
  Q: 12,
  K: 13,
  JOKER: -1, // jokers have no fixed rank position
}

export const RANK_BY_ORDER: Record<number, Rank> = Object.fromEntries(
  Object.entries(RANK_ORDER)
    .filter(([rank]) => rank !== 'JOKER')
    .map(([rank, order]) => [order, rank as Rank]),
)

/** Card point values per the ruleset (section 2). */
export function cardPointValue(card: CardModel): number {
  if (card.rank === 'JOKER') return 30
  if (card.rank === 'A') return 15
  if (card.rank === '2') return 10
  if (['8', '9', '10', 'J', 'Q', 'K'].includes(card.rank)) return 10
  return 5 // 3-7
}

/** A card that is *always* wild regardless of context (Jokers). */
export function isAlwaysWild(card: CardModel): boolean {
  return card.rank === 'JOKER'
}

/** A card whose rank can be used as a wild substitute (Jokers + all 2s). */
export function isWildCapable(card: CardModel): boolean {
  return card.rank === 'JOKER' || card.rank === '2'
}
