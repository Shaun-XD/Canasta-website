import { Card } from './Card'
import type { CardModel } from '../types/game'

/** Desktop (pre-compact) sizes. */
const PORTRAIT_W = 30
const PORTRAIT_H = Math.round(PORTRAIT_W * 1.4)
const SIDE_CARD_W = 38
const SIDE_CARD_H = Math.round(SIDE_CARD_W * 1.4)
const SIDE_VISUAL_W = SIDE_CARD_H
const SIDE_VISUAL_H = SIDE_CARD_W

/** Phone / tablet sizes. */
const DENSE_PORTRAIT_W = 22
const DENSE_PORTRAIT_H = Math.round(DENSE_PORTRAIT_W * 1.4)
const DENSE_SIDE_CARD_W = 22
const DENSE_SIDE_CARD_H = Math.round(DENSE_SIDE_CARD_W * 1.4)
const DENSE_SIDE_VISUAL_W = DENSE_SIDE_CARD_H
const DENSE_SIDE_VISUAL_H = DENSE_SIDE_CARD_W
const DENSE_SIDE_MAX_VISIBLE = 9
const DENSE_SIDE_STEP = 6

function isOpaquePlaceholder(card: CardModel): boolean {
  return card.id.startsWith('hidden-')
}

function MiniFace({ card, faceUp, width }: { card?: CardModel; faceUp: boolean; width: number }) {
  const show = faceUp && !!card && !isOpaquePlaceholder(card)
  return (
    <Card
      faceDown={!show}
      rank={show ? card.rank : undefined}
      suit={show ? card.suit : undefined}
      width={width}
    />
  )
}

/**
 * Opponent/teammate hand stack.
 * Face-down during play (count only). After scoring, pass `cards` + `faceUp`
 * to open remaining cards at that seat.
 *
 * - `horizontal` — North: portrait cards fanned left → right
 * - `side` — East/West: landscape cards stacked bottom → up (facing the table)
 */
export function MiniCardStack({
  count,
  cards,
  faceUp = false,
  flipAnchorId,
  orientation = 'horizontal',
  dense = false,
}: {
  count: number
  /** When provided with `faceUp`, remaining cards are shown face-up. */
  cards?: CardModel[]
  faceUp?: boolean
  /**
   * Optional `data-flip-anchor` id so bot/mock card flights can target this
   * stack as an origin (when melding/discarding) or destination (when drawing).
   */
  flipAnchorId?: string
  orientation?: 'horizontal' | 'vertical' | 'side'
  /** Smaller stacks used only on phone / tablet tables. */
  dense?: boolean
}) {
  const source = cards ?? []
  const n = Math.max(source.length, Math.max(0, count))
  const showFaces = faceUp && source.some((c) => !isOpaquePlaceholder(c))

  if (orientation === 'side') {
    if (dense && !showFaces) {
      const shown = Math.min(n, DENSE_SIDE_MAX_VISIBLE)
      const width = DENSE_SIDE_VISUAL_W
      const height = DENSE_SIDE_VISUAL_H + Math.max(0, shown - 1) * DENSE_SIDE_STEP

      return (
        <div
          className="relative shrink-0"
          style={{ width, height }}
          data-flip-anchor={flipAnchorId}
          title={`${n} card${n === 1 ? '' : 's'}`}
        >
          {Array.from({ length: shown }).map((_, i) => {
            const fromBottom = shown - 1 - i
            return (
              <div
                key={source[i]?.id ?? i}
                className="absolute"
                style={{
                  left: 0,
                  bottom: fromBottom * DENSE_SIDE_STEP,
                  zIndex: i,
                  width: DENSE_SIDE_VISUAL_W,
                  height: DENSE_SIDE_VISUAL_H,
                }}
              >
                <div
                  className="absolute"
                  style={{
                    width: DENSE_SIDE_CARD_W,
                    height: DENSE_SIDE_CARD_H,
                    left: (DENSE_SIDE_VISUAL_W - DENSE_SIDE_CARD_W) / 2,
                    top: (DENSE_SIDE_VISUAL_H - DENSE_SIDE_CARD_H) / 2,
                    transform: 'rotate(90deg)',
                  }}
                >
                  <MiniFace card={source[i]} faceUp={false} width={DENSE_SIDE_CARD_W} />
                </div>
              </div>
            )
          })}
          <span className="absolute -bottom-1 -left-1 z-50 rounded-full bg-black/75 px-1 py-px text-[9px] font-bold leading-none text-white ring-1 ring-white/15">
            {n}
          </span>
        </div>
      )
    }

    const cardW = dense ? DENSE_SIDE_CARD_W : SIDE_CARD_W
    const cardH = dense ? DENSE_SIDE_CARD_H : SIDE_CARD_H
    const visualW = dense ? DENSE_SIDE_VISUAL_W : SIDE_VISUAL_W
    const visualH = dense ? DENSE_SIDE_VISUAL_H : SIDE_VISUAL_H
    const step = showFaces
      ? dense
        ? n > 18
          ? 10
          : 12
        : n > 18
          ? 16
          : n > 12
            ? 18
            : 20
      : n > 18
        ? 11
        : n > 14
          ? 13
          : 15
    const width = visualW
    const height = visualH + Math.max(0, n - 1) * step

    return (
      <div
        className="relative shrink-0"
        style={{ width, height }}
        data-flip-anchor={flipAnchorId}
        title={`${n} card${n === 1 ? '' : 's'}`}
      >
        {Array.from({ length: n }).map((_, i) => {
          const fromBottom = n - 1 - i
          return (
            <div
              key={source[i]?.id ?? i}
              className="absolute"
              style={{
                left: 0,
                bottom: fromBottom * step,
                zIndex: i,
                width: visualW,
                height: visualH,
              }}
            >
              <div
                className="absolute"
                style={{
                  width: cardW,
                  height: cardH,
                  left: (visualW - cardW) / 2,
                  top: (visualH - cardH) / 2,
                  transform: 'rotate(90deg)',
                }}
              >
                <MiniFace card={source[i]} faceUp={showFaces} width={cardW} />
              </div>
            </div>
          )
        })}
        <span
          className={`absolute -bottom-1 -left-1 z-50 rounded-full bg-black/75 font-bold text-white ring-1 ring-white/15 ${
            dense ? 'px-1 py-px text-[9px] leading-none' : 'px-1.5 py-0.5 text-[10px]'
          }`}
        >
          {n}
        </span>
      </div>
    )
  }

  const isVertical = orientation === 'vertical'
  const portraitW = dense ? DENSE_PORTRAIT_W : PORTRAIT_W
  const portraitH = dense ? DENSE_PORTRAIT_H : PORTRAIT_H
  const step = dense
    ? isVertical
      ? n > 14
        ? 5
        : 6
      : showFaces
        ? n > 18
          ? 10
          : n > 12
            ? 12
            : 14
        : n > 18
          ? 7
          : n > 14
            ? 8
            : 9
    : isVertical
      ? n > 14
        ? 7
        : n > 10
          ? 8
          : 9
      : showFaces
        ? n > 18
          ? 14
          : n > 12
            ? 16
            : 18
        : n > 18
          ? 11
          : n > 14
            ? 13
            : 15
  const width = isVertical ? portraitW : portraitW + Math.max(0, n - 1) * step
  const height = isVertical ? portraitH + Math.max(0, n - 1) * step : portraitH

  return (
    <div
      className="relative shrink-0"
      style={{ width, height }}
      data-flip-anchor={flipAnchorId}
      title={`${n} card${n === 1 ? '' : 's'}`}
    >
      {Array.from({ length: n }).map((_, i) => (
        <div
          key={source[i]?.id ?? i}
          className="absolute"
          style={
            isVertical
              ? { top: i * step, left: 0, zIndex: i }
              : { left: i * step, top: 0, zIndex: i }
          }
        >
          <MiniFace card={source[i]} faceUp={showFaces} width={portraitW} />
        </div>
      ))}
      <span
        className={`absolute -bottom-1 -right-1 z-50 rounded-full bg-black/75 font-bold text-white ring-1 ring-white/15 ${
          dense ? 'px-1 py-px text-[9px] leading-none' : 'px-1.5 py-0.5 text-[10px]'
        }`}
      >
        {n}
      </span>
    </div>
  )
}
