import type { CardModel } from '../types/game'
import { AnimatedCard } from './AnimatedCard'

export const DISCARD_CARD_WIDTH = 56
/** Fraction of each card's width that the next card overlaps, leaving the rest as the visible right-edge sliver. */
const OVERLAP_RATIO = 0.72

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
}: {
  cards: CardModel[]
  /** Fires when the most-recent (top) card is clicked - begins a Top Touch (item 5). */
  onTopCardClick?: () => void
  /** Whether the top card is currently clickable (i.e. it's the local player's draw phase). */
  topCardInteractive?: boolean
}) {
  const overlapPx = DISCARD_CARD_WIDTH * OVERLAP_RATIO

  if (cards.length === 0) {
    return (
      <div className="flex h-[73px] w-[56px] items-center justify-center rounded-lg border-2 border-dashed border-white/20 text-[10px] text-white/40">
        empty
      </div>
    )
  }

  const mostRecentId = cards[cards.length - 1].id

  return (
    <div className="flex max-w-full items-end overflow-x-auto overflow-y-hidden px-3 pb-1 pt-6 scrollbar-thin">
      {cards.map((card, i) => {
        const isMostRecent = card.id === mostRecentId
        const clickable = isMostRecent && topCardInteractive && !!onTopCardClick
        return (
          <div
            key={card.id}
            className={`relative shrink-0 origin-bottom transition-transform duration-150 ease-out hover:z-40 hover:-translate-y-2 hover:scale-[1.18] hover:drop-shadow-xl ${
              clickable ? 'cursor-pointer' : ''
            }`}
            style={{ marginLeft: i === 0 ? 0 : -overlapPx, zIndex: i }}
            onClick={clickable ? onTopCardClick : undefined}
            role={clickable ? 'button' : undefined}
            title={clickable ? 'Tap to Top Touch this card' : undefined}
          >
            <AnimatedCard flipId={card.id} rank={card.rank} suit={card.suit} width={DISCARD_CARD_WIDTH} />
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
