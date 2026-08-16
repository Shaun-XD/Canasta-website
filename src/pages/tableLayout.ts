const HAND_CARD_WIDTH_MAX = 78
const HAND_CARD_WIDTH_MIN = 52
/** Short landscape: keep the fan low so melds own the vertical space. */
const HAND_CARD_WIDTH_LANDSCAPE = 38
/** Deal size — spacing is calibrated so 13 cards define the squeeze baseline. */
const HAND_BASE_COUNT = 13
/** Visible strip per card at a full 13-card hand (at max card width). */
const HAND_COMFORT_PEEK = 48
/** Floor when squeezing a hand into the real rail width. */
const HAND_MIN_PEEK = 12
/**
 * If a squeezed peek would fall below this, keep this strip visible and let
 * the rail swipe horizontally instead of overflowing the page.
 */
const HAND_SWIPE_PEEK = 14
/**
 * Max fan width when holding fewer than 13 (spread multiplier can grow the fan).
 * Caps how far apart cards get so a 2–3 card hand doesn't span the whole screen.
 */
export const HAND_MAX_FAN_WIDTH =
  HAND_CARD_WIDTH_MAX + (HAND_BASE_COUNT - 1) * Math.round(HAND_COMFORT_PEEK * 1.5)

export function scaledHandCardWidth(railWidth: number, viewportHeight = 900): number {
  const heightCap =
    viewportHeight <= 540
      ? HAND_CARD_WIDTH_LANDSCAPE
      : viewportHeight <= 700
        ? 56
        : HAND_CARD_WIDTH_MAX
  const raw = Math.min(HAND_CARD_WIDTH_MAX, Math.max(HAND_CARD_WIDTH_MIN, railWidth * 0.18))
  return Math.round(Math.min(raw, heightCap))
}

export function planHandFan(
  count: number,
  railWidth: number,
  cardWidth: number,
): { peek: number; swipe: boolean; fanWidth: number } {
  if (count <= 1) return { peek: cardWidth, swipe: false, fanWidth: cardWidth }
  const comfortPeek = Math.max(
    HAND_MIN_PEEK,
    Math.round(HAND_COMFORT_PEEK * (cardWidth / HAND_CARD_WIDTH_MAX)),
  )
  const spreadMult = count <= HAND_BASE_COUNT ? HAND_BASE_COUNT / count : 1
  const desiredPeek = Math.min(cardWidth - 4, Math.round(comfortPeek * spreadMult))
  const desiredWidth = cardWidth + (count - 1) * desiredPeek
  const cap = Math.min(Math.max(0, railWidth), HAND_MAX_FAN_WIDTH)
  if (desiredWidth <= cap) {
    return { peek: desiredPeek, swipe: false, fanWidth: desiredWidth }
  }
  const squeezedPeek = (cap - cardWidth) / (count - 1)
  if (squeezedPeek >= HAND_SWIPE_PEEK) {
    return { peek: squeezedPeek, swipe: false, fanWidth: cap }
  }
  const peek = HAND_SWIPE_PEEK
  return { peek, swipe: true, fanWidth: cardWidth + (count - 1) * peek }
}
