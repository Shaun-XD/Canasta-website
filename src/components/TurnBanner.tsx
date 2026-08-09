import type { TurnPhase } from '../types/game'
import { TurnTimerBadge } from './TurnTimerBadge'

const PHASE_LABEL: Record<TurnPhase, string> = {
  draw: 'Draw a card, or Top Touch the discard pile',
  action: 'Meld cards (optional), then discard',
  discard: 'Discard to end turn',
}

export function TurnBanner({
  playerName,
  phase,
  isLocalTurn,
  remainingSeconds,
  isPaused = false,
}: {
  playerName: string
  phase: TurnPhase
  isLocalTurn: boolean
  /** Seconds left on the active player's turn timer (item 2), if known. */
  remainingSeconds?: number | null
  /** True while the room's turn timer is paused for everyone at the table. */
  isPaused?: boolean
}) {
  return (
    // z-20 gives this banner a defined place in the stacking order so
    // nothing beneath it (e.g. the discard pile's hover preview, which
    // deliberately sits above it in a fixed layer) can render underneath
    // it in a half-clipped, broken-looking way - see DiscardPileView.
    <div
      className={`relative z-20 mx-auto flex items-center gap-3 rounded-full px-5 py-2 text-sm font-medium shadow-lg backdrop-blur transition-colors ${
        isPaused ? 'bg-white/20 text-white' : isLocalTurn ? 'bg-yellow-400/95 text-emerald-950' : 'bg-black/40 text-white'
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full ${isPaused ? 'bg-white/50' : isLocalTurn ? 'bg-emerald-800' : 'bg-yellow-300'} ${isPaused ? '' : 'animate-pulse'}`}
      />
      {isPaused ? (
        <span className="font-semibold">Paused</span>
      ) : (
        <>
          <span className="font-semibold">{isLocalTurn ? "Your turn" : `${playerName}'s turn`}</span>
          <span className="opacity-70">·</span>
          <span>{PHASE_LABEL[phase]}</span>
        </>
      )}
      {typeof remainingSeconds === 'number' && (
        <>
          <span className="opacity-70">·</span>
          <TurnTimerBadge seconds={remainingSeconds} paused={isPaused} />
        </>
      )}
    </div>
  )
}
