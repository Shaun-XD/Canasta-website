import { memo } from 'react'
import type { Rank, Suit } from '../types/game'

/**
 * Card faces are the generated PNG pack in `public/cards/`
 * (see `scripts/generate_card_faces.py`). The card back stays as inline SVG.
 */

export interface CardProps {
  rank?: Rank
  suit?: Suit | null
  faceDown?: boolean
  selected?: boolean
  /**
   * When selected, lift the card with `-translate-y-3`. Set false when a
   * parent already applies selection lift (e.g. discard pile padding/clip).
   */
  liftOnSelect?: boolean
  className?: string
  width?: number
  onClick?: () => void
}

const CARD_W = 100
const CARD_H = 140

const RANK_SLUG: Record<Rank, string> = {
  A: 'ace',
  '2': '2',
  '3': '3',
  '4': '4',
  '5': '5',
  '6': '6',
  '7': '7',
  '8': '8',
  '9': '9',
  '10': '10',
  J: 'jack',
  Q: 'queen',
  K: 'king',
  JOKER: 'joker',
}

function faceSrc(rank: Rank, suit: Suit | null): string {
  if (rank === 'JOKER' || !suit) return '/cards/joker.png'
  return `/cards/${RANK_SLUG[rank]}_of_${suit}.png`
}

function CardBackFace() {
  return (
    <svg viewBox={`0 0 ${CARD_W} ${CARD_H}`} width="100%" height="100%" aria-hidden>
      <defs>
        <pattern id="card-back-hatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="10" height="10" fill="#1e3a8a" />
          <line x1="0" y1="0" x2="0" y2="10" stroke="#3b5bdb" strokeWidth="2" />
        </pattern>
      </defs>
      <rect width={CARD_W} height={CARD_H} rx="8" fill="#0f2a63" />
      <rect x="4" y="4" width={CARD_W - 8} height={CARD_H - 8} rx="6" fill="url(#card-back-hatch)" stroke="#93c5fd" strokeWidth="1.5" />
      <rect x="14" y="14" width={CARD_W - 28} height={CARD_H - 28} rx="4" fill="none" stroke="#93c5fd" strokeWidth="1.5" opacity="0.8" />
      <circle cx={CARD_W / 2} cy={CARD_H / 2} r="16" fill="#0f2a63" stroke="#93c5fd" strokeWidth="1.5" />
      <text
        x={CARD_W / 2}
        y={CARD_H / 2 + 6}
        textAnchor="middle"
        fontSize="16"
        fontWeight="700"
        fill="#93c5fd"
        fontFamily="system-ui, sans-serif"
      >
        C
      </text>
    </svg>
  )
}

function CardFace({ rank, suit }: { rank: Rank; suit: Suit | null }) {
  return (
    <img
      src={faceSrc(rank, suit)}
      alt={`${rank}${suit ? ` of ${suit}` : ''}`}
      draggable={false}
      className="pointer-events-none block h-full w-full object-cover"
    />
  )
}

export const Card = memo(function Card({
  rank,
  suit = null,
  faceDown = false,
  selected = false,
  liftOnSelect = true,
  className = '',
  width = 64,
  onClick,
}: CardProps) {
  const height = width * (CARD_H / CARD_W)

  const showFace = !(faceDown || !rank)

  // Decorative cards (no onClick) must be a <div>, not a <button>. Nesting a
  // button inside the stock pile's outer <button> breaks clicks in browsers.
  const classNames = `relative shrink-0 overflow-hidden rounded-[8px] shadow-md transition-transform duration-150 ease-out ${
    showFace ? 'box-border border border-[#5b7c99] bg-[#faf8f4]' : ''
  } ${onClick ? 'cursor-pointer hover:-translate-y-1' : 'cursor-default'} ${
    selected ? `ring-2 ring-yellow-300 ${liftOnSelect ? '-translate-y-3' : ''}` : ''
  } ${className}`

  const face = showFace ? <CardFace rank={rank!} suit={suit} /> : <CardBackFace />

  if (onClick) {
    return (
      <button type="button" onClick={onClick} style={{ width, height }} className={classNames}>
        {face}
      </button>
    )
  }

  return (
    <div style={{ width, height }} className={classNames} aria-hidden>
      {face}
    </div>
  )
})
