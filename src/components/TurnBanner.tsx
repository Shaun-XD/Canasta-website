import type { TurnPhase } from '../types/game'

const PHASE_LABEL: Record<TurnPhase, string> = {
  draw: 'Draw a card',
  meld: 'Lay melds (optional)',
  discard: 'Discard to end turn',
}

export function TurnBanner({
  playerName,
  phase,
  isLocalTurn,
}: {
  playerName: string
  phase: TurnPhase
  isLocalTurn: boolean
}) {
  return (
    <div
      className={`mx-auto flex items-center gap-3 rounded-full px-5 py-2 text-sm font-medium shadow-lg backdrop-blur transition-colors ${
        isLocalTurn ? 'bg-yellow-400/95 text-emerald-950' : 'bg-black/40 text-white'
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${isLocalTurn ? 'bg-emerald-800' : 'bg-yellow-300'} animate-pulse`} />
      <span className="font-semibold">{isLocalTurn ? "Your turn" : `${playerName}'s turn`}</span>
      <span className="opacity-70">·</span>
      <span>{PHASE_LABEL[phase]}</span>
    </div>
  )
}
