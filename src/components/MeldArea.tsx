import type { Team } from '../types/game'
import { Card } from './Card'

/**
 * Renders a team's laid-down melds, grouped by rank.
 * TODO(rules): once real meld/canasta rules exist, distinguish natural vs
 * mixed canastas visually (e.g. red vs black card-back styling) here.
 */
export function MeldArea({ team, align = 'left' }: { team: Team; align?: 'left' | 'right' | 'center' }) {
  const melds = Object.values(team.melds)

  return (
    <div
      className={`flex min-h-[64px] flex-wrap gap-2 rounded-lg border border-white/10 bg-black/15 p-2 ${
        align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'
      }`}
    >
      {melds.length === 0 && (
        <span className="self-center px-2 text-[11px] italic text-white/40">No melds yet</span>
      )}
      {melds.map((meld) => (
        <div key={meld.rank} className="relative flex" title={`${meld.rank}${meld.isCanasta ? ' · Canasta!' : ''}`}>
          {meld.cards.map((card, i) => (
            <div key={card.id} style={{ marginLeft: i === 0 ? 0 : -30 }}>
              <Card rank={card.rank} suit={card.suit} width={38} />
            </div>
          ))}
          {meld.isCanasta && (
            <span className="absolute -top-2 -right-2 rounded-full bg-yellow-400 px-1.5 py-0.5 text-[9px] font-bold text-emerald-950 shadow">
              CANASTA
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
