import type { ReactNode } from 'react'

export type HandSortMode = 'suit' | 'rank'

/**
 * Compact suit-sort / rank-sort controls for the local hand.
 * Visual language matches classic sequence vs set pictograms.
 */
export function HandSortButtons({
  activeMode,
  onSortSuit,
  onSortRank,
}: {
  activeMode: HandSortMode | null
  onSortSuit: () => void
  onSortRank: () => void
}) {
  return (
    <div className="pointer-events-auto flex flex-col gap-2" role="group" aria-label="Sort hand">
      <SortButton
        label="Sort by suit (sequences)"
        active={activeMode === 'suit'}
        onClick={onSortSuit}
      >
        <SuitSortIcon />
      </SortButton>
      <SortButton
        label="Sort by rank (sets / duplicates)"
        active={activeMode === 'rank'}
        onClick={onSortRank}
      >
        <RankSortIcon />
      </SortButton>
    </div>
  )
}

function SortButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-14 w-14 items-center justify-center rounded-xl bg-white p-1 shadow-md transition active:scale-95 sm:h-16 sm:w-16 ${
        active ? 'ring-2 ring-yellow-300 ring-offset-1 ring-offset-emerald-950' : 'hover:brightness-105'
      }`}
    >
      {children}
    </button>
  )
}

/** Sequence pictogram: 2 3 4 over matching diamonds. */
function SuitSortIcon() {
  return (
    <svg viewBox="0 0 56 56" width="100%" height="100%" aria-hidden className="block">
      <text
        x="8"
        y="22"
        textAnchor="middle"
        fill="#dc2626"
        fontSize="18"
        fontWeight="800"
        fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
      >
        2
      </text>
      <text
        x="28"
        y="22"
        textAnchor="middle"
        fill="#dc2626"
        fontSize="18"
        fontWeight="800"
        fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
      >
        3
      </text>
      <text
        x="48"
        y="22"
        textAnchor="middle"
        fill="#dc2626"
        fontSize="18"
        fontWeight="800"
        fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
      >
        4
      </text>
      <Diamond cx={8} cy={40} s={9} fill="#dc2626" />
      <Diamond cx={28} cy={40} s={9} fill="#dc2626" />
      <Diamond cx={48} cy={40} s={9} fill="#dc2626" />
    </svg>
  )
}

/** Set pictogram: K K K over ♥ ♠ ♦ in red/black. */
function RankSortIcon() {
  return (
    <svg viewBox="0 0 56 56" width="100%" height="100%" aria-hidden className="block">
      <text
        x="8"
        y="22"
        textAnchor="middle"
        fill="#dc2626"
        fontSize="18"
        fontWeight="800"
        fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
      >
        K
      </text>
      <text
        x="28"
        y="22"
        textAnchor="middle"
        fill="#111827"
        fontSize="18"
        fontWeight="800"
        fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
      >
        K
      </text>
      <text
        x="48"
        y="22"
        textAnchor="middle"
        fill="#dc2626"
        fontSize="18"
        fontWeight="800"
        fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
      >
        K
      </text>
      <g>
        <Heart cx={8} cy={40} s={9} fill="#dc2626" />
        <Spade cx={28} cy={40} s={9} fill="#111827" />
        <Diamond cx={48} cy={40} s={9} fill="#dc2626" />
      </g>
    </svg>
  )
}

function Diamond({
  cx,
  cy,
  s,
  fill = '#dc2626',
}: {
  cx: number
  cy: number
  s: number
  fill?: string
}) {
  return (
    <polygon
      fill={fill}
      points={`${cx},${cy - s} ${cx + s * 0.68},${cy} ${cx},${cy + s} ${cx - s * 0.68},${cy}`}
    />
  )
}

function Heart({ cx, cy, s, fill }: { cx: number; cy: number; s: number; fill: string }) {
  const r = s * 0.42
  return (
    <g fill={fill}>
      <circle cx={cx - r * 0.85} cy={cy - r * 0.35} r={r} />
      <circle cx={cx + r * 0.85} cy={cy - r * 0.35} r={r} />
      <polygon
        points={`${cx - s * 0.95},${cy - r * 0.1} ${cx + s * 0.95},${cy - r * 0.1} ${cx},${cy + s}`}
      />
    </g>
  )
}

function Spade({ cx, cy, s, fill }: { cx: number; cy: number; s: number; fill: string }) {
  const r = s * 0.4
  return (
    <g fill={fill}>
      <polygon
        points={`${cx},${cy - s} ${cx + s * 0.95},${cy + r * 0.15} ${cx - s * 0.95},${cy + r * 0.15}`}
      />
      <circle cx={cx - r * 0.9} cy={cy + r * 0.15} r={r} />
      <circle cx={cx + r * 0.9} cy={cy + r * 0.15} r={r} />
      <rect x={cx - s * 0.14} y={cy} width={s * 0.28} height={s * 0.95} />
      <polygon
        points={`${cx - s * 0.45},${cy + s} ${cx + s * 0.45},${cy + s} ${cx},${cy + s * 0.35}`}
      />
    </g>
  )
}
