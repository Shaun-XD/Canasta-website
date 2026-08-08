import { useMemo } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import { PlayerAvatar } from '../components/PlayerAvatar'
import { MiniCardStack } from '../components/MiniCardStack'
import { Card } from '../components/Card'
import { TurnBanner } from '../components/TurnBanner'
import { MeldArea } from '../components/MeldArea'
import { RoundEndModal } from '../components/RoundEndModal'
import type { Player } from '../types/game'

export function Table() {
  const { roomId } = useParams()
  const room = useGameStore((s) => s.room)
  const game = useGameStore((s) => s.game)
  const localPlayerId = useGameStore((s) => s.localPlayerId)
  const selectedCardIds = useGameStore((s) => s.selectedCardIds)
  const {
    toggleSelectCard,
    drawFromStock,
    drawFromDiscard,
    discardSelected,
    layMeldFromSelection,
    triggerRoundEnd,
    nextRound,
    returnToLobby,
  } = useGameStore((s) => s.actions)

  const seating = useMemo(() => {
    if (!room || !localPlayerId) return null
    const sorted = [...room.players].sort((a, b) => a.seat - b.seat)
    const localIndex = sorted.findIndex((p) => p.id === localPlayerId)
    if (localIndex === -1) return null
    const ordered = [
      ...sorted.slice(localIndex),
      ...sorted.slice(0, localIndex),
    ] // [local, next clockwise, across, previous]
    return {
      bottom: ordered[0],
      right: ordered[1],
      top: ordered[2],
      left: ordered[3],
    } as Record<'bottom' | 'right' | 'top' | 'left', Player | undefined>
  }, [room, localPlayerId])

  if (!room || room.roomId !== roomId) return <Navigate to="/" replace />
  if (room.status === 'lobby') return <Navigate to={`/lobby/${roomId}`} replace />
  if (!game || !seating) {
    return (
      <div className="felt-bg flex min-h-screen items-center justify-center text-white/70">
        Setting up table…
      </div>
    )
  }

  const localHand = game.hands[localPlayerId!] ?? []
  const activePlayer = room.players.find((p) => p.id === game.turn.activePlayerId)
  const isLocalTurn = game.turn.activePlayerId === localPlayerId
  const topDiscard = game.discardPile.cards[game.discardPile.cards.length - 1]

  const teamOf = (playerId: string | undefined) =>
    room.teams.find((t) => t.playerIds.includes(playerId ?? ''))

  const canDiscard = isLocalTurn && selectedCardIds.length === 1
  const canMeld = isLocalTurn && selectedCardIds.length >= 2
  const canDraw = isLocalTurn && game.turn.phase === 'draw'

  return (
    <div className="felt-bg relative flex min-h-screen flex-col overflow-hidden text-white">
      <header className="flex items-center justify-between px-4 py-2 text-xs text-white/50">
        <span>Room {room.roomId}</span>
        <button
          type="button"
          onClick={triggerRoundEnd}
          className="rounded border border-white/15 px-2 py-1 font-medium text-white/60 transition hover:bg-white/10 hover:text-white"
          title="Dev/test only: real scoring is not implemented yet"
        >
          Dev: End Round
        </button>
      </header>

      <div className="grid flex-1 grid-rows-[auto_1fr_auto] gap-2 px-4 pb-4">
        {/* Top opponent */}
        <div className="flex flex-col items-center gap-1">
          {seating.top && <OpponentBadge player={seating.top} cardCount={game.hands[seating.top.id]?.length ?? 0} />}
          {seating.top && (
            <div className="w-full max-w-xs">
              <MeldArea team={teamOf(seating.top.id)!} align="center" />
            </div>
          )}
        </div>

        {/* Middle row: left opponent, center table, right opponent */}
        <div className="grid grid-cols-[140px_1fr_140px] items-center gap-3">
          <div className="flex flex-col items-center gap-2">
            {seating.left && <OpponentBadge player={seating.left} cardCount={game.hands[seating.left.id]?.length ?? 0} vertical />}
          </div>

          <div className="flex flex-col items-center gap-4">
            <TurnBanner
              playerName={activePlayer?.name ?? ''}
              phase={game.turn.phase}
              isLocalTurn={isLocalTurn}
            />

            <div className="flex items-center gap-10">
              <div className="flex flex-col items-center gap-1">
                <button
                  type="button"
                  disabled={!canDraw}
                  onClick={drawFromStock}
                  className="disabled:opacity-50"
                  title="Draw from stock"
                >
                  <Card faceDown width={56} />
                </button>
                <span className="text-[11px] text-white/50">Stock ({game.stock.length})</span>
              </div>

              <div className="flex flex-col items-center gap-1">
                <button
                  type="button"
                  disabled={!canDraw || !topDiscard}
                  onClick={drawFromDiscard}
                  className="disabled:opacity-50"
                  title="Pick up discard pile"
                >
                  {topDiscard ? (
                    <Card rank={topDiscard.rank} suit={topDiscard.suit} width={56} />
                  ) : (
                    <div className="flex h-[78px] w-[56px] items-center justify-center rounded-lg border-2 border-dashed border-white/20 text-[10px] text-white/40">
                      empty
                    </div>
                  )}
                </button>
                <span className="text-[11px] text-white/50">Discard ({game.discardPile.cards.length})</span>
              </div>
            </div>

            <div className="grid w-full max-w-2xl grid-cols-2 gap-3">
              <MeldArea team={room.teams[0]} align="left" />
              <MeldArea team={room.teams[1]} align="right" />
            </div>
          </div>

          <div className="flex flex-col items-center gap-2">
            {seating.right && <OpponentBadge player={seating.right} cardCount={game.hands[seating.right.id]?.length ?? 0} vertical />}
          </div>
        </div>

        {/* Local player */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={!canDiscard}
              onClick={discardSelected}
              className="rounded-lg bg-red-500/90 px-4 py-2 text-sm font-semibold text-white shadow transition enabled:hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Discard
            </button>
            <button
              type="button"
              disabled={!canMeld}
              onClick={layMeldFromSelection}
              className="rounded-lg bg-blue-500/90 px-4 py-2 text-sm font-semibold text-white shadow transition enabled:hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Lay Meld
            </button>
          </div>

          <div className="flex max-w-full items-end overflow-x-auto px-4 pb-2 scrollbar-thin">
            {localHand.map((card) => (
              <div key={card.id} style={{ marginLeft: -14 }} className="first:ml-0">
                <Card
                  rank={card.rank}
                  suit={card.suit}
                  width={68}
                  selected={selectedCardIds.includes(card.id)}
                  onClick={() => toggleSelectCard(card.id)}
                />
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 text-sm">
            {seating.bottom && (
              <PlayerAvatar
                name={seating.bottom.name}
                color={seating.bottom.avatarColor}
                connectionStatus={seating.bottom.connectionStatus}
                size={32}
              />
            )}
            <span className="font-medium">{seating.bottom?.name} (you)</span>
          </div>
        </div>
      </div>

      {room.status === 'round-end' && (
        <RoundEndModal
          teams={room.teams}
          scores={game.lastRoundScores}
          onNextRound={nextRound}
          onReturnToLobby={returnToLobby}
        />
      )}
    </div>
  )
}

function OpponentBadge({
  player,
  cardCount,
  vertical = false,
}: {
  player: Player
  cardCount: number
  vertical?: boolean
}) {
  return (
    <div className={`flex items-center gap-2 rounded-xl bg-black/25 px-3 py-2 ${vertical ? 'flex-col' : ''}`}>
      <PlayerAvatar name={player.name} color={player.avatarColor} connectionStatus={player.connectionStatus} size={40} />
      <div className={vertical ? 'text-center' : ''}>
        <p className="text-xs font-semibold leading-tight">{player.name}</p>
        <p className="text-[10px] text-white/50">Seat {player.seat + 1}</p>
      </div>
      <MiniCardStack count={cardCount} />
    </div>
  )
}
