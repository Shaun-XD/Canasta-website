import { useLayoutEffect, useRef } from 'react'
import type { CardModel } from '../types/game'
import { AnimatedCard } from './AnimatedCard'

export const DISCARD_CARD_WIDTH = 64
/** How many cards fit in the visible window before older ones hide to the left. */
export const DISCARD_VISIBLE_CARDS = 9
/** Fraction of each card's width covered by the next — constant so the 9-card window stays readable. */
export const DISCARD_OVERLAP_RATIO = 0.55
/**
 * Max pointer travel (px) between pointerdown and the matching click for a
 * gesture to still count as a "tap" that toggles selection. Anything past
 * this is treated as a scroll/drag through the pile instead.
 */
const CLICK_DRAG_THRESHOLD_PX = 6

/** Visible slot width for `count` cards (capped at {@link DISCARD_VISIBLE_CARDS}). */
export function discardFanWidth(cardWidth: number, count: number): number {
  const n = Math.max(0, Math.min(DISCARD_VISIBLE_CARDS, count))
  if (n <= 1) return Math.round(cardWidth)
  const peek = cardWidth * (1 - DISCARD_OVERLAP_RATIO)
  return Math.round(cardWidth + (n - 1) * peek)
}

/**
 * Renders the ENTIRE discard pile as a fanned spread. Oldest is left / newest
 * is right (FIFO). At most {@link DISCARD_VISIBLE_CARDS} cards fit in the
 * slot; older cards hide to the left and the fan scrolls horizontally with
 * no scrollbar. The view pins to the latest card whenever the top changes.
 *
 * Once a Top Touch is in progress, any card in the pile becomes clickable:
 * clicking toggles that card alone in/out of the meld candidate set (the
 * top/most-recent card is always included and cannot be deselected).
 *
 * Hover must NOT scale, translate, or filter (drop-shadow) these cards —
 * that clips the face. Highlight with a ring only.
 */
export function DiscardPileView({
  cards,
  cardWidth = DISCARD_CARD_WIDTH,
  maxWidth,
  showBadge = true,
  onTopCardClick,
  topCardInteractive = false,
  topTouchInProgress = false,
  selectedDiscardIds = [],
  onToggleDiscardCard,
}: {
  cards: CardModel[]
  /** Face width; defaults to {@link DISCARD_CARD_WIDTH}. Scaled down on phones. */
  cardWidth?: number
  /** Optional ceiling so a 9-card window cannot eat the hand on tiny docks. */
  maxWidth?: number
  /** PICK-UP label on the top card. Off when labels would collide with overlays. */
  showBadge?: boolean
  /** Fires when the most-recent (top) card is clicked - begins a Top Touch (item 5). */
  onTopCardClick?: () => void
  /** Whether the top card is currently clickable (i.e. it's the local player's draw phase). */
  topCardInteractive?: boolean
  /** True while a Top Touch selection is in progress - makes every pile card clickable to toggle selection. */
  topTouchInProgress?: boolean
  /** Ids of discard cards currently selected as meld candidates. */
  selectedDiscardIds?: string[]
  /** Fires with a card's id when it's clicked during an in-progress Top Touch. */
  onToggleDiscardCard?: (cardId: string) => void
}) {
  const overlapPx = cardWidth * DISCARD_OVERLAP_RATIO
  const idealWidth = discardFanWidth(cardWidth, cards.length)
  const fanCap = Math.round(maxWidth != null ? Math.min(maxWidth, idealWidth) : idealWidth)
  const contentWidth =
    cards.length <= 1 ? cardWidth : cardWidth + (cards.length - 1) * (cardWidth - overlapPx)
  const needsHScroll = contentWidth > fanCap + 0.5
  const selectedSet = new Set(selectedDiscardIds)
  const topCard = cards[cards.length - 1]
  const topId = topCard?.id

  const scrollerRef = useRef<HTMLDivElement>(null)
  const pointerDownAt = useRef<{ x: number; y: number } | null>(null)
  const scrollAtDown = useRef(0)
  const wasDrag = useRef(false)

  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el || !needsHScroll) return
    el.scrollLeft = el.scrollWidth
  }, [topId, cards.length, needsHScroll, fanCap])

  function handleRowPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    pointerDownAt.current = { x: e.clientX, y: e.clientY }
    scrollAtDown.current = scrollerRef.current?.scrollLeft ?? 0
    wasDrag.current = false
    if (needsHScroll && e.pointerType === 'mouse') {
      e.currentTarget.setPointerCapture(e.pointerId)
    }
  }

  function handleRowPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const start = pointerDownAt.current
    if (!start) return
    const dx = e.clientX - start.x
    const dist = Math.hypot(dx, e.clientY - start.y)
    if (dist <= CLICK_DRAG_THRESHOLD_PX) return
    wasDrag.current = true
    if (needsHScroll && e.pointerType === 'mouse' && scrollerRef.current) {
      scrollerRef.current.scrollLeft = scrollAtDown.current - dx
    }
  }

  function handleRowPointerEnd() {
    pointerDownAt.current = null
  }

  if (cards.length === 0) {
    const emptyH = Math.round(cardWidth * 1.4)
    return (
      <div
        className="rounded-lg border-2 border-dashed border-white/20"
        style={{ width: cardWidth, height: emptyH }}
        aria-label="Discard pile empty"
      />
    )
  }

  const topIndex = cards.length - 1

  return (
    <div className="relative shrink-0" style={{ width: fanCap, maxWidth: fanCap }}>
      {needsHScroll && (
        <div
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-5 bg-gradient-to-r from-black/45 to-transparent"
          aria-hidden
        />
      )}
      <div
        ref={scrollerRef}
        className={`discard-fan flex items-end p-0 leading-none ${
          needsHScroll ? 'overflow-x-auto overflow-y-hidden' : 'overflow-hidden'
        }`}
        style={{ width: fanCap, maxWidth: fanCap, touchAction: needsHScroll ? 'pan-x' : 'manipulation' }}
        onPointerDown={handleRowPointerDown}
        onPointerMove={handleRowPointerMove}
        onPointerUp={handleRowPointerEnd}
        onPointerCancel={handleRowPointerEnd}
      >
        {cards.map((card, i) => {
          const isMostRecent = i === topIndex
          const isSelected = topTouchInProgress && selectedSet.has(card.id)
          const clickableToBegin = isMostRecent && topCardInteractive && !!onTopCardClick
          const clickableToToggle = topTouchInProgress && !!onToggleDiscardCard
          const clickable = clickableToBegin || clickableToToggle
          const action = clickableToToggle
            ? () => onToggleDiscardCard!(card.id)
            : clickableToBegin
              ? onTopCardClick
              : undefined
          const handleClick = action
            ? () => {
                if (wasDrag.current) return
                action()
              }
            : undefined
          return (
            <div
              key={card.id}
              className={`group relative block shrink-0 leading-none hover:z-40 ${clickable ? 'cursor-pointer' : ''}`}
              style={{ marginLeft: i === 0 ? 0 : -overlapPx, zIndex: isSelected ? 30 + i : i }}
              onClick={handleClick}
              role={clickable ? 'button' : undefined}
              title={
                clickableToToggle
                  ? isMostRecent
                    ? 'Top card is required for Top Touch'
                    : isSelected
                      ? 'Tap to remove this card from the Top Touch selection'
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
                width={cardWidth}
                selected={isSelected}
                liftOnSelect={false}
                wrapperClassName={clickable ? 'group-hover:ring-2 group-hover:ring-amber-300/90' : ''}
              />
              {showBadge && isMostRecent && (
                <span className="pointer-events-none absolute -top-6 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-full bg-amber-400 px-1.5 py-0.5 text-[8px] font-bold leading-none text-amber-950 shadow ring-1 ring-amber-200">
                  PICK-UP
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
