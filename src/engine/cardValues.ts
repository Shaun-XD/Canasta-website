import type { CardModel, Rank } from '../types/game'

/**
 * Numeric rank order used for Sequence adjacency.
 *
 * Ace is high by default (after King): …J Q K A. Ace may also play low in
 * an A-2-3… run (see `ACE_LOW_ORDER` / sequence builders). Sequences never
 * wrap (no K-A-2).
 */
export const ACE_LOW_ORDER = 1
export const ACE_HIGH_ORDER = 14

export const RANK_ORDER: Record<Rank, number> = {
  A: ACE_HIGH_ORDER,
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

export const RANK_BY_ORDER: Record<number, Rank> = {
  ...Object.fromEntries(
    Object.entries(RANK_ORDER)
      .filter(([rank]) => rank !== 'JOKER')
      .map(([rank, order]) => [order, rank as Rank]),
  ),
  // Ace occupies both ends of the linear rank line (never in the same meld).
  [ACE_LOW_ORDER]: 'A',
  [ACE_HIGH_ORDER]: 'A',
}

/** Order for a natural rank inside a sequence, given whether Ace is high. */
export function sequenceRankOrder(rank: Rank, aceHigh: boolean): number {
  if (rank === 'A') return aceHigh ? ACE_HIGH_ORDER : ACE_LOW_ORDER
  return RANK_ORDER[rank]
}

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
