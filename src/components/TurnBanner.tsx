import type { TurnPhase } from '../types/game'
import { TurnTimerBadge } from './TurnTimerBadge'

const PHASE_LABEL: Record<TurnPhase, string> = {
  draw: 'Draw a card, or tap/touch the discard pile',
  action: 'Meld cards (optional), then discard',
  discard: 'Discard to end turn',
}

const PHASE_SHORT: Record<TurnPhase, string> = {
  draw: 'Draw',
  action: 'Meld / Discard',
  discard: 'Discard',
}

export function TurnBanner({
  playerName,
  phase,
  isLocalTurn,
  remainingSeconds,
  isPaused = false,
  compact = false,
}: {
  playerName: string
  phase: TurnPhase
  isLocalTurn: boolean
  /** Seconds left on the active player's turn timer (item 2), if known. */
  remainingSeconds?: number | null
  /** True while the room's turn timer is paused for everyone at the table. */
  isPaused?: boolean
  /** Slimmer bar used in the mockup center row (Paused lives on the action stack). */
  compact?: boolean
}) {
  // When paused, the action column shows the Paused chip — keep the banner quiet.
  if (compact && isPaused) {
    return (
      <div className="relative z-0 mx-auto flex max-w-full items-center justify-center gap-1.5 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/70 ring-1 ring-white/10">
        <span className="font-semibold text-white/85">Timer paused</span>
        {typeof remainingSeconds === 'number' && <TurnTimerBadge seconds={remainingSeconds} compact paused />}
      </div>
    )
  }

  return (
    <div
      key={`${isLocalTurn}-${phase}-${isPaused}-${compact}`}
      className={`animate-banner-in relative z-0 mx-auto flex max-w-full flex-wrap items-center justify-center font-medium backdrop-blur-sm transition-colors ${
        compact
          ? 'gap-x-1.5 rounded-full px-2 py-0.5 text-[10px] shadow-none'
          : 'z-20 gap-x-2.5 gap-y-1.5 rounded-2xl px-4 py-2.5 text-sm shadow-lg sm:gap-3 sm:rounded-full sm:px-5'
      } ${
        isPaused
          ? 'bg-white/20 text-white'
          : isLocalTurn
            ? compact
              ? 'bg-yellow-400/45 text-emerald-950 ring-1 ring-yellow-200/35'
              : 'bg-yellow-400/95 text-emerald-950'
            : compact
              ? 'bg-black/30 text-white ring-1 ring-white/10'
              : 'bg-black/45 text-white ring-1 ring-white/10'
      }`}
    >
      <span
        className={`shrink-0 rounded-full ${compact ? 'h-1.5 w-1.5' : 'h-2 w-2'} ${isPaused ? 'bg-white/50' : isLocalTurn ? 'bg-emerald-800' : 'bg-yellow-300'} ${isPaused ? '' : 'animate-pulse'}`}
      />
      {isPaused ? (
        <span className="font-semibold">Paused</span>
      ) : (
        <>
          <span className="font-bold">{isLocalTurn ? 'Your turn' : `${playerName}'s turn`}</span>
          <span className={`opacity-70 ${compact ? 'inline' : 'hidden sm:inline'}`}>·</span>
          <span className={`text-center leading-snug opacity-80 ${compact ? 'text-[10px]' : 'text-[12px] sm:text-sm'}`}>
            {compact ? PHASE_SHORT[phase] : PHASE_LABEL[phase]}
          </span>
        </>
      )}
      {typeof remainingSeconds === 'number' && (
        <>
          <span className="hidden opacity-70 sm:inline">·</span>
          <TurnTimerBadge seconds={remainingSeconds} compact={compact} paused={isPaused} />
        </>
      )}
    </div>
  )
}
