import { memo } from 'react'
import type { Rank, Suit } from '../types/game'
import { RED_SUITS, SUIT_SYMBOLS } from '../types/game'

/**
 * Custom, in-project generated card visuals.
 *
 * All 52 standard faces + 2 jokers + the card back are rendered
 * procedurally from this single component using plain SVG - there are no
 * external image assets. See `assets/MANIFEST.json` for the asset
 * inventory/licensing note.
 *
 * Face layout prioritizes a large top-left rank + suit index so fanned /
 * overlapped hands stay readable on mobile (especially for elderly players).
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

// Normalized (0-1) pip positions for number cards, using the classic
// playing-card layout convention. Positions are mirrored top/bottom via a
// 180deg rotation for a natural look.
const PIP_LAYOUTS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.5, 0.22], [0.5, 0.78]],
  3: [[0.5, 0.22], [0.5, 0.5], [0.5, 0.78]],
  4: [[0.3, 0.22], [0.7, 0.22], [0.3, 0.78], [0.7, 0.78]],
  5: [[0.3, 0.22], [0.7, 0.22], [0.5, 0.5], [0.3, 0.78], [0.7, 0.78]],
  6: [[0.3, 0.22], [0.7, 0.22], [0.3, 0.5], [0.7, 0.5], [0.3, 0.78], [0.7, 0.78]],
  7: [
    [0.3, 0.22], [0.7, 0.22], [0.5, 0.36], [0.3, 0.5], [0.7, 0.5],
    [0.3, 0.78], [0.7, 0.78],
  ],
  8: [
    [0.3, 0.2], [0.7, 0.2], [0.5, 0.36], [0.3, 0.5], [0.7, 0.5],
    [0.5, 0.64], [0.3, 0.8], [0.7, 0.8],
  ],
  9: [
    [0.3, 0.18], [0.7, 0.18], [0.3, 0.4], [0.7, 0.4], [0.5, 0.5],
    [0.3, 0.6], [0.7, 0.6], [0.3, 0.82], [0.7, 0.82],
  ],
  10: [
    [0.3, 0.16], [0.7, 0.16], [0.5, 0.28], [0.3, 0.4], [0.7, 0.4],
    [0.3, 0.6], [0.7, 0.6], [0.5, 0.72], [0.3, 0.84], [0.7, 0.84],
  ],
}

function rankToPipCount(rank: Rank): number | null {
  if (rank === 'A') return 1
  const n = Number(rank)
  if (!Number.isNaN(n) && n >= 2 && n <= 10) return n
  return null
}

function CardBackFace() {
  return (
    <svg viewBox={`0 0 ${CARD_W} ${CARD_H}`} width="100%" height="100%">
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

function JokerFace() {
  return (
    <svg viewBox={`0 0 ${CARD_W} ${CARD_H}`} width="100%" height="100%">
      <rect width={CARD_W} height={CARD_H} rx="8" fill="#ffffff" stroke="#1f2937" strokeWidth="1.5" />
      {/* Large top-left label so overlapped hands stay readable on mobile */}
      <text
        x={CORNER_X}
        y={28}
        fontSize="18"
        fontWeight="800"
        fill="#7c3aed"
        fontFamily="system-ui, -apple-system, sans-serif"
        textAnchor="middle"
      >
        J
      </text>
      <text
        x={CORNER_X}
        y={50}
        fontSize="11"
        fontWeight="800"
        fill="#7c3aed"
        fontFamily="system-ui, -apple-system, sans-serif"
        textAnchor="middle"
      >
        OK
      </text>
      <g transform={`translate(${CARD_W / 2 + 8}, ${CARD_H / 2 + 8})`}>
        <circle r="24" fill="#7c3aed" opacity="0.12" />
        {/* simple jester-hat glyph, original geometric shape */}
        <path
          d="M -18 10 L -18 -6 L -6 4 L 0 -14 L 6 4 L 18 -6 L 18 10 Z"
          fill="#7c3aed"
        />
        <circle cx="-18" cy="-8" r="3.5" fill="#f59e0b" />
        <circle cx="0" cy="-16" r="3.5" fill="#ef4444" />
        <circle cx="18" cy="-8" r="3.5" fill="#22c55e" />
        <rect x="-18" y="10" width="36" height="6" rx="2" fill="#7c3aed" />
      </g>
    </svg>
  )
}

/**
 * Oversized top-left (and mirrored bottom-right) rank + suit.
 * Sized for elderly / mobile readability when hands are fanned and only
 * the left strip of each card is visible.
 */
function CornerLabel({
  rank,
  suit,
  x,
  y,
  rotate,
  size = 'lg',
}: {
  rank: Rank
  suit: Suit
  x: number
  y: number
  rotate?: boolean
  size?: 'lg' | 'sm'
}) {
  const color = RED_SUITS.includes(suit) ? '#dc2626' : '#111827'
  const isTen = rank === '10'
  const rankSize = size === 'lg' ? (isTen ? 26 : 32) : isTen ? 12 : 14
  const suitSize = size === 'lg' ? 26 : 13
  const suitGap = size === 'lg' ? (isTen ? 26 : 30) : 13

  return (
    <g transform={rotate ? `rotate(180 ${x} ${y})` : undefined}>
      <text
        x={x}
        y={y}
        fontSize={rankSize}
        fontWeight="800"
        fill={color}
        fontFamily="system-ui, -apple-system, sans-serif"
        textAnchor="middle"
        dominantBaseline="alphabetic"
      >
        {rank}
      </text>
      <text
        x={x}
        y={y + suitGap}
        fontSize={suitSize}
        fontWeight="700"
        fill={color}
        textAnchor="middle"
        dominantBaseline="alphabetic"
      >
        {SUIT_SYMBOLS[suit]}
      </text>
    </g>
  )
}

const CORNER_X = 22
const CORNER_Y = 34

function NumberFace({ rank, suit }: { rank: Rank; suit: Suit }) {
  const count = rankToPipCount(rank)
  const color = RED_SUITS.includes(suit) ? '#dc2626' : '#111827'
  const layout = count ? PIP_LAYOUTS[count] : null

  return (
    <svg viewBox={`0 0 ${CARD_W} ${CARD_H}`} width="100%" height="100%">
      <rect width={CARD_W} height={CARD_H} rx="8" fill="#ffffff" stroke="#1f2937" strokeWidth="1.5" />
      <CornerLabel rank={rank} suit={suit} x={CORNER_X} y={CORNER_Y} size="lg" />
      <CornerLabel rank={rank} suit={suit} x={CARD_W - CORNER_X} y={CARD_H - CORNER_Y} rotate size="sm" />
      {layout?.map(([fx, fy], i) => {
        // Nudge center pips slightly right/down so they clear the large TL index
        const px = fx * CARD_W + (fx < 0.45 ? 6 : 0)
        const py = fy * CARD_H + (fy < 0.4 ? 10 : 0)
        return (
          <text
            key={i}
            x={px}
            y={py + 5}
            textAnchor="middle"
            fontSize="16"
            fill={color}
            opacity="0.92"
            transform={fy > 0.5 ? `rotate(180 ${px} ${py})` : undefined}
          >
            {SUIT_SYMBOLS[suit]}
          </text>
        )
      })}
    </svg>
  )
}

function FaceCard({ rank, suit }: { rank: 'J' | 'Q' | 'K'; suit: Suit }) {
  const color = RED_SUITS.includes(suit) ? '#dc2626' : '#111827'
  // Ornament sits to the right so the oversized TL index stays unobstructed
  const ornamentX = CARD_W / 2 + 12
  const ornamentY = CARD_H / 2 + 4
  return (
    <svg viewBox={`0 0 ${CARD_W} ${CARD_H}`} width="100%" height="100%">
      <rect width={CARD_W} height={CARD_H} rx="8" fill="#ffffff" stroke="#1f2937" strokeWidth="1.5" />
      <CornerLabel rank={rank} suit={suit} x={CORNER_X} y={CORNER_Y} size="lg" />
      <CornerLabel rank={rank} suit={suit} x={CARD_W - CORNER_X} y={CARD_H - CORNER_Y} rotate size="sm" />
      <rect
        x="42"
        y="36"
        width={CARD_W - 50}
        height={CARD_H - 72}
        rx="6"
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        opacity="0.45"
      />
      <g transform={`translate(${ornamentX}, ${ornamentY})`}>
        <circle r="18" fill={color} opacity="0.1" />
        <path d="M -12 7 L -12 -9 L -6 -2 L 0 -14 L 6 -2 L 12 -9 L 12 7 Z" fill={color} opacity="0.85" />
        <text y="5" textAnchor="middle" fontSize="16" fontWeight="700" fill={color} fontFamily="Georgia, serif">
          {rank}
        </text>
      </g>
    </svg>
  )
}

function CardFace({ rank, suit }: { rank: Rank; suit: Suit | null }) {
  if (rank === 'JOKER' || !suit) return <JokerFace />
  if (rank === 'J' || rank === 'Q' || rank === 'K') return <FaceCard rank={rank} suit={suit} />
  return <NumberFace rank={rank} suit={suit} />
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

  return (
    <button
      type="button"
      onClick={onClick}
      style={{ width, height }}
      className={`relative shrink-0 rounded-[8px] shadow-md transition-transform duration-150 ease-out ${
        onClick ? 'cursor-pointer hover:-translate-y-1' : 'cursor-default'
      } ${selected ? `ring-2 ring-yellow-300 ${liftOnSelect ? '-translate-y-3' : ''}` : ''} ${className}`}
    >
      {faceDown || !rank ? <CardBackFace /> : <CardFace rank={rank} suit={suit} />}
    </button>
  )
})
