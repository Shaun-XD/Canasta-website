/** Small countdown chip shown near the active player's avatar / the turn banner. */
export function TurnTimerBadge({
  seconds,
  compact = false,
  paused = false,
}: {
  seconds: number
  compact?: boolean
  /** True while the room's turn timer is paused - freezes the visual style, no pulsing/urgency. */
  paused?: boolean
}) {
  const urgent = !paused && seconds <= 10
  return (
    <span
      className={`inline-flex items-center justify-center gap-0.5 rounded-full font-mono font-bold tabular-nums shadow ring-1 transition-colors ${
        paused
          ? 'bg-white/10 text-white/60 ring-white/20'
          : urgent
            ? 'bg-red-500/90 text-white ring-red-200 animate-pulse'
            : 'bg-black/40 text-white/90 ring-white/20'
      } ${compact ? 'h-5 min-w-5 px-1 text-[10px]' : 'h-7 min-w-7 px-2 text-xs'}`}
      title={paused ? 'Turn timer paused' : 'Time left in this turn'}
    >
      {paused ? '⏸' : `${seconds}s`}
    </span>
  )
}
