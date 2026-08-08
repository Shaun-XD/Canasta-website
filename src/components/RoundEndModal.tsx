import type { Team, TeamId } from '../types/game'

/**
 * Round/game end overlay.
 * TODO(rules): score breakdown is a flat placeholder number per team until
 * the real scoring formula is finalized (melded points, canasta bonuses,
 * going-out bonus, red three bonus/penalty, unmelded card penalty, etc).
 */
export function RoundEndModal({
  teams,
  scores,
  onNextRound,
  onReturnToLobby,
}: {
  teams: Team[]
  scores: Record<TeamId, number> | null
  onNextRound: () => void
  onReturnToLobby: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-emerald-950 p-6 shadow-2xl">
        <h2 className="text-center text-2xl font-bold text-white">Round Complete</h2>
        <p className="mt-1 text-center text-sm text-white/60">
          Placeholder scoring — real rules pending finalization.
        </p>

        <div className="mt-5 space-y-3">
          {teams.map((team) => (
            <div
              key={team.id}
              className="flex items-center justify-between rounded-lg bg-white/5 px-4 py-3"
            >
              <span className="font-medium text-white">{team.name}</span>
              <span className="text-xl font-bold text-yellow-300">
                {scores?.[team.id] ?? 0}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onReturnToLobby}
            className="flex-1 rounded-lg border border-white/20 px-4 py-2 font-medium text-white transition hover:bg-white/10"
          >
            Return to Lobby
          </button>
          <button
            type="button"
            onClick={onNextRound}
            className="flex-1 rounded-lg bg-yellow-400 px-4 py-2 font-semibold text-emerald-950 transition hover:bg-yellow-300"
          >
            Next Round
          </button>
        </div>
      </div>
    </div>
  )
}
