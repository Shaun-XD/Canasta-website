export const DISCARD_CARD_WIDTH = 64
/** Maximum number of visible cards in the phone/tablet discard window. */
export const DISCARD_VISIBLE_CARDS = 9
/** Fraction of each card covered by its neighbor. */
export const DISCARD_OVERLAP_RATIO = 0.55

export function discardFanWidth(cardWidth: number, count: number): number {
  const n = Math.max(0, Math.min(DISCARD_VISIBLE_CARDS, count))
  if (n <= 1) return Math.round(cardWidth)
  const peek = cardWidth * (1 - DISCARD_OVERLAP_RATIO)
  return Math.round(cardWidth + (n - 1) * peek)
}
