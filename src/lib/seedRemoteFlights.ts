import {
  BOT_FLIP_DURATION_MS,
  getFlipAnchorRect,
  playDetachedCardFlight,
  playPozzettoClaimFlights,
  seedFlipOriginFromAnchor,
} from '../hooks/useCardFlip'
import { meldCards } from '../types/game'
import type { GameState, PlayerId, RoomState } from '../types/game'

const remoteFlip = { slow: true } as const
const MAX_PILE_FLIGHTS = 12

function meldIdSet(room: RoomState | null | undefined): Set<string> {
  const ids = new Set<string>()
  if (!room) return ids
  for (const team of room.teams) {
    for (const meld of team.melds) {
      for (const card of meldCards(meld)) ids.add(card.id)
    }
  }
  return ids
}

function inferActor(prev: GameState, next: GameState): PlayerId | null {
  if (next.lastAcquired && next.lastAcquired.at !== prev.lastAcquired?.at) {
    return next.lastAcquired.playerId
  }
  const changed: PlayerId[] = []
  for (const pid of Object.keys(next.hands)) {
    if ((prev.hands[pid]?.length ?? 0) !== (next.hands[pid]?.length ?? 0)) {
      changed.push(pid)
    }
  }
  if (changed.length === 1) return changed[0]
  return prev.turn.activePlayerId
}

function staggerDetachedFlights(
  from: DOMRect,
  to: DOMRect,
  count: number,
): void {
  const n = Math.max(0, Math.min(count, MAX_PILE_FLIGHTS))
  for (let i = 0; i < n; i += 1) {
    window.setTimeout(() => {
      void playDetachedCardFlight({
        from,
        to,
        faceDown: true,
        durationMs: BOT_FLIP_DURATION_MS,
      })
    }, i * 40)
  }
}

/**
 * Mirror another seat's card motion for online spectators — same idea as
 * bot flights: seed FLIP origins onto visible piles (discard / melds) and
 * play face-down ghosts into MiniCardStack seats that have no per-card DOM.
 *
 * Must run BEFORE React commits the new state so newly mounted AnimatedCards
 * pick up the seeded origin in the same layout pass.
 */
export function seedRemotePlayerFlights(opts: {
  prevGame: GameState
  prevRoom: RoomState | null
  nextGame: GameState
  nextRoom: RoomState | null
  localPlayerId: PlayerId | null
}): void {
  const { prevGame, prevRoom, nextGame, nextRoom, localPlayerId } = opts
  if (!localPlayerId) return
  if (nextGame.round !== prevGame.round) return

  const actorId = inferActor(prevGame, nextGame)
  if (!actorId || actorId === localPlayerId) return

  const handAnchor = `hand-${actorId}`
  const prevHandCount = prevGame.hands[actorId]?.length ?? 0
  const nextHandCount = nextGame.hands[actorId]?.length ?? 0
  const prevDiscard = prevGame.discardPile.cards
  const nextDiscard = nextGame.discardPile.cards
  const prevDiscardIds = new Set(prevDiscard.map((c) => c.id))
  const prevMeldIds = meldIdSet(prevRoom)
  const nextMeldIds = meldIdSet(nextRoom)

  // Hand → discard: new discard cards fly out of that seat's stack.
  if (nextDiscard.length > prevDiscard.length) {
    for (const card of nextDiscard) {
      if (!prevDiscardIds.has(card.id)) {
        seedFlipOriginFromAnchor(card.id, handAnchor, remoteFlip)
      }
    }
  }

  // Hand → meld: new meld cards that were not already on the discard fan.
  // (Discard → meld keeps the discard pile's lastKnownRect.)
  for (const id of nextMeldIds) {
    if (prevMeldIds.has(id) || prevDiscardIds.has(id)) continue
    seedFlipOriginFromAnchor(id, handAnchor, remoteFlip)
  }

  const stockDelta = prevGame.stock.length - nextGame.stock.length
  const handDelta = nextHandCount - prevHandCount
  const discardDelta = nextDiscard.length - prevDiscard.length

  // Stock → opponent/teammate stack (no per-card element at the destination).
  if (stockDelta > 0 && handDelta > 0) {
    const from = getFlipAnchorRect('stock')
    const to = getFlipAnchorRect(handAnchor)
    if (from && to) staggerDetachedFlights(from, to, Math.min(stockDelta, handDelta))
  }

  // Top Touch remainder: discard pile shrinks, extra cards join their hand.
  if (discardDelta < 0 && handDelta > 0 && stockDelta === 0) {
    const from = getFlipAnchorRect('discard')
    const to = getFlipAnchorRect(handAnchor)
    if (from && to) staggerDetachedFlights(from, to, handDelta)
  }

  // Pozzetto claim into a remote seat.
  if (nextRoom && prevRoom) {
    for (const team of nextRoom.teams) {
      const prevLen = prevGame.pozzettoStacks[team.id]?.length ?? 0
      const nextLen = nextGame.pozzettoStacks[team.id]?.length ?? 0
      if (prevLen <= 0 || nextLen !== 0) continue
      const claimedBy = team.pozzetto.claimedByPlayerId ?? actorId
      if (claimedBy === localPlayerId) continue
      playPozzettoClaimFlights({
        teamId: team.id,
        playerId: claimedBy,
        cardIds: Array.from({ length: prevLen }, (_, i) => `poz-remote-${team.id}-${i}`),
        toLocalHand: false,
        slow: true,
      })
    }
  }
}
