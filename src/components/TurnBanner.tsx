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
      <div className="relative z-20 mx-auto flex max-w-full items-center justify-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium text-white/70 ring-1 ring-white/10">
        <span className="font-semibold text-white/85">Timer paused</span>
        {typeof remainingSeconds === 'number' && <TurnTimerBadge seconds={remainingSeconds} compact paused />}
      </div>
    )
  }

  return (
    // z-20 gives this banner a defined place in the stacking order so
    // nothing beneath it (e.g. the discard pile's hover preview, which
    // deliberately sits above it in a fixed layer) can render underneath
    // it in a half-clipped, broken-looking way - see DiscardPileView.
    <div
      key={`${isLocalTurn}-${phase}-${isPaused}-${compact}`}
      className={`animate-banner-in relative z-20 mx-auto flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 font-medium shadow-lg backdrop-blur transition-colors ${
        compact
          ? 'rounded-full px-3 py-1.5 text-xs sm:px-4'
          : 'gap-x-2.5 gap-y-1.5 rounded-2xl px-4 py-2.5 text-sm sm:gap-3 sm:rounded-full sm:px-5'
      } ${
        isPaused
          ? 'bg-white/20 text-white'
          : isLocalTurn
            ? 'bg-yellow-400/95 text-emerald-950'
            : 'bg-black/45 text-white ring-1 ring-white/10'
      }`}
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${isPaused ? 'bg-white/50' : isLocalTurn ? 'bg-emerald-800' : 'bg-yellow-300'} ${isPaused ? '' : 'animate-pulse'}`}
      />
      {isPaused ? (
        <span className="font-semibold">Paused</span>
      ) : (
        <>
          <span className="font-bold">{isLocalTurn ? 'Your turn' : `${playerName}'s turn`}</span>
          <span className="hidden opacity-70 sm:inline">·</span>
          <span className={`text-center leading-snug opacity-80 ${compact ? 'text-[11px]' : 'text-[12px] sm:text-sm'}`}>
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
