import {
  BOT_FLIP_DURATION_MS,
  getFlipAnchorRect,
  playDetachedCardFlight,
  playPozzettoClaimFlights,
  seedFlipOriginFromAnchor,
} from '../hooks/useCardFlip'
import { meldCards } from '../types/game'
import type { CardPlayEvent, GameState, PlayerId, RoomState } from '../types/game'

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
  if (next.lastPlay && next.lastPlay.at !== prev.lastPlay?.at) {
    return next.lastPlay.actorId
  }
  // Prefer the player whose public piles changed so a leftover lastAcquired
  // draw event cannot steal a later discard/meld.
  if (next.discardPile.cards.length > prev.discardPile.cards.length) {
    return prev.turn.activePlayerId
  }
  const changed: PlayerId[] = []
  for (const pid of Object.keys(next.hands)) {
    if ((prev.hands[pid]?.length ?? 0) !== (next.hands[pid]?.length ?? 0)) {
      changed.push(pid)
    }
  }
  if (changed.length === 1) return changed[0]
  if (next.lastAcquired && next.lastAcquired.at !== prev.lastAcquired?.at) {
    return next.lastAcquired.playerId
  }
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

function applyPublicPlay(play: CardPlayEvent): void {
  const handAnchor = `hand-${play.actorId}`
  if (play.kind === 'draw-stock') {
    const from = getFlipAnchorRect('stock')
    const to = getFlipAnchorRect(handAnchor)
    if (from && to) staggerDetachedFlights(from, to, Math.max(play.count, 1))
    return
  }
  if (play.kind === 'discard') {
    for (const id of play.cardIds) seedFlipOriginFromAnchor(id, handAnchor, remoteFlip)
    return
  }
  // Meld / Top Touch: cards already on the discard fan keep that lastKnownRect
  // so they fly discard → meld. Hand cards seed from the actor's stack.
  // Do not also fly the discard remainder into their hidden hand — that
  // doubles up with the meld flight and looks like cards going to the hand
  // and the table at the same time.
  const fromDiscard = new Set(play.fromDiscardIds)
  for (const id of play.cardIds) {
    if (fromDiscard.has(id)) continue
    seedFlipOriginFromAnchor(id, handAnchor, remoteFlip)
  }
}

function applyPozzettoFlights(
  prevGame: GameState,
  nextGame: GameState,
  nextRoom: RoomState | null,
  localPlayerId: PlayerId,
  actorId: PlayerId | null,
): void {
  if (!nextRoom) return
  for (const team of nextRoom.teams) {
    const prevLen = prevGame.pozzettoStacks[team.id]?.length ?? 0
    const nextLen = nextGame.pozzettoStacks[team.id]?.length ?? 0
    if (prevLen <= 0 || nextLen !== 0) continue
    const claimedBy = team.pozzetto.claimedByPlayerId ?? actorId
    if (!claimedBy) continue
    if (claimedBy === localPlayerId) {
      const prevIds = new Set((prevGame.hands[localPlayerId] ?? []).map((c) => c.id))
      const newIds = (nextGame.hands[localPlayerId] ?? [])
        .filter((c) => !prevIds.has(c.id))
        .map((c) => c.id)
      playPozzettoClaimFlights({
        teamId: team.id,
        playerId: claimedBy,
        cardIds: newIds.length > 0 ? newIds : Array.from({ length: prevLen }, (_, i) => `poz-local-${team.id}-${i}`),
        toLocalHand: true,
        slow: false,
      })
      continue
    }
    playPozzettoClaimFlights({
      teamId: team.id,
      playerId: claimedBy,
      cardIds: Array.from({ length: prevLen }, (_, i) => `poz-remote-${team.id}-${i}`),
      toLocalHand: false,
      slow: true,
    })
  }
}

/**
 * Mirror another seat's card motion for every online client — same idea as
 * bot flights. The acting player already FLIPs their own cards; this runs
 * on everyone else's screen so a discard/meld/draw is visible both ways.
 *
 * Prefers the server `lastPlay` hint (authoritative). Falls back to diffs
 * if an older server has not stamped lastPlay yet.
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

  const play = nextGame.lastPlay
  const playIsNew = !!play && play.at !== prevGame.lastPlay?.at

  if (playIsNew && play.actorId !== localPlayerId) {
    applyPublicPlay(play)
    applyPozzettoFlights(prevGame, nextGame, nextRoom, localPlayerId, play.actorId)
    return
  }

  if (playIsNew && play.actorId === localPlayerId) {
    applyPozzettoFlights(prevGame, nextGame, nextRoom, localPlayerId, play.actorId)
    return
  }

  const actorId = inferActor(prevGame, nextGame)
  if (!actorId || actorId === localPlayerId) {
    applyPozzettoFlights(prevGame, nextGame, nextRoom, localPlayerId, actorId)
    return
  }

  const handAnchor = `hand-${actorId}`
  const prevHandCount = prevGame.hands[actorId]?.length ?? 0
  const nextHandCount = nextGame.hands[actorId]?.length ?? 0
  const prevDiscard = prevGame.discardPile.cards
  const nextDiscard = nextGame.discardPile.cards
  const prevDiscardIds = new Set(prevDiscard.map((c) => c.id))
  const prevMeldIds = meldIdSet(prevRoom)
  const nextMeldIds = meldIdSet(nextRoom)

  if (nextDiscard.length > prevDiscard.length) {
    for (const card of nextDiscard) {
      if (!prevDiscardIds.has(card.id)) {
        seedFlipOriginFromAnchor(card.id, handAnchor, remoteFlip)
      }
    }
  }

  for (const id of nextMeldIds) {
    if (prevMeldIds.has(id) || prevDiscardIds.has(id)) continue
    seedFlipOriginFromAnchor(id, handAnchor, remoteFlip)
  }

  const stockDelta = prevGame.stock.length - nextGame.stock.length
  const handDelta = nextHandCount - prevHandCount
  const discardDelta = nextDiscard.length - prevDiscard.length

  if (stockDelta > 0 && handDelta > 0) {
    const from = getFlipAnchorRect('stock')
    const to = getFlipAnchorRect(handAnchor)
    if (from && to) staggerDetachedFlights(from, to, Math.min(stockDelta, handDelta))
  }

  // Remainder-only pickup (discard shrinks into a hidden hand, no new meld).
  // Skip when discard cards landed on a meld — those must FLIP discard → table.
  const meldedFromDiscard = [...nextMeldIds].some((id) => prevDiscardIds.has(id))
  if (discardDelta < 0 && handDelta > 0 && stockDelta === 0 && !meldedFromDiscard) {
    const from = getFlipAnchorRect('discard')
    const to = getFlipAnchorRect(handAnchor)
    if (from && to) staggerDetachedFlights(from, to, handDelta)
  }

  applyPozzettoFlights(prevGame, nextGame, nextRoom, localPlayerId, actorId)
}
