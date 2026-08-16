import { Card } from './Card'

/** Portrait card size (North teammate fan). */
const PORTRAIT_W = 22
const PORTRAIT_H = Math.round(PORTRAIT_W * 1.4)

/**
 * Side (East/West) cards — small count chip, not a full-size hand.
 * Portrait Card rotated 90°; visual size is swapped after rotate.
 */
const SIDE_CARD_W = 22
const SIDE_CARD_H = Math.round(SIDE_CARD_W * 1.4)
const SIDE_VISUAL_W = SIDE_CARD_H
const SIDE_VISUAL_H = SIDE_CARD_W
const SIDE_MAX_VISIBLE = 9
const SIDE_STEP = 6

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
    const shown = Math.min(n, SIDE_MAX_VISIBLE)
    const width = SIDE_VISUAL_W
    const height = SIDE_VISUAL_H + Math.max(0, shown - 1) * SIDE_STEP

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
              key={i}
              className="absolute"
              style={{
                left: 0,
                bottom: fromBottom * SIDE_STEP,
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
        <span className="absolute -bottom-1 -left-1 z-50 rounded-full bg-black/75 px-1 py-px text-[9px] font-bold leading-none text-white ring-1 ring-white/15">
          {n}
        </span>
      </div>
    )
  }

  // Legacy `vertical` (portrait down) kept for compatibility; prefer `side` for E/W.
  const isVertical = orientation === 'vertical'
  const step = isVertical ? (n > 14 ? 5 : 6) : n > 18 ? 7 : n > 14 ? 8 : 9
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
      <span className="absolute -bottom-1 -right-1 z-50 rounded-full bg-black/75 px-1 py-px text-[9px] font-bold leading-none text-white ring-1 ring-white/15">
        {n}
      </span>
    </div>
  )
}
