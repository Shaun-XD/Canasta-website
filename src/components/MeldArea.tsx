import type { Meld, MeldClassification, Team } from '../types/game'
import { meldCards } from '../types/game'
import { wildEdgeInSet } from '../engine/meldValidation'
import { AnimatedCard } from './AnimatedCard'

const CLASSIFICATION_LABEL: Record<MeldClassification, string> = {
  'in-progress': '',
  'mixed-canasta': 'MIXED CANASTA',
  limpa: 'LIMPA',
  'mixed-canasta-2s': 'MIXED CANASTA (2s)',
  'limpa-2s': 'LIMPA OF 2s',
}

const CLASSIFICATION_COLOR: Record<MeldClassification, string> = {
  'in-progress': '',
  'mixed-canasta': 'bg-orange-400 text-orange-950',
  limpa: 'bg-emerald-300 text-emerald-950',
  'mixed-canasta-2s': 'bg-sky-300 text-sky-950',
  'limpa-2s': 'bg-yellow-300 text-yellow-950',
}

/** Card width used for melded groups — kept large enough to read suit/rank at a glance. */
const MELD_CARD_WIDTH = 72
const MELD_CARD_OVERLAP = -52

/** Renders a team's laid-down melds (Sets & Sequences), one card-fan per meld. */
export function MeldArea({
  team,
  align = 'left',
  selectable = false,
  selectedMeldId = null,
  onSelectMeld,
  /** True while the local player may modify this team's melds (their own turn, own team). Gates the "Move Wild" control (item 7). */
  canModify = false,
  onMoveWild,
}: {
  team: Team
  align?: 'left' | 'right' | 'center'
  selectable?: boolean
  selectedMeldId?: string | null
  onSelectMeld?: (meldId: string) => void
  canModify?: boolean
  onMoveWild?: (meldId: string) => void
}) {
  return (
    <div
      className={`flex min-h-[168px] w-full flex-wrap content-start items-start gap-4 overflow-y-auto overflow-x-visible rounded-xl border border-white/10 bg-black/15 p-3 ${
        align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'
      }`}
    >
      {team.melds.length === 0 && (
        <span className="self-center px-2 text-[11px] italic text-white/40">No melds yet</span>
      )}
      {team.melds.map((meld) => (
        <MeldFan
          key={meld.id}
          meld={meld}
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

function MeldFan({
  meld,
  selectable,
  selected,
  onSelect,
  canModify,
  onMoveWild,
}: {
  meld: Meld
  selectable: boolean
  selected: boolean
  onSelect?: () => void
  canModify: boolean
  onMoveWild?: (meldId: string) => void
}) {
  const cards = meldCards(meld)
  const label = meld.type === 'set' ? `${meld.rank}s` : `${meld.suit} run`
  const wildEdge = wildEdgeInSet(meld)
  const showMoveWild = canModify && selected && !!wildEdge && !!onMoveWild

  return (
    <div className="relative flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={onSelect}
        disabled={!selectable}
        title={`${label}${meld.isCanasta ? ` · ${CLASSIFICATION_LABEL[meld.classification]}` : ''}`}
        className={`relative flex rounded-md p-1 transition ${
          selectable ? 'cursor-pointer hover:bg-white/10' : 'cursor-default'
        } ${selected ? 'ring-2 ring-yellow-300' : ''}`}
      >
        {cards.map((card, i) => (
          <AnimatedCard
            key={card.id}
            flipId={card.id}
            rank={card.rank}
            suit={card.suit}
            width={MELD_CARD_WIDTH}
            style={{ marginLeft: i === 0 ? 0 : MELD_CARD_OVERLAP }}
          />
        ))}
        {meld.isCanasta && (
          <span
            className={`absolute -top-2 -right-2 rounded-full px-1.5 py-0.5 text-[8px] font-bold shadow ${CLASSIFICATION_COLOR[meld.classification]}`}
          >
            {CLASSIFICATION_LABEL[meld.classification]}
          </span>
        )}
        {meld.wildCount > 0 && !meld.isCanasta && (
          <span className="absolute -bottom-1 -right-1 rounded-full bg-purple-400 px-1 py-0.5 text-[8px] font-bold text-purple-950 shadow">
            WILD
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
          title={`Move the wild card to the ${wildEdge === 'front' ? 'back' : 'front'} of this meld`}
          className="rounded-full bg-purple-400/90 px-2 py-0.5 text-[10px] font-semibold text-purple-950 shadow transition hover:bg-purple-300"
        >
          Move Wild
        </button>
      )}
    </div>
  )
}
