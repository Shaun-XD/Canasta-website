import { useRef } from 'react'
import type { CardModel } from '../types/game'
import { AnimatedCard } from './AnimatedCard'

export const DISCARD_CARD_WIDTH = 72
/** Fraction of each card's width that the next card overlaps, leaving the rest as the visible right-edge sliver. */
const OVERLAP_RATIO = 0.7
/**
 * Max pointer travel (px) between pointerdown and the matching click for a
 * gesture to still count as a "tap" that toggles selection. Anything past
 * this is treated as a scroll/drag through the pile instead, so browsing
 * the fanned spread (e.g. a trackpad/touch swipe, or a click-drag on the
 * scrollbar) never gets misread as a card selection.
 */
const CLICK_DRAG_THRESHOLD_PX = 6

/**
 * Renders the ENTIRE discard pile as a fanned spread (items 3 & 4 of the
 * original animation spec) instead of just the top card, since Canasta
 * requires picking up the whole pile and the full history matters.
 *
 * Ordering: `cards` is oldest-first / most-recent-last (matching how the
 * store appends new discards to the end of the array). The Canasta "Top
 * Touch" rule cares about the LAST card thrown down, so that card - the
 * final one in the array - is rendered as the most exposed/topmost card in
 * the fan (highest z-index, fully visible) and carries the "PICK-UP" badge.
 * Earlier cards fan out behind/underneath it in play order.
 *
 * Once a Top Touch is in progress, any card in the pile becomes clickable:
 * clicking one toggles the contiguous top-down run of candidate cards to
 * end at (include) or just above (exclude) that card - since cards can only
 * ever be taken off the pile from the top down, the selection can never
 * skip into the middle. Selected cards get the same lifted/ringed treatment
 * used for selected hand cards (see `AnimatedCard`'s `selected` prop).
 *
 * Hovering a card gives it a gentle in-place "lift" (slight scale + upward
 * translate + shadow) - the same lightweight treatment as hovering a card in
 * the player's own hand (see `Card.tsx`'s `hover:-translate-y-1`) - rather
 * than a large detached floating preview. Nothing slides in from off-screen
 * and neighboring cards are never obscured by a separate layer.
 */
export function DiscardPileView({
  cards,
  onTopCardClick,
  topCardInteractive = false,
  topTouchInProgress = false,
  selectedDiscardCount = 0,
  onToggleDiscardCard,
}: {
  cards: CardModel[]
  /** Fires when the most-recent (top) card is clicked - begins a Top Touch (item 5). */
  onTopCardClick?: () => void
  /** Whether the top card is currently clickable (i.e. it's the local player's draw phase). */
  topCardInteractive?: boolean
  /** True while a Top Touch selection is in progress - makes every pile card clickable to extend/shrink the selection. */
  topTouchInProgress?: boolean
  /** How many cards counting down from the top of the pile are currently selected as meld candidates. */
  selectedDiscardCount?: number
  /** Fires with a card's id when it's clicked during an in-progress Top Touch. */
  onToggleDiscardCard?: (cardId: string) => void
}) {
  const overlapPx = DISCARD_CARD_WIDTH * OVERLAP_RATIO

  // Tracks the pointer's down position and whether it has since travelled
  // past the drag threshold, at the row level rather than per-card - a
  // scroll/drag gesture routinely moves the pointer off whichever card it
  // started on, so listening on individual cards would lose track of it.
  // Native scrolling (wheel, trackpad, touch swipe, scrollbar drag) is left
  // completely untouched - this only ever reads pointer positions, never
  // calls `preventDefault` or captures the pointer, so it can't interfere
  // with it.
  const pointerDownAt = useRef<{ x: number; y: number } | null>(null)
  const wasDrag = useRef(false)

  function handleRowPointerDown(e: React.PointerEvent) {
    pointerDownAt.current = { x: e.clientX, y: e.clientY }
    wasDrag.current = false
  }

  function handleRowPointerMove(e: React.PointerEvent) {
    const start = pointerDownAt.current
    if (!start) return
    const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y)
    if (dist > CLICK_DRAG_THRESHOLD_PX) wasDrag.current = true
  }

  function handleRowPointerEnd() {
    pointerDownAt.current = null
  }

  if (cards.length === 0) {
    const emptyH = Math.round(DISCARD_CARD_WIDTH * 1.4)
    return (
      <div
        className="flex items-center justify-center rounded-lg border-2 border-dashed border-white/20 text-[10px] text-white/40"
        style={{ width: DISCARD_CARD_WIDTH, height: emptyH }}
      >
        empty
      </div>
    )
  }

  const topIndex = cards.length - 1

  return (
    <div
      className="flex max-w-full items-end overflow-x-auto overflow-y-hidden px-3 pb-1 pt-6 scrollbar-thin"
      onPointerDown={handleRowPointerDown}
      onPointerMove={handleRowPointerMove}
      onPointerUp={handleRowPointerEnd}
      onPointerCancel={handleRowPointerEnd}
    >
      {cards.map((card, i) => {
        const isMostRecent = i === topIndex
        const distanceFromTop = topIndex - i
        const isSelected = topTouchInProgress && distanceFromTop < selectedDiscardCount
        const clickableToBegin = isMostRecent && topCardInteractive && !!onTopCardClick
        const clickableToToggle = topTouchInProgress && !!onToggleDiscardCard
        const clickable = clickableToBegin || clickableToToggle
        const action = clickableToToggle
          ? () => onToggleDiscardCard!(card.id)
          : clickableToBegin
            ? onTopCardClick
            : undefined
        // Only actually fire the action if this "click" wasn't the tail end
        // of a scroll/drag gesture (see `wasDrag` above) - a genuine tap
        // toggles selection, a swipe/drag through the pile does nothing.
        const handleClick = action
          ? () => {
              if (wasDrag.current) return
              action()
            }
          : undefined
        return (
          // Outer wrapper is a `group` so hover can raise z-index (stacking
          // only - does NOT affect layout/getBoundingClientRect) while the
          // actual scale/translate lift lives on AnimatedCard's INNER
          // visual wrapper via `wrapperClassName`. Putting those transforms
          // on this outer node used to make every re-render-while-hovered
          // look like a FLIP move, which hid the whole discard pile.
          <div
            key={card.id}
            className={`group relative shrink-0 hover:z-40 ${clickable ? 'cursor-pointer' : ''}`}
            style={{ marginLeft: i === 0 ? 0 : -overlapPx, zIndex: isSelected ? 30 + i : i }}
            onClick={handleClick}
            role={clickable ? 'button' : undefined}
            title={
              clickableToToggle
                ? isSelected
                  ? 'Tap to remove this card (and any below it) from the Top Touch selection'
                  : 'Tap to add this card to the Top Touch selection'
                : clickableToBegin
                  ? 'Tap to Top Touch this card'
                  : undefined
            }
          >
            <AnimatedCard
              flipId={card.id}
              rank={card.rank}
              suit={card.suit}
              width={DISCARD_CARD_WIDTH}
              selected={isSelected}
              wrapperClassName="origin-bottom transition-transform duration-150 ease-out group-hover:-translate-y-2 group-hover:scale-[1.18] group-hover:drop-shadow-xl"
            />
            {isMostRecent && (
              <span className="pointer-events-none absolute -top-5 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-full bg-amber-400 px-1.5 py-0.5 text-[8px] font-bold leading-none text-amber-950 shadow ring-1 ring-amber-200">
                PICK-UP
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
