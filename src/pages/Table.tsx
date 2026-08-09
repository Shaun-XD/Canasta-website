import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import { PlayerAvatar } from '../components/PlayerAvatar'
import { MiniCardStack } from '../components/MiniCardStack'
import { Card } from '../components/Card'
import { AnimatedCard } from '../components/AnimatedCard'
import { DiscardPileView, DISCARD_CARD_WIDTH } from '../components/DiscardPileView'
import { TurnBanner } from '../components/TurnBanner'
import { TurnTimerBadge } from '../components/TurnTimerBadge'
import { MeldArea } from '../components/MeldArea'
import { RoundEndModal } from '../components/RoundEndModal'
import { useCountdown } from '../hooks/useCountdown'
import { seedFlipOrigin } from '../hooks/useCardFlip'
import { useHandReorder } from '../hooks/useHandReorder'
import { evaluateShowEligibility, unmetShowConditions } from '../engine/showEligibility'
import type { Player } from '../types/game'

export function Table() {
  const { roomId } = useParams()
  const room = useGameStore((s) => s.room)
  const game = useGameStore((s) => s.game)
  const localPlayerId = useGameStore((s) => s.localPlayerId)
  const selectedCardIds = useGameStore((s) => s.selectedCardIds)
  const selectedMeldId = useGameStore((s) => s.selectedMeldId)
  const topTouchInProgress = useGameStore((s) => s.topTouchInProgress)
  const lastActionError = useGameStore((s) => s.lastActionError)
  const {
    toggleSelectCard,
    selectMeldTarget,
    drawFromStock,
    beginTopTouch,
    cancelTopTouch,
    attemptMeld,
    moveWildInMeld,
    resolveSlide,
    discardSelected,
    declareShow,
    forceSuddenDeathEndRound,
    autoEndTurn,
    togglePauseTimer,
    nextRound,
    returnToLobby,
  } = useGameStore((s) => s.actions)

  // Item 3: the stock pile is rendered as one generic face-down card (not a
  // per-card element), so a freshly-drawn card has no prior on-screen rect
  // to fly FROM. We capture the stock pile's rect at click time and seed it
  // for the drawn card's id so the FLIP animation in `AnimatedCard` picks it
  // up as the origin once that card renders inside the hand.
  const stockRef = useRef<HTMLButtonElement>(null)

  // Item 7: shake + red flash + haptic feedback for blocked/illegal actions.
  const [feedback, setFeedback] = useState<{ message: string; token: number } | null>(null)
  const prevStoreErrorRef = useRef<string | null>(null)

  function reportInvalidAction(message: string) {
    setFeedback({ message, token: Date.now() })
    if ('vibrate' in navigator) navigator.vibrate(120)
  }

  useEffect(() => {
    if (lastActionError && lastActionError !== prevStoreErrorRef.current) {
      reportInvalidAction(lastActionError)
    }
    prevStoreErrorRef.current = lastActionError
  }, [lastActionError])

  // Item 6: exactly 3 players in a top row, local player's teammate centered.
  const seating = useMemo(() => {
    if (!room || !localPlayerId) return null
    const localPlayer = room.players.find((p) => p.id === localPlayerId)
    if (!localPlayer) return null
    const sorted = [...room.players].sort((a, b) => a.seat - b.seat)
    const localIndex = sorted.findIndex((p) => p.id === localPlayerId)
    const restClockwise =
      localIndex >= 0 ? [...sorted.slice(localIndex + 1), ...sorted.slice(0, localIndex)] : sorted.filter((p) => p.id !== localPlayerId)
    const teammate = restClockwise.find((p) => p.teamId === localPlayer.teamId)
    const opponents = restClockwise.filter((p) => p.id !== teammate?.id)
    return {
      bottom: localPlayer,
      teammate,
      topLeft: opponents[0],
      topRight: opponents[1],
    } as { bottom: Player; teammate?: Player; topLeft?: Player; topRight?: Player }
  }, [room, localPlayerId])

  // Item 2: per-player turn countdown, driven off the current turn's start time.
  const turnDeadline = game && room ? game.turn.startedAt + room.turnTimerSeconds * 1000 : null
  const isPaused = game?.turn.isPaused ?? false
  const remainingSeconds = useCountdown(turnDeadline, isPaused)
  const firedAutoEndForTurnRef = useRef<number | null>(null)

  const isLocalTurn = !!game && game.turn.activePlayerId === localPlayerId

  useEffect(() => {
    if (!game || !isLocalTurn || remainingSeconds == null || isPaused) return
    if (remainingSeconds > 0) return
    if (firedAutoEndForTurnRef.current === game.turn.turnNumber) return
    firedAutoEndForTurnRef.current = game.turn.turnNumber
    autoEndTurn()
  }, [remainingSeconds, isLocalTurn, isPaused, game, autoEndTurn])

  function handleDrawFromStock() {
    const stockRect = stockRef.current?.getBoundingClientRect()
    drawFromStock()
    if (!stockRect) return
    const acquired = useGameStore.getState().game?.lastAcquired
    if (acquired && acquired.playerId === localPlayerId) {
      for (const cardId of acquired.cardIds) seedFlipOrigin(cardId, stockRect)
    }
  }

  if (!room || room.roomId !== roomId) return <Navigate to="/" replace />
  if (room.status === 'lobby') return <Navigate to={`/lobby/${roomId}`} replace />
  if (!game || !seating) {
    return (
      <div className="felt-bg flex min-h-screen items-center justify-center text-white/70">
        Setting up table…
      </div>
    )
  }

  const localPlayer = room.players.find((p) => p.id === localPlayerId)
  const localTeam = room.teams.find((t) => t.playerIds.includes(localPlayerId ?? ''))
  const localHand = game.hands[localPlayerId!] ?? []
  const activePlayer = room.players.find((p) => p.id === game.turn.activePlayerId)
  const topDiscard = game.discardPile.cards[game.discardPile.cards.length - 1]

  const isDrawPhase = isLocalTurn && game.turn.phase === 'draw'
  const isActionPhase = isLocalTurn && game.turn.phase === 'action'
  const stockDepleted = game.stock.length === 0
  const canDiscard = (isActionPhase || (isLocalTurn && game.turn.phase === 'discard')) && selectedCardIds.length === 1

  const showElig = localTeam ? evaluateShowEligibility(localTeam, localHand.length) : null
  const canDeclareShow =
    isActionPhase &&
    !!showElig &&
    showElig.reserveActivated &&
    showElig.canastaWinCondition &&
    (localHand.length === 0 || (localHand.length === 1 && selectedCardIds.length === 1))
  const showUnmetReasons = showElig ? unmetShowConditions(showElig) : []

  // Item 8: cards this player just drew / picked up glow for a couple seconds.
  const acquired = game.lastAcquired
  function isRecentlyAcquired(cardId: string): boolean {
    return (
      !!acquired &&
      acquired.playerId === localPlayerId &&
      acquired.cardIds.includes(cardId) &&
      Date.now() - acquired.at < 2500
    )
  }

  function handleLaySet() {
    if (!isActionPhase) return reportInvalidAction('You can only meld during your action phase (after drawing).')
    if (selectedCardIds.length < 3) return reportInvalidAction('Select at least 3 cards of the same rank to lay a Set.')
    createMeldFromSelection('set')
  }

  function handleLaySequence() {
    if (!isActionPhase) return reportInvalidAction('You can only meld during your action phase (after drawing).')
    if (selectedCardIds.length < 3) return reportInvalidAction('Select at least 3 consecutive same-suit cards to lay a Sequence.')
    createMeldFromSelection('sequence')
  }

  function handleAppendToMeld() {
    if (!isActionPhase) return reportInvalidAction('You can only meld during your action phase (after drawing).')
    if (selectedCardIds.length !== 1) return reportInvalidAction('Select exactly 1 hand card to append.')
    if (!selectedMeldId) return reportInvalidAction("Select one of your team's melds above to append to.")
    appendSelectedCardToMeld(selectedMeldId)
  }

  return (
    <div className="felt-bg relative flex min-h-screen flex-col text-white">
      <header className="flex items-center justify-between px-4 py-2 text-xs text-white/50">
        <span>Room {room.roomId}</span>
        <div className="flex items-center gap-3">
          <span>Round {game.round} · Target {room.matchTargetScore} · Turn timer {room.turnTimerSeconds}s</span>
          <button
            type="button"
            onClick={togglePauseTimer}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
              isPaused
                ? 'bg-yellow-400 text-emerald-950 hover:bg-yellow-300'
                : 'bg-white/10 text-white/70 hover:bg-white/20'
            }`}
            title={isPaused ? 'Resume the turn timer for everyone' : 'Pause the turn timer for everyone'}
          >
            {isPaused ? '▶ Resume' : '⏸ Pause'}
          </button>
        </div>
      </header>

      <div className="grid flex-1 grid-rows-[auto_minmax(0,1fr)_auto_auto] gap-3 px-4 pb-4">
        {/* Top row: exactly 3 players, teammate centered (item 6) */}
        <div className="grid grid-cols-3 items-start gap-2">
          <div className="flex justify-start">
            {seating.topLeft && (
              <OpponentBadge
                player={seating.topLeft}
                cardCount={game.hands[seating.topLeft.id]?.length ?? 0}
                isActive={game.turn.activePlayerId === seating.topLeft.id}
                remainingSeconds={remainingSeconds}
                isPaused={isPaused}
              />
            )}
          </div>
          <div className="flex justify-center">
            {seating.teammate && (
              <OpponentBadge
                player={seating.teammate}
                cardCount={game.hands[seating.teammate.id]?.length ?? 0}
                isActive={game.turn.activePlayerId === seating.teammate.id}
                remainingSeconds={remainingSeconds}
                isPaused={isPaused}
                highlight
              />
            )}
          </div>
          <div className="flex justify-end">
            {seating.topRight && (
              <OpponentBadge
                player={seating.topRight}
                cardCount={game.hands[seating.topRight.id]?.length ?? 0}
                isActive={game.turn.activePlayerId === seating.topRight.id}
                remainingSeconds={remainingSeconds}
                isPaused={isPaused}
              />
            )}
          </div>
        </div>

        {/* Expanded meld zones for both teams (item 6) */}
        <div className="grid min-h-0 grid-cols-1 gap-3 sm:grid-cols-2">
          {room.teams.map((team) => (
            <div key={team.id} className="flex min-h-0 flex-col gap-1">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-semibold text-white/60">{team.name}</span>
                <PozzettoBadge team={team} />
              </div>
              <MeldArea
                team={team}
                align={team.id === room.teams[0].id ? 'left' : 'right'}
                selectable={isActionPhase && localTeam?.id === team.id}
                selectedMeldId={selectedMeldId}
                onSelectMeld={(id) => selectMeldTarget(selectedMeldId === id ? null : id)}
              />
            </div>
          ))}
        </div>

        {/* Turn banner + stock/discard + Top Touch controls */}
        <div className="flex flex-col items-center gap-3">
          <TurnBanner
            playerName={activePlayer?.name ?? ''}
            phase={game.turn.phase}
            isLocalTurn={isLocalTurn}
            remainingSeconds={remainingSeconds}
            isPaused={isPaused}
          />

          {/* Item 5: both piles share the same card width and bottom-align on
              the same baseline (items-end) so the row reads as one coherent
              line instead of the stock/discard cards sitting at different
              heights/sizes. */}
          <div className="flex items-end gap-10">
            <div className="flex flex-col items-center gap-1">
              <button
                ref={stockRef}
                type="button"
                disabled={!isDrawPhase || stockDepleted}
                onClick={handleDrawFromStock}
                className="disabled:opacity-50"
                title="Draw from stock"
              >
                <Card faceDown width={DISCARD_CARD_WIDTH} />
              </button>
              <span className="text-[11px] text-white/50">Stock ({game.stock.length})</span>
            </div>

            <div className="flex flex-col items-center gap-1">
              <DiscardPileView cards={game.discardPile.cards} />
              <span className="text-[11px] text-white/50">Discard ({game.discardPile.cards.length})</span>
            </div>
          </div>

          {isDrawPhase && topDiscard && (
            <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
              <span className="text-white/50">Top Touch:</span>
              <button
                type="button"
                onClick={() =>
                  selectedCardIds.length < 2
                    ? reportInvalidAction('Select at least 2 hand cards to combine with the top discard.')
                    : attemptTopTouch('newSet')
                }
                className="rounded-md bg-blue-500/80 px-2 py-1 font-medium hover:bg-blue-400"
              >
                As new Set
              </button>
              <button
                type="button"
                onClick={() =>
                  selectedCardIds.length < 2
                    ? reportInvalidAction('Select at least 2 hand cards to combine with the top discard.')
                    : attemptTopTouch('newSequence')
                }
                className="rounded-md bg-blue-500/80 px-2 py-1 font-medium hover:bg-blue-400"
              >
                As new Sequence
              </button>
              <button
                type="button"
                onClick={() =>
                  !selectedMeldId
                    ? reportInvalidAction("Select one of your team's melds above to Top Touch onto.")
                    : attemptTopTouch('append')
                }
                className="rounded-md bg-blue-500/80 px-2 py-1 font-medium hover:bg-blue-400"
              >
                Append to selected meld
              </button>
            </div>
          )}

          {stockDepleted && isLocalTurn && (
            <button
              type="button"
              onClick={forceSuddenDeathEndRound}
              className="rounded-md border border-red-300/40 bg-red-500/20 px-3 py-1 text-xs font-medium text-red-100 hover:bg-red-500/30"
              title="Stock is empty. If you cannot Top Touch AND immediately empty your hand with a legal Show this turn, the round must end now."
            >
              Stock empty — End Round (Sudden Death)
            </button>
          )}
        </div>

        {/* Local player: 3 meld actions (item 7) + hand (item 5 clipping fix) */}
        <div className="flex flex-col items-center gap-2">
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
            {isLocalTurn && remainingSeconds != null && (
              <TurnTimerBadge seconds={remainingSeconds} compact paused={isPaused} />
            )}
            <PozzettoBadge team={localTeam} />
          </div>

          <div key={feedback?.token ?? 'stable'} className="flex flex-col items-center gap-1">
            <div
              className={`flex flex-wrap items-center justify-center gap-3 ${feedback ? 'animate-shake' : ''}`}
            >
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
                onClick={handleLaySet}
                className="rounded-lg bg-blue-500/90 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-blue-400"
              >
                Lay Set
              </button>
              <button
                type="button"
                onClick={handleLaySequence}
                className="rounded-lg bg-indigo-500/90 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-indigo-400"
              >
                Lay Sequence
              </button>
              <button
                type="button"
                onClick={handleAppendToMeld}
                className="rounded-lg bg-teal-500/90 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-teal-400"
                title="Select 1 hand card + 1 of your team's melds above"
              >
                Append to Meld
              </button>
              <button
                type="button"
                disabled={!canDeclareShow}
                onClick={declareShow}
                className="rounded-lg bg-yellow-400 px-4 py-2 text-sm font-semibold text-emerald-950 shadow transition enabled:hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-40"
                title={showUnmetReasons.length > 0 ? showUnmetReasons.join(' ') : 'Declare Show and end the round'}
              >
                Declare Show
              </button>
            </div>

            {feedback && (
              <p className="max-w-md rounded-md bg-red-500/20 px-3 py-1 text-center text-xs font-medium text-red-200 ring-1 ring-red-400/40">
                {feedback.message}
              </p>
            )}
            {!feedback && showUnmetReasons.length > 0 && isActionPhase && (
              <p className="max-w-md text-center text-[11px] text-white/40">{showUnmetReasons.join(' ')}</p>
            )}
          </div>

          {/* Extra top/side padding here is intentional: it gives the
              enlarged/selected card (translate-y + ring) room to render
              fully instead of being clipped by this scroll container
              (item 5). */}
          <div className="flex max-w-full items-end overflow-x-auto overflow-y-visible px-4 pb-2 pt-6 scrollbar-thin">
            {localHand.map((card) => (
              <AnimatedCard
                key={card.id}
                flipId={card.id}
                rank={card.rank}
                suit={card.suit}
                width={68}
                selected={selectedCardIds.includes(card.id)}
                isNew={isRecentlyAcquired(card.id)}
                onClick={() => toggleSelectCard(card.id)}
                style={{ marginLeft: -14 }}
                wrapperClassName="first:ml-0"
              />
            ))}
          </div>
        </div>
      </div>

      {game.pendingSlide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-emerald-950 p-6 text-center shadow-2xl">
            <h3 className="text-lg font-bold text-white">Slide the displaced wild card</h3>
            <p className="mt-1 text-sm text-white/60">
              Your natural card fills the wild's slot. Choose which edge the wild card slides to.
            </p>
            <div className="mt-4 flex justify-center gap-3">
              <button
                type="button"
                onClick={() => resolveSlide('bottom')}
                className="flex-1 rounded-lg border border-white/20 px-4 py-2 font-medium text-white transition hover:bg-white/10"
              >
                Bottom edge
              </button>
              <button
                type="button"
                onClick={() => resolveSlide('top')}
                className="flex-1 rounded-lg bg-yellow-400 px-4 py-2 font-semibold text-emerald-950 transition hover:bg-yellow-300"
              >
                Top edge
              </button>
            </div>
          </div>
        </div>
      )}

      {room.status === 'round-end' && (
        <RoundEndModal
          teams={room.teams}
          scores={game.lastRoundScores}
          matchTargetScore={room.matchTargetScore}
          gameOverTeamId={game.gameOverTeamId}
          onNextRound={nextRound}
          onReturnToLobby={returnToLobby}
        />
      )}

      {!localPlayer && null}
    </div>
  )
}

function PozzettoBadge({ team }: { team?: { name: string; pozzetto: { claimed: boolean; activated: boolean } } }) {
  if (!team) return null
  const label = team.pozzetto.activated ? 'Pozzetto activated' : team.pozzetto.claimed ? 'Pozzetto claimed' : 'Pozzetto in reserve'
  const color = team.pozzetto.activated
    ? 'bg-emerald-400/20 text-emerald-200'
    : team.pozzetto.claimed
      ? 'bg-amber-400/20 text-amber-200'
      : 'bg-white/10 text-white/50'
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${color}`}>{label}</span>
}

function OpponentBadge({
  player,
  cardCount,
  isActive = false,
  remainingSeconds = null,
  isPaused = false,
  highlight = false,
}: {
  player: Player
  cardCount: number
  isActive?: boolean
  remainingSeconds?: number | null
  /** True while the room's turn timer is paused for everyone at the table. */
  isPaused?: boolean
  /** True for the local player's teammate, seated center of the top row (item 6). */
  highlight?: boolean
}) {
  return (
    <div
      className={`flex flex-col items-center gap-2 rounded-xl px-3 py-2 transition-colors ${
        highlight ? 'bg-yellow-400/10 ring-1 ring-yellow-300/30' : 'bg-black/25'
      } ${isActive ? 'ring-2 ring-yellow-300' : ''}`}
    >
      <PlayerAvatar name={player.name} color={player.avatarColor} connectionStatus={player.connectionStatus} size={40} />
      <div className="text-center">
        <p className="flex items-center justify-center gap-1 text-xs font-semibold leading-tight">
          {player.name}
          {highlight && <span className="text-[9px] font-normal text-yellow-300">(partner)</span>}
        </p>
        <p className="text-[10px] text-white/50">Seat {player.seat + 1}</p>
      </div>
      <MiniCardStack count={cardCount} />
      {isActive && remainingSeconds != null && <TurnTimerBadge seconds={remainingSeconds} compact paused={isPaused} />}
    </div>
  )
}
