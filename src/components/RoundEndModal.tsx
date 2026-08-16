import type { RoundScoreResult, Team } from '../types/game'

function ScoreLine({ label, value }: { label: string; value: number }) {
  if (value === 0) return null
  return (
    <div className="flex items-center justify-between text-xs text-white/70">
      <span>{label}</span>
      <span className={value < 0 ? 'text-red-300' : 'text-emerald-300'}>
        {value > 0 ? '+' : ''}
        {value}
      </span>
    </div>
  )
}

export function RoundEndModal({
  teams,
  scores,
  matchTargetScore,
  gameOverTeamId,
  onNewGame,
  onReturnToLobby,
}: {
  teams: Team[]
  scores: RoundScoreResult | null
  matchTargetScore: number
  gameOverTeamId: string | null
  /** Full match reset: new deal, scores cleared, stay at the table. */
  onNewGame: () => void
  /** Leave the table and return the room to lobby. */
  onReturnToLobby: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[min(90dvh,36rem)] w-full max-w-lg flex-col overflow-y-auto rounded-2xl border border-white/10 bg-emerald-950 p-5 shadow-2xl sm:p-6">
        <h2 className="text-center text-2xl font-bold text-white">
          {gameOverTeamId ? 'Match Complete!' : 'Round Complete'}
        </h2>
        <p className="mt-1 text-center text-sm text-white/60">
          {scores?.endingType === 'sudden-death'
            ? 'Stock depleted — sudden death ending (hands not scored).'
            : `${scores?.showingTeamId ? teams.find((t) => t.id === scores.showingTeamId)?.name : 'A team'} declared Show.`}
        </p>

        <div className="mt-5 space-y-3">
          {teams.map((team) => {
            const breakdown = scores?.teams[team.id]
            return (
              <div key={team.id} className="rounded-lg bg-white/5 px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-white">{team.name}</span>
                  <span className="text-xl font-bold text-yellow-300">{team.score}</span>
                </div>
                {breakdown && (
                  <div className="mt-2 space-y-1 border-t border-white/10 pt-2">
                    <ScoreLine label="Meld card points" value={breakdown.meldPoints} />
                    <ScoreLine label="Canasta/Limpa bonuses" value={breakdown.canastaBonuses} />
                    <ScoreLine label="Opponent leftover cards" value={breakdown.opponentHandPenalty} />
                    <ScoreLine label="Show bonus" value={breakdown.showBonus} />
                    <ScoreLine label="Zero Canasta penalty" value={breakdown.zeroCanastaPenalty} />
                    <ScoreLine label="Unclaimed Pozzetto penalty" value={breakdown.unclaimedPozzettoPenalty} />
                    <ScoreLine label="Wrong meld penalty" value={breakdown.wrongMeldPenalty} />
                    <ScoreLine label="Empty-hand foul" value={breakdown.emptyHandFoulPenalty} />
                    <div className="flex items-center justify-between pt-1 text-xs font-semibold text-white/80">
                      <span>Round total</span>
                      <span>
                        {breakdown.total > 0 ? '+' : ''}
                        {breakdown.total}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <p className="mt-4 text-center text-[11px] text-white/40">
          First team to {matchTargetScore} points wins the match.
        </p>

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
            onClick={onNewGame}
            className="flex-1 rounded-lg bg-yellow-400 px-4 py-2 font-semibold text-emerald-950 transition hover:bg-yellow-300"
          >
            New Game
          </button>
        </div>
      </div>
    </div>
  )
}
