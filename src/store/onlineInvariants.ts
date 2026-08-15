import type { GameState, PlayerId } from '../types/game'

/**
 * Online stock draw / meld / discard share one ack path. Timeouts must NEVER
 * retry the action — a successful draw + retry becomes "Already drew this turn".
 * Only re-bind when the socket lost its room mapping.
 */
export function shouldRetryOnlineAction(error?: string): boolean {
  return (error || '').toLowerCase().includes('not in a room')
}

/**
 * Duplicate ack + lobby broadcast of the same lastPlay can be skipped.
 * A stock draw must never be skipped: stock length, local hand length, or
 * lastAcquired changing means the card has to land in the UI.
 */
export function shouldSkipOnlineSnapshot(opts: {
  prevGame: GameState | null | undefined
  nextGame: GameState
  localPlayerId: PlayerId | null
}): boolean {
  const { prevGame, nextGame, localPlayerId } = opts
  if (!prevGame || !nextGame.lastPlay) return false
  if (prevGame.lastPlay?.at !== nextGame.lastPlay.at) return false

  const stockChanged = prevGame.stock.length !== nextGame.stock.length
  const localHandChanged =
    (prevGame.hands[localPlayerId ?? '']?.length ?? -1) !==
    (nextGame.hands[localPlayerId ?? '']?.length ?? -1)
  const acquiredNew = nextGame.lastAcquired?.at !== prevGame.lastAcquired?.at
  const slideChanged =
    (prevGame.pendingSlide?.displacedWildCardId ?? null) !==
      (nextGame.pendingSlide?.displacedWildCardId ?? null) ||
    (prevGame.pendingSlide?.meldId ?? null) !== (nextGame.pendingSlide?.meldId ?? null)
  return !stockChanged && !localHandChanged && !acquiredNew && !slideChanged
}
