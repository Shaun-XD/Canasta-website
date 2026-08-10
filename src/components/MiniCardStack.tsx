import { Card } from './Card'

/** Portrait card size (North teammate fan). */
const PORTRAIT_W = 30
const PORTRAIT_H = Math.round(PORTRAIT_W * 1.4)

/**
 * Side (East/West) cards are shown landscape — how a hand looks when the
 * person across from you on that side holds their cards. We render a portrait
 * Card and rotate it; after rotation the visual size is swapped.
 */
const SIDE_CARD_W = 38 // portrait width before rotate → visual height after
const SIDE_CARD_H = Math.round(SIDE_CARD_W * 1.4) // portrait height → visual width after
const SIDE_VISUAL_W = SIDE_CARD_H
const SIDE_VISUAL_H = SIDE_CARD_W

/**
 * Face-down stack showing an opponent/teammate's remaining hand size.
 * Renders one back per card (exact count) so the pile visibly shrinks as they play.
 *
 * - `horizontal` — North: portrait cards fanned left → right
 * - `side` — East/West: landscape cards stacked bottom → up (facing the table)
 */
export function MiniCardStack({
  count,
  flipAnchorId,
  orientation = 'horizontal',
}: {
  count: number
  /**
   * Optional `data-flip-anchor` id so bot/mock card flights can target this
   * stack as an origin (when melding/discarding) or destination (when drawing).
   */
  flipAnchorId?: string
  orientation?: 'horizontal' | 'vertical' | 'side'
}) {
  const n = Math.max(0, count)

  if (orientation === 'side') {
    // Generous vertical peek so you can count edges at a glance; tighten only for huge hands.
    const step = n > 18 ? 11 : n > 14 ? 13 : 15
    const width = SIDE_VISUAL_W
    const height = SIDE_VISUAL_H + Math.max(0, n - 1) * step

    return (
      <div
        className="relative shrink-0"
        style={{ width, height }}
        data-flip-anchor={flipAnchorId}
        title={`${n} card${n === 1 ? '' : 's'}`}
      >
        {Array.from({ length: n }).map((_, i) => {
          // i=0 is farthest from the player (top of column); i=n-1 is the
          // front/bottom card facing the table — fully visible, highest z.
          const fromBottom = n - 1 - i
          return (
            <div
              key={i}
              className="absolute"
              style={{
                left: 0,
                bottom: fromBottom * step,
                zIndex: i,
                width: SIDE_VISUAL_W,
                height: SIDE_VISUAL_H,
              }}
            >
              <div
                className="absolute"
                style={{
                  width: SIDE_CARD_W,
                  height: SIDE_CARD_H,
                  left: (SIDE_VISUAL_W - SIDE_CARD_W) / 2,
                  top: (SIDE_VISUAL_H - SIDE_CARD_H) / 2,
                  transform: 'rotate(90deg)',
                }}
              >
                <Card faceDown width={SIDE_CARD_W} />
              </div>
            </div>
          )
        })}
        <span className="absolute -bottom-1 -left-1 z-50 rounded-full bg-black/75 px-1.5 py-0.5 text-[10px] font-bold text-white ring-1 ring-white/15">
          {n}
        </span>
      </div>
    )
  }

  // Legacy `vertical` (portrait down) kept for compatibility; prefer `side` for E/W.
  const isVertical = orientation === 'vertical'
  // North teammate: spread enough to count edges at a glance (same idea as side stacks).
  const step = isVertical
    ? n > 14
      ? 7
      : n > 10
        ? 8
        : 9
    : n > 18
      ? 11
      : n > 14
        ? 13
        : 15
  const width = isVertical ? PORTRAIT_W : PORTRAIT_W + Math.max(0, n - 1) * step
  const height = isVertical ? PORTRAIT_H + Math.max(0, n - 1) * step : PORTRAIT_H

  return (
    <div
      className="relative shrink-0"
      style={{ width, height }}
      data-flip-anchor={flipAnchorId}
      title={`${n} card${n === 1 ? '' : 's'}`}
    >
      {Array.from({ length: n }).map((_, i) => (
        <div
          key={i}
          className="absolute"
          style={
            isVertical
              ? { top: i * step, left: 0, zIndex: i }
              : { left: i * step, top: 0, zIndex: i }
          }
        >
          <Card faceDown width={PORTRAIT_W} />
        </div>
      ))}
      <span className="absolute -bottom-1 -right-1 z-50 rounded-full bg-black/75 px-1.5 py-0.5 text-[10px] font-bold text-white ring-1 ring-white/15">
        {n}
      </span>
    </div>
  )
}
