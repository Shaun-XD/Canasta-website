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
}: {
  teams: Team[]
  localTeamId: TeamId | undefined
  stackCounts: Record<TeamId, number>
}) {
  const ordered = [...teams].sort((a, b) => {
    // Us first (left), them second (right).
    if (a.id === localTeamId) return -1
    if (b.id === localTeamId) return 1
    return a.id.localeCompare(b.id)
  })

  return (
    <div className="flex items-end gap-2">
      {ordered.map((team) => {
        const count = stackCounts[team.id] ?? 0
        const isUs = team.id === localTeamId
        const claimed = team.pozzetto.claimed || count === 0
        return (
          <div key={team.id} className="flex flex-col items-center gap-1">
            {!claimed ? (
              <div
                className="relative"
                data-flip-anchor={`pozzetto-${team.id}`}
                title={`${isUs ? 'Our' : 'Their'} Pozzetto (${count})`}
              >
                <div
                  className="absolute rounded-[7px] bg-sky-950 ring-1 ring-sky-300/40"
                  style={{
                    width: POZZETTO_CARD_WIDTH,
                    height: Math.round(POZZETTO_CARD_WIDTH * 1.4),
                    transform: 'translate(2px, -2px)',
                  }}
                />
                <Card faceDown width={POZZETTO_CARD_WIDTH} />
                <span className="absolute -bottom-1 -right-1 rounded-full bg-black/75 px-1.5 py-0.5 text-[9px] font-bold text-white">
                  {count}
                </span>
              </div>
            ) : (
              <div
                className="flex items-center justify-center rounded-lg border border-dashed border-white/15 text-[9px] text-white/30"
                style={{
                  width: POZZETTO_CARD_WIDTH,
                  height: Math.round(POZZETTO_CARD_WIDTH * 1.4),
                }}
              >
                —
              </div>
            )}
            <span className={`text-[9px] font-medium ${isUs ? 'text-emerald-200/80' : 'text-white/45'}`}>
              {isUs ? 'Us' : 'Them'}
            </span>
          </div>
        )
      })}
    </div>
  )
}
