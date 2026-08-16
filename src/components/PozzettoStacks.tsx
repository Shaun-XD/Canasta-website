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
  /** Icon-only stacks for the table header (no labels). */
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
    <div className="flex items-end gap-1.5">
      {ordered.map((team) => {
        const count = stackCounts[team.id] ?? 0
        const isUs = team.id === localTeamId
        const claimed = team.pozzetto.claimed || count === 0
        return (
          <div key={team.id} className="flex flex-col items-center">
            {!claimed ? (
              <div
                className="relative"
                data-flip-anchor={`pozzetto-${team.id}`}
                title={`${isUs ? 'Our' : 'Their'} Pozzetto (${count})`}
              >
                <div
                  className="absolute rounded-[5px] bg-sky-950 ring-1 ring-sky-300/40"
                  style={{
                    width: cardWidth,
                    height: Math.round(cardWidth * 1.4),
                    transform: 'translate(2px, -2px)',
                  }}
                />
                <Card faceDown width={cardWidth} />
                <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-black/75 px-1 py-px text-[8px] font-bold leading-none text-white">
                  {count}
                </span>
              </div>
            ) : (
              <div
                className="rounded-md border border-dashed border-white/15"
                style={{
                  width: cardWidth,
                  height: Math.round(cardWidth * 1.4),
                }}
                title={`${isUs ? 'Our' : 'Their'} Pozzetto claimed`}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
