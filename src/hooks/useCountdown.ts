import { useEffect, useState } from 'react'

/**
 * Ticks a few times a second and returns the whole seconds remaining until
 * `deadlineMs` (clamped to >= 0). Returns `null` when there is no deadline
 * to count down to. Backs the per-player turn timer (item 2).
 *
 * When `isPaused` is true, the interval simply stops advancing `now`, so
 * the returned value freezes at whatever it last was instead of resetting
 * or continuing to tick - the caller is responsible for shifting the
 * underlying deadline forward by the paused duration once resumed (see
 * `gameStore.togglePauseTimer`), so the frozen value picks up exactly
 * where it left off.
 */
export function useCountdown(deadlineMs: number | null, isPaused = false): number | null {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (deadlineMs == null || isPaused) return
    const id = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [deadlineMs, isPaused])

  if (deadlineMs == null) return null
  return Math.max(0, Math.ceil((deadlineMs - now) / 1000))
}
