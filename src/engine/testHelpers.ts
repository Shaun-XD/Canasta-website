import type { CardModel, Rank, Suit } from '../types/game'

let counter = 0
export function c(rank: Rank, suit: Suit | null = null): CardModel {
  counter += 1
  return { id: `t-${counter}`, rank, suit }
}

export function joker(): CardModel {
  return c('JOKER', null)
}
