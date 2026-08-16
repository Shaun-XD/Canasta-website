import { Card } from './Card'

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
  dense = false,
}: {
  count: number
  /**
   * Optional `data-flip-anchor` id so bot/mock card flights can target this
   * stack as an origin (when melding/discarding) or destination (when drawing).
   */
  flipAnchorId?: string
  orientation?: 'horizontal' | 'vertical' | 'side'
  /** Smaller stacks used only on phone / tablet tables. */
  dense?: boolean
}) {
  const n = Math.max(0, count)

  if (orientation === 'side') {
    if (dense) {
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
                key={i}
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
                  <Card faceDown width={DENSE_SIDE_CARD_W} />
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

  const isVertical = orientation === 'vertical'
  const portraitW = dense ? DENSE_PORTRAIT_W : PORTRAIT_W
  const portraitH = dense ? DENSE_PORTRAIT_H : PORTRAIT_H
  const step = dense
    ? isVertical
      ? n > 14
        ? 5
        : 6
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
          key={i}
          className="absolute"
          style={
            isVertical
              ? { top: i * step, left: 0, zIndex: i }
              : { left: i * step, top: 0, zIndex: i }
          }
        >
          <Card faceDown width={portraitW} />
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
