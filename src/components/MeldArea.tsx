import { useLayoutEffect, useRef, useState } from 'react'
import type { Meld, MeldClassification, Team } from '../types/game'
import { meldCards } from '../types/game'
import { getWildMoveInfo } from '../engine/meldValidation'
import { AnimatedCard } from './AnimatedCard'

const CLASSIFICATION_LABEL: Record<MeldClassification, string> = {
  'in-progress': '',
  'mixed-canasta': 'MIXED',
  limpa: 'LIMPA',
  'mixed-canasta-2s': 'MIXED 2s',
  'limpa-2s': 'LIMPA 2s',
}

const CLASSIFICATION_TITLE: Record<MeldClassification, string> = {
  'in-progress': '',
  'mixed-canasta': 'Mixed Canasta',
  limpa: 'Limpa',
  'mixed-canasta-2s': 'Mixed Canasta of 2s',
  'limpa-2s': 'Limpa of 2s',
}

const CLASSIFICATION_COLOR: Record<MeldClassification, string> = {
  'in-progress': '',
  'mixed-canasta': 'bg-orange-400/40 text-white/80 ring-1 ring-white/15',
  limpa: 'bg-emerald-300/40 text-white/80 ring-1 ring-white/15',
  'mixed-canasta-2s': 'bg-sky-300/40 text-white/80 ring-1 ring-white/15',
  'limpa-2s': 'bg-yellow-300/40 text-white/80 ring-1 ring-white/15',
}

const MELD_CARD_MAX = 75
/** Peek as a fraction of card height — tight like the reference (index strip only). */
const MELD_PEEK_RATIO = 0.38
const MELD_GAP = 7
/** Renders a team's melds as compact vertical columns that always fit the panel width (no scroll). */
export function MeldArea({
  team,
  align = 'left',
  selectable = false,
  selectedMeldId = null,
  onSelectMeld,
  canModify = false,
  onMoveWild,
  maxCardWidth = MELD_CARD_MAX,
}: {
  team: Team
  align?: 'left' | 'right' | 'center'
  selectable?: boolean
  selectedMeldId?: string | null
  onSelectMeld?: (meldId: string) => void
  canModify?: boolean
  onMoveWild?: (meldId: string) => void
  /** Cap so table melds stay slightly smaller than the local hand cards. */
  maxCardWidth?: number
}) {
  const shellRef = useRef<HTMLDivElement>(null)
  const [cardWidth, setCardWidth] = useState(54)

  useLayoutEffect(() => {
    const el = shellRef.current
    if (!el) return
    const measure = () => {
      const n = Math.max(1, team.melds.length)
      const available = el.clientWidth - 8 // inner padding
      const perCol = (available - MELD_GAP * (n - 1)) / n
      const cap = Math.min(MELD_CARD_MAX, maxCardWidth)
      setCardWidth(Math.max(28, Math.min(cap, Math.floor(perCol))))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [team.melds.length, maxCardWidth])

  const cardHeight = Math.round(cardWidth * 1.4)
  const peekPx = Math.max(16, Math.round(cardHeight * MELD_PEEK_RATIO))
  const verticalOverlap = -(cardHeight - peekPx)

  return (
    <div
      ref={shellRef}
      className={`flex h-full min-h-0 w-full flex-nowrap items-start overflow-x-clip overflow-y-visible rounded-lg bg-black/10 px-1 pb-1 pt-3.5 sm:px-1.5 sm:pb-1.5 sm:pt-4 ${
        align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'
      }`}
      style={{ gap: MELD_GAP, minHeight: team.melds.length === 0 ? 64 : undefined }}
    >
      {team.melds.length === 0 && (
        <span className="self-center px-2 py-3 text-center text-[12px] font-medium text-white/35">No melds yet</span>
      )}
      {team.melds.map((meld) => (
        <MeldColumn
          key={meld.id}
          meld={meld}
          cardWidth={cardWidth}
          verticalOverlap={verticalOverlap}
          selectable={selectable}
          selected={selectedMeldId === meld.id}
          onSelect={onSelectMeld ? () => onSelectMeld(meld.id) : undefined}
          canModify={canModify}
          onMoveWild={onMoveWild}
        />
      ))}
    </div>
  )
}

function MeldColumn({
  meld,
  cardWidth,
  verticalOverlap,
  selectable,
  selected,
  onSelect,
  canModify,
  onMoveWild,
}: {
  meld: Meld
  cardWidth: number
  verticalOverlap: number
  selectable: boolean
  selected: boolean
  onSelect?: () => void
  canModify: boolean
  onMoveWild?: (meldId: string) => void
}) {
  // Sequences display high→low; bottom of the column is always the lowest-rank card.
  const cards = meld.type === 'sequence' ? [...meldCards(meld)].reverse() : meldCards(meld)
  const label = meld.type === 'set' ? `${meld.rank}s` : `${meld.suit} run`
  const wildMove = getWildMoveInfo(meld)
  const showMoveWild = canModify && selected && !!wildMove && !!onMoveWild
  const hasMovableTwo =
    meld.type === 'sequence' &&
    meld.slots.some((s) => s.card.rank === '2' && s.card.suit === meld.suit && s.slotRank === '2' && !s.isWildFill)

  // Completed canasta / limpa: lay the bottom card sideways as the completion marker.
  // If a lower card is later added, it becomes the new bottom and takes the sideways slot.
  const isComplete = meld.isCanasta
  const cardHeight = Math.round(cardWidth * 1.4)
  const bottomIndex = cards.length - 1
  const colMaxW = isComplete ? cardHeight + 6 : cardWidth + 4
  const classLabel = CLASSIFICATION_LABEL[meld.classification]
  const classTitle = CLASSIFICATION_TITLE[meld.classification]

  return (
    <div className="relative flex min-w-0 flex-1 flex-col items-center gap-0.5" style={{ maxWidth: colMaxW }}>
      <button
        type="button"
        onClick={onSelect}
        disabled={!selectable}
        title={`${label}${classTitle ? ` · ${classTitle}` : ''}`}
        className={`relative flex w-full flex-col items-center overflow-visible rounded-md px-0.5 py-0.5 transition ${
          selectable ? 'cursor-pointer hover:bg-white/10' : 'cursor-default'
        } ${selected ? 'ring-2 ring-yellow-300' : ''}`}
      >
        {isComplete && classLabel && (
          <span
            className={`pointer-events-none absolute left-1/2 top-0 z-20 -translate-x-1/2 -translate-y-[110%] whitespace-nowrap rounded-full px-1.5 py-px text-[8px] font-semibold uppercase leading-none tracking-wide ${CLASSIFICATION_COLOR[meld.classification]}`}
          >
            {classLabel}
          </span>
        )}
        {cards.map((card, i) => {
          const isSideways = isComplete && i === bottomIndex
          const marginTop =
            i === 0 ? 0 : isSideways ? -Math.round(cardWidth * 0.3) : verticalOverlap

          return (
            <AnimatedCard
              key={card.id}
              flipId={card.id}
              rank={card.rank}
              suit={card.suit}
              width={cardWidth}
              style={
                isSideways
                  ? {
                      marginTop,
                      zIndex: i,
                      width: cardHeight,
                      height: cardWidth,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }
                  : { marginTop, zIndex: i }
              }
              wrapperClassName={
                isSideways
                  ? 'rotate-90 transition-transform duration-200 ease-out'
                  : 'transition-transform duration-200 ease-out'
              }
            />
          )
        })}
        {(meld.wildCount > 0 || hasMovableTwo) && !meld.isCanasta && (
          <span className="pointer-events-none absolute -bottom-0.5 right-0 z-20 rounded-full bg-purple-400/40 px-1 py-px text-[6px] font-semibold uppercase leading-none tracking-wide text-white/80 ring-1 ring-white/15">
            {meld.wildCount > 0 ? 'WILD' : '2★'}
          </span>
        )}
      </button>
      {showMoveWild && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onMoveWild?.(meld.id)
          }}
          title={wildMove!.nextLabel}
          className="mt-0.5 min-h-8 w-[70%] min-w-[3.25rem] rounded-lg bg-emerald-500 px-2 py-1.5 text-[10px] font-bold leading-tight text-emerald-950 shadow-md ring-1 ring-emerald-400/70 transition hover:bg-emerald-400 active:scale-[0.98] sm:text-[11px]"
        >
          Move Wild
        </button>
      )}
    </div>
  )
}
