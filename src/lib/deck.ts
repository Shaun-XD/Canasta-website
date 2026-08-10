import type { CardModel, Rank } from '../types/game'
import { RANKS, SUITS } from '../types/game'

/**
 * Deck construction: 108 cards total = two standard 52-card decks + 4
 * Jokers, per the authoritative ruleset (section 1).
 */
const DECK_COUNT = 2
const JOKERS_PER_DECK = 2

let idCounter = 0
function nextId(prefix: string): string {
  idCounter += 1
  return `${prefix}-${idCounter}-${Math.random().toString(36).slice(2, 8)}`
}

export function buildShuffledDeck(): CardModel[] {
  const cards: CardModel[] = []

  for (let d = 0; d < DECK_COUNT; d += 1) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        cards.push({ id: nextId('card'), suit, rank })
      }
    }
    for (let j = 0; j < JOKERS_PER_DECK; j += 1) {
      cards.push({ id: nextId('joker'), suit: null, rank: 'JOKER' })
    }
  }

  return shuffle(cards)
}

export function shuffle<T>(items: T[]): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export function dealHands(
  deck: CardModel[],
  playerIds: string[],
  cardsPerHand: number,
): { hands: Record<string, CardModel[]>; remaining: CardModel[] } {
  const hands: Record<string, CardModel[]> = {}
  let cursor = 0
  const working = [...deck]

  for (const playerId of playerIds) {
    hands[playerId] = working.slice(cursor, cursor + cardsPerHand)
    cursor += cardsPerHand
  }

  return { hands, remaining: working.slice(cursor) }
}

export function sortHand(hand: CardModel[]): CardModel[] {
  const rankOrder: Rank[] = [...RANKS, 'JOKER']
  return [...hand].sort((a, b) => {
    const suitA = a.suit ?? 'zzzz'
    const suitB = b.suit ?? 'zzzz'
    if (suitA !== suitB) return suitA.localeCompare(suitB)
    return rankOrder.indexOf(a.rank) - rankOrder.indexOf(b.rank)
  })
}
