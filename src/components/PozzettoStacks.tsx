import type { Team, TeamId } from '../types/game'
import { Card } from './Card'

const POZZETTO_CARD_WIDTH = 40

/**
 * The two face-down 11-card Pozzetto reserves. Rendered top-right under the
 * table ribbon; a team's stack unmounts when claimed.
 */
export function PozzettoStacks({
  teams,
  localTeamId,
  stackCounts,
  compact = false,
}: {
  teams: Team[]
  localTeamId: TeamId | undefined
  stackCounts: Record<TeamId, number>
  /** Icon-only stacks for the phone / tablet header (no labels). */
  compact?: boolean
}) {
  const ordered = [...teams].sort((a, b) => {
    // Us first (left), them second (right).
    if (a.id === localTeamId) return -1
    if (b.id === localTeamId) return 1
    return a.id.localeCompare(b.id)
  })
  const cardWidth = compact ? 22 : POZZETTO_CARD_WIDTH

  return (
    <div className={`flex items-end ${compact ? 'gap-1.5' : 'gap-2'}`}>
      {ordered.map((team) => {
        const count = stackCounts[team.id] ?? 0
        const isUs = team.id === localTeamId
        const claimed = team.pozzetto.claimed || count === 0
        return (
          <div key={team.id} className={`flex flex-col items-center ${compact ? '' : 'gap-1'}`}>
            {!claimed ? (
              <div
                className="relative"
                data-flip-anchor={`pozzetto-${team.id}`}
                title={`${isUs ? 'Our' : 'Their'} Pozzetto (${count})`}
              >
                <div
                  className={`absolute bg-sky-950 ring-1 ring-sky-300/40 ${compact ? 'rounded-[5px]' : 'rounded-[7px]'}`}
                  style={{
                    width: cardWidth,
                    height: Math.round(cardWidth * 1.4),
                    transform: 'translate(2px, -2px)',
                  }}
                />
                <Card faceDown width={cardWidth} />
                <span
                  className={`absolute rounded-full bg-black/75 font-bold text-white ${
                    compact
                      ? '-bottom-0.5 -right-0.5 px-1 py-px text-[8px] leading-none'
                      : '-bottom-1 -right-1 px-1.5 py-0.5 text-[9px]'
                  }`}
                >
                  {count}
                </span>
              </div>
            ) : compact ? (
              <div
                className="rounded-md border border-dashed border-white/15"
                style={{
                  width: cardWidth,
                  height: Math.round(cardWidth * 1.4),
                }}
                title={`${isUs ? 'Our' : 'Their'} Pozzetto claimed`}
              />
            ) : (
              <div
                className="flex items-center justify-center rounded-lg border border-dashed border-white/15 text-[9px] text-white/30"
                style={{
                  width: cardWidth,
                  height: Math.round(cardWidth * 1.4),
                }}
              >
                —
              </div>
            )}
            {!compact && (
              <span className={`text-[9px] font-medium ${isUs ? 'text-emerald-200/80' : 'text-white/45'}`}>
                {isUs ? 'Us' : 'Them'}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
