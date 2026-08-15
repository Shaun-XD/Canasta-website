import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import { PlayerAvatar } from '../components/PlayerAvatar'
import { MiniCardStack } from '../components/MiniCardStack'
import { Card } from '../components/Card'
import { AnimatedCard } from '../components/AnimatedCard'
import { DiscardPileView, DISCARD_CARD_WIDTH } from '../components/DiscardPileView'
import { PozzettoStacks } from '../components/PozzettoStacks'
import { TurnBanner } from '../components/TurnBanner'
import { TurnTimerBadge } from '../components/TurnTimerBadge'
import { MeldArea } from '../components/MeldArea'
import { RoundEndModal } from '../components/RoundEndModal'
import { useCountdown } from '../hooks/useCountdown'
import { seedFlipOrigin } from '../hooks/useCardFlip'
import { useHandReorder } from '../hooks/useHandReorder'
import { HandSortButtons, type HandSortMode } from '../components/HandSortButtons'
import { sortHandByRank, sortHandBySuit } from '../lib/deck'
import { evaluateShowEligibility, unmetShowConditions } from '../engine/showEligibility'
import type { Player, Team } from '../types/game'
import { meldCards } from '../types/game'

const HAND_CARD_WIDTH = 78
/** Deal size — spacing is calibrated so 13 cards define the squeeze baseline. */
const HAND_BASE_COUNT = 13
/** Visible strip per card at a full 13-card hand. */
const HAND_COMFORT_PEEK = 48
/** Floor when squeezing hands larger than 13 into the 13-card width. */
const HAND_MIN_PEEK = 12
/** Fixed rail for >13 squeeze = one full 13-card comfort fan. */
const HAND_REF_WIDTH = HAND_CARD_WIDTH + (HAND_BASE_COUNT - 1) * HAND_COMFORT_PEEK
/**
 * Max fan width when holding fewer than 13 (spread multiplier can grow the fan).
 * Caps how far apart cards get so a 2–3 card hand doesn't span the whole screen.
 */
const HAND_MAX_FAN_WIDTH = HAND_CARD_WIDTH + (HAND_BASE_COUNT - 1) * Math.round(HAND_COMFORT_PEEK * 1.5)

export function Table() {
  const { roomId } = useParams()
  const room = useGameStore((s) => s.room)
  const game = useGameStore((s) => s.game)
  const localPlayerId = useGameStore((s) => s.localPlayerId)
  const selectedCardIds = useGameStore((s) => s.selectedCardIds)
  const selectedMeldId = useGameStore((s) => s.selectedMeldId)
  const topTouchInProgress = useGameStore((s) => s.topTouchInProgress)
  const selectedDiscardIds = useGameStore((s) => s.selectedDiscardIds)
  const lastActionError = useGameStore((s) => s.lastActionError)
  const {
    toggleSelectCard,
    selectMeldTarget,
    drawFromStock,
    beginTopTouch,
    cancelTopTouch,
    toggleDiscardPileCard,
    attemptMeld,
    moveWildInMeld,
    resolveSlide,
    discardSelected,
    declareShow,
    forceSuddenDeathEndRound,
    autoEndTurn,
    togglePauseTimer,
    startNewGame,
    returnToLobby,
    exitToHome,
    rejoinOnlineSession,
  } = useGameStore((s) => s.actions)

  // Restore socket→player binding after refresh / reconnect.
  useEffect(() => {
    void rejoinOnlineSession()
  }, [roomId, rejoinOnlineSession])

  // Item 3: the stock pile is rendered as one generic face-down card (not a
  // per-card element), so a freshly-drawn card has no prior on-screen rect
  // to fly FROM. We capture the stock pile's rect at click time and seed it
  // for the drawn card's id so the FLIP animation in `AnimatedCard` picks it
  // up as the origin once that card renders inside the hand.
  const stockRef = useRef<HTMLButtonElement>(null)
  const handRailRef = useRef<HTMLDivElement>(null)
  const [handRailWidth, setHandRailWidth] = useState(HAND_MAX_FAN_WIDTH)
  const [hoveredHandId, setHoveredHandId] = useState<string | null>(null)
  /** Sync lock so pointerenter during reorder doesn't enlarge neighbor cards before React state catches up. */
  const isReorderingRef = useRef(false)

  // Item 7: shake + red flash + haptic feedback for blocked/illegal actions.
  const [feedback, setFeedback] = useState<{ message: string; token: number } | null>(null)
  const prevStoreErrorRef = useRef<string | null>(null)
  const feedbackClearRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function reportInvalidAction(message: string) {
    if (feedbackClearRef.current) clearTimeout(feedbackClearRef.current)
    setFeedback({ message, token: Date.now() })
    if ('vibrate' in navigator) navigator.vibrate(120)
    feedbackClearRef.current = setTimeout(() => {
      setFeedback(null)
      feedbackClearRef.current = null
    }, 3200)
  }

  useEffect(() => {
    return () => {
      if (feedbackClearRef.current) clearTimeout(feedbackClearRef.current)
    }
  }, [])

  useEffect(() => {
    if (lastActionError && lastActionError !== prevStoreErrorRef.current) {
      reportInvalidAction(lastActionError)
    }
    prevStoreErrorRef.current = lastActionError
  }, [lastActionError])

  useLayoutEffect(() => {
    const el = handRailRef.current
    if (!el) return
    const measure = () => {
      // Measure the full-width parent, not the fan itself — otherwise a
      // shrink-wrapped rail and the peek math fight each other into a tiny hand.
      const parent = el.parentElement
      const raw = parent?.clientWidth ?? el.clientWidth
      setHandRailWidth(Math.max(HAND_REF_WIDTH, raw - 16))
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (el.parentElement) ro.observe(el.parentElement)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Classic table seats: teammate North, opponents West/East (clockwise from local).
  // 1v1: sole opponent sits North (no teammate / side seats).
  const seating = useMemo(() => {
    if (!room || !localPlayerId) return null
    const localPlayer = room.players.find((p) => p.id === localPlayerId)
    if (!localPlayer) return null
    const sorted = [...room.players].sort((a, b) => a.seat - b.seat)
    const localIndex = sorted.findIndex((p) => p.id === localPlayerId)
    const restClockwise =
      localIndex >= 0 ? [...sorted.slice(localIndex + 1), ...sorted.slice(0, localIndex)] : sorted.filter((p) => p.id !== localPlayerId)

    if (room.players.length === 2) {
      return {
        south: localPlayer,
        north: restClockwise[0],
      } as { south: Player; north?: Player; west?: Player; east?: Player }
    }

    const teammate = restClockwise.find((p) => p.teamId === localPlayer.teamId)
    const opponents = restClockwise.filter((p) => p.id !== teammate?.id)
    return {
      south: localPlayer,
      north: teammate,
      west: opponents[0],
      east: opponents[1],
    } as { south: Player; north?: Player; west?: Player; east?: Player }
  }, [room, localPlayerId])

  // Item 2: per-player turn countdown, driven off the current turn's start time.
  // turnTimerSeconds === 0 means no timer (no countdown / no auto skip).
  const timerEnabled = !!room && room.turnTimerSeconds > 0
  const turnDeadline =
    timerEnabled && game ? game.turn.startedAt + room.turnTimerSeconds * 1000 : null
  const isPaused = game?.turn.isPaused ?? false
  const remainingSeconds = useCountdown(turnDeadline, isPaused)
  const firedAutoEndForTurnRef = useRef<number | null>(null)

  const isLocalTurn = !!game && game.turn.activePlayerId === localPlayerId

  useEffect(() => {
    if (!timerEnabled) return
    if (!game || !isLocalTurn || remainingSeconds == null || isPaused) return
    if (remainingSeconds > 0) return
    if (firedAutoEndForTurnRef.current === game.turn.turnNumber) return
    firedAutoEndForTurnRef.current = game.turn.turnNumber
    autoEndTurn()
  }, [timerEnabled, remainingSeconds, isLocalTurn, isPaused, game, autoEndTurn])

  function handleDrawFromStock() {
    const stockRect = stockRef.current?.getBoundingClientRect()
    drawFromStock()
    if (!stockRect) return
    // Solo updates lastAcquired synchronously. Online seeds in onGameState
    // via seedFlipOriginIfUnknown before the hand card mounts.
    const acquired = useGameStore.getState().game?.lastAcquired
    if (acquired && acquired.playerId === localPlayerId) {
      for (const cardId of acquired.cardIds) seedFlipOrigin(cardId, stockRect)
    }
  }

  const meldedCardIds = useMemo(() => {
    const ids = new Set<string>()
    if (!room) return ids
    for (const team of room.teams) {
      for (const meld of team.melds) {
        for (const card of meldCards(meld)) ids.add(card.id)
      }
    }
    return ids
  }, [room])

  // Item 6: local-only drag-to-reorder for the player's hand row. Must run
  // unconditionally (before any early returns) per the rules of hooks - the
  // id list is simply empty until the table/hand actually exists.
  // Never render a card that's already on a meld — duplicate flipIds invert
  // the flight (teleport onto the meld, then fly back into the hand).
  const rawLocalHand =
    game && localPlayerId
      ? (game.hands[localPlayerId] ?? []).filter((c) => !meldedCardIds.has(c.id))
      : []
  const {
    order: handOrder,
    draggingId,
    handlePointerDown: handleCardPointerDown,
    handlePointerEnter: handleCardPointerEnter,
    applyOrder: applyHandOrder,
  } = useHandReorder(rawLocalHand.map((c) => c.id))
  const [handSortMode, setHandSortMode] = useState<HandSortMode | null>('suit')

  useEffect(() => {
    if (draggingId == null) isReorderingRef.current = false
    else setHandSortMode(null) // manual drag clears the active auto-sort highlight
  }, [draggingId])

  if (!room || room.roomId !== roomId) return <Navigate to="/" replace />
  if (room.status === 'lobby') return <Navigate to={`/lobby/${roomId}`} replace />
  if (!game || !seating) {
    return (
      <div className="felt-bg table-shell flex items-center justify-center text-white/70">
        Setting up table…
      </div>
    )
  }

  const localPlayer = room.players.find((p) => p.id === localPlayerId)
  const localTeam = room.teams.find((t) => t.playerIds.includes(localPlayerId ?? ''))
  const localHand = rawLocalHand
  const orderedLocalHand = handOrder.map((id) => localHand.find((c) => c.id === id)).filter((c): c is (typeof localHand)[number] => !!c)
  const activePlayer = room.players.find((p) => p.id === game.turn.activePlayerId)
  const topDiscard = game.discardPile.cards[game.discardPile.cards.length - 1]

  const isDrawPhase = isLocalTurn && game.turn.phase === 'draw'
  const isActionPhase = isLocalTurn && game.turn.phase === 'action'
  const stockDepleted = game.stock.length === 0
  // Count only ids still in hand — stale ids from a prior online meld must not
  // block Discard while the UI only highlights the live card(s).
  const handIdSet = new Set(localHand.map((c) => c.id))
  const validSelectedCount = selectedCardIds.filter((id) => handIdSet.has(id)).length
  const canDiscard =
    (isActionPhase || (isLocalTurn && game.turn.phase === 'discard')) && validSelectedCount === 1

  const showElig = localTeam ? evaluateShowEligibility(localTeam, localHand.length) : null
  const canDeclareShow =
    isActionPhase &&
    !!showElig &&
    showElig.reserveActivated &&
    showElig.canastaWinCondition &&
    (localHand.length === 0 || (localHand.length === 1 && validSelectedCount === 1))
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

  function handleMeld() {
    if (topTouchInProgress) {
      if (validSelectedCount === 0 && !selectedMeldId) {
        return reportInvalidAction('Select hand cards or a meld group to combine with the top discard card.')
      }
      attemptMeld()
      return
    }
    if (!isActionPhase) return reportInvalidAction('You can only meld during your action phase (after drawing).')
    if (validSelectedCount === 0) return reportInvalidAction('Select hand cards to meld.')
    attemptMeld()
  }

  function handleBeginTopTouch() {
    if (!isDrawPhase) return reportInvalidAction('You can only Top Touch during your draw phase.')
    if (!topDiscard) return reportInvalidAction('The discard pile is empty.')
    beginTopTouch()
  }

  function handleSortHandBySuit() {
    applyHandOrder(sortHandBySuit(localHand).map((c) => c.id))
    setHandSortMode('suit')
  }

  function handleSortHandByRank() {
    applyHandOrder(sortHandByRank(localHand).map((c) => c.id))
    setHandSortMode('rank')
  }

  const opponentTeam = room.teams.find((t) => t.id !== localTeam?.id)
  const leftTeam = localTeam ?? room.teams[0]
  const rightTeam = opponentTeam ?? room.teams.find((t) => t.id !== leftTeam?.id)

  // ≤13: fewer cards → larger peek (spreadMult = 13/count). >13: squeeze into
  // the same width a 13-card comfort fan uses.
  const handCount = orderedLocalHand.length
  const handPeek = (() => {
    if (handCount <= 1) return HAND_CARD_WIDTH
    if (handCount <= HAND_BASE_COUNT) {
      const spreadMult = HAND_BASE_COUNT / handCount
      // Wider base + multiplier so a short hand fans out clearly.
      const desiredPeek = Math.min(HAND_CARD_WIDTH - 4, Math.round(HAND_COMFORT_PEEK * spreadMult))
      const desiredWidth = HAND_CARD_WIDTH + (handCount - 1) * desiredPeek
      // Only compress if the real viewport is narrower than that fan.
      const room = Math.max(handRailWidth, HAND_REF_WIDTH)
      const fitWidth = Math.min(desiredWidth, room, HAND_MAX_FAN_WIDTH)
      if (fitWidth >= desiredWidth - 1) return desiredPeek
      return Math.max(HAND_COMFORT_PEEK, (fitWidth - HAND_CARD_WIDTH) / (handCount - 1))
    }
    const fitWidth = Math.min(HAND_REF_WIDTH, handRailWidth)
    return Math.max(HAND_MIN_PEEK, (fitWidth - HAND_CARD_WIDTH) / (handCount - 1))
  })()
  const handOverlap = HAND_CARD_WIDTH - handPeek
  const handFanWidth =
    handCount <= 1 ? HAND_CARD_WIDTH : HAND_CARD_WIDTH + (handCount - 1) * handPeek

  return (
    <div className="felt-bg table-shell relative flex flex-col text-white">
      <header className="table-topbar shrink-0">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-wide text-white/90">
            Room <span className="font-mono text-yellow-300">{room.roomId}</span>
          </p>
          <p className="mt-0.5 truncate text-[11px] text-white/45 sm:hidden">
            R{game.round} · {room.matchTargetScore} pts · {timerEnabled ? `${room.turnTimerSeconds}s` : 'no timer'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <span className="hidden rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-white/55 ring-1 ring-white/10 sm:inline">
            Round {game.round} · Target {room.matchTargetScore} ·{' '}
            {timerEnabled ? `${room.turnTimerSeconds}s` : 'No timer'}
          </span>
          {timerEnabled && (
            <button
              type="button"
              onClick={togglePauseTimer}
              className={`action-btn action-btn-ghost !min-h-9 !min-w-0 !px-3 !py-1.5 !text-[11px] ${
                isPaused ? '!bg-yellow-400 !text-emerald-950' : ''
              }`}
              title={isPaused ? 'Resume the turn timer for everyone' : 'Pause the turn timer for everyone'}
            >
              {isPaused ? 'Resume' : 'Pause'}
            </button>
          )}
          <button
            type="button"
            onClick={exitToHome}
            className="action-btn action-btn-danger !min-h-9 !min-w-0 !px-3 !py-1.5 !text-[11px]"
            title="Exit to home — ends the game and clears session state"
          >
            Exit
          </button>
        </div>
      </header>

      <div className="relative mx-auto flex w-full max-w-[90rem] min-h-0 flex-1 flex-col gap-1 px-1.5 py-1 sm:gap-1.5 sm:px-3 sm:py-1.5">
        <div className="pointer-events-none absolute right-1.5 top-1 z-30 flex flex-col items-end gap-1 sm:right-3">
          <div className="pointer-events-auto rounded-lg bg-black/40 px-2 py-1.5 ring-1 ring-white/10 backdrop-blur-sm">
            <p className="mb-1 text-right text-[8px] font-bold uppercase tracking-[0.14em] text-white/45">
              Pozzetto
            </p>
            <PozzettoStacks
              teams={room.teams}
              localTeamId={localTeam?.id}
              stackCounts={{
                'team-a': game.pozzettoStacks['team-a']?.length ?? 0,
                'team-b': game.pozzettoStacks['team-b']?.length ?? 0,
              }}
            />
          </div>
          <PozzettoActiveStatus teams={room.teams} localTeamId={localTeam?.id} />
        </div>

        {/* NORTH — teammate */}
        <div className="flex shrink-0 justify-center">
          {seating.north && (
            <SidePlayer
              player={seating.north}
              cardCount={game.hands[seating.north.id]?.length ?? 0}
              isActive={game.turn.activePlayerId === seating.north.id}
              remainingSeconds={remainingSeconds}
              isPaused={isPaused}
              highlight
              roleLabel={room.players.length === 2 ? 'Opponent' : 'Teammate'}
              stackOrientation="horizontal"
            />
          )}
        </div>

        {/* WEST | MELDS (grow) | EAST — melds own the vertical space */}
        <div className="melds-row flex min-h-0 flex-[1_1_0] items-stretch gap-1.5 sm:gap-2">
          <div className="flex w-[3.75rem] shrink-0 flex-col items-center justify-center sm:w-[5.75rem]">
            {seating.west && (
              <SidePlayer
                player={seating.west}
                cardCount={game.hands[seating.west.id]?.length ?? 0}
                isActive={game.turn.activePlayerId === seating.west.id}
                remainingSeconds={remainingSeconds}
                isPaused={isPaused}
                roleLabel="Opponent"
                stackOrientation="side"
                compact
              />
            )}
          </div>

          <section className="melds-grid min-h-0 w-full flex-1" aria-label="Team melds">
            {([leftTeam, rightTeam].filter((t): t is Team => t != null)).map((team, index) => {
              const isLocalSide = team.id === localTeam?.id
              const isRed = team.id === 'team-a'
              return (
                <div
                  key={team.id}
                  className={`felt-panel flex h-full min-h-0 flex-col gap-1 overflow-hidden p-1.5 sm:p-2.5 ${
                    isRed ? 'felt-panel-red' : 'felt-panel-blue'
                  }`}
                >
                  <div className="flex shrink-0 items-center justify-between gap-2 px-0.5">
                    <span className={`text-xs font-bold tracking-wide ${isRed ? 'text-red-200/90' : 'text-sky-200/90'}`}>
                      {isLocalSide ? `${team.name} (You)` : team.name}
                    </span>
                    <span className="text-[10px] text-white/40">
                      {team.melds.length === 0 ? 'Empty' : `${team.melds.length} meld${team.melds.length === 1 ? '' : 's'}`}
                    </span>
                  </div>
                  <div className="min-h-0 flex-1 overflow-hidden">
                    <MeldArea
                      team={team}
                      align={index === 0 ? 'left' : 'right'}
                      selectable={(isActionPhase || topTouchInProgress) && isLocalSide}
                      selectedMeldId={selectedMeldId}
                      onSelectMeld={(id) => selectMeldTarget(selectedMeldId === id ? null : id)}
                      canModify={isLocalTurn && isLocalSide}
                      onMoveWild={moveWildInMeld}
                    />
                  </div>
                </div>
              )
            })}
          </section>

          <div className="flex w-[3.75rem] shrink-0 flex-col items-center justify-center sm:w-[5.75rem]">
            {seating.east && (
              <SidePlayer
                player={seating.east}
                cardCount={game.hands[seating.east.id]?.length ?? 0}
                isActive={game.turn.activePlayerId === seating.east.id}
                remainingSeconds={remainingSeconds}
                isPaused={isPaused}
                roleLabel="Opponent"
                stackOrientation="side"
                compact
              />
            )}
          </div>
        </div>

        {/* Play hub — flat minimal strip */}
        <section className="play-hub relative mx-auto flex w-full max-w-5xl shrink-0 flex-col gap-1 px-2 py-1 sm:px-3 sm:py-1.5">
          <div className="flex w-full items-center justify-center">
            <TurnBanner
              playerName={activePlayer?.name ?? ''}
              phase={game.turn.phase}
              isLocalTurn={isLocalTurn}
              remainingSeconds={remainingSeconds}
              isPaused={isPaused}
              compact
            />
          </div>

          <div className="flex w-full items-end gap-2.5 sm:gap-3">
            <div className="flex shrink-0 flex-col items-center gap-0.5">
              <button
                ref={stockRef}
                type="button"
                disabled={!isDrawPhase || stockDepleted || topTouchInProgress}
                onClick={handleDrawFromStock}
                className="rounded-lg transition enabled:hover:-translate-y-0.5 enabled:focus-visible:outline enabled:focus-visible:outline-2 enabled:focus-visible:outline-offset-2 enabled:focus-visible:outline-yellow-300 disabled:opacity-45"
                title="Draw from stock"
                data-flip-anchor="stock"
                aria-label={`Draw from stock (${game.stock.length} cards)`}
              >
                <Card faceDown width={DISCARD_CARD_WIDTH} />
              </button>
              <span className="text-[10px] font-semibold text-white/55">Stock ({game.stock.length})</span>
            </div>

            <div
              className="flex min-w-0 flex-1 flex-col items-center gap-0.5"
              data-flip-anchor="discard"
            >
              <DiscardPileView
                cards={game.discardPile.cards.filter((c) => !meldedCardIds.has(c.id))}
                topCardInteractive={isDrawPhase && !topTouchInProgress}
                onTopCardClick={handleBeginTopTouch}
                topTouchInProgress={topTouchInProgress}
                selectedDiscardIds={selectedDiscardIds}
                onToggleDiscardCard={toggleDiscardPileCard}
              />
              <span className="text-[10px] font-semibold text-white/55">
                Discard ({game.discardPile.cards.length})
              </span>
            </div>

            <div
              key={feedback?.token ?? 'stable'}
              className={`action-stack ml-auto flex w-[6.5rem] shrink-0 flex-col items-stretch gap-1 self-center sm:w-[7.25rem] ${
                feedback ? 'animate-shake' : ''
              }`}
            >
              <button
                type="button"
                disabled={!canDiscard}
                onClick={discardSelected}
                className="action-btn action-btn-danger action-btn-stack"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={handleMeld}
                className="action-btn action-btn-blue action-btn-stack"
                title="Select hand cards (and optionally one of your team's melds above to append to or a natural card to swap in for a wild)"
              >
                {topTouchInProgress ? 'Meld Top' : 'Meld'}
              </button>
              <button
                type="button"
                disabled={!canDeclareShow}
                onClick={declareShow}
                className="action-btn action-btn-gold action-btn-stack"
                title={showUnmetReasons.length > 0 ? showUnmetReasons.join(' ') : 'Declare Show and end the round'}
              >
                Declare Show
              </button>
            </div>
          </div>

          {isDrawPhase && !topTouchInProgress && topDiscard && (
            <p className="mx-auto text-center text-[10px] leading-relaxed text-white/40">
              Tap top discard to Top Touch.
            </p>
          )}
          {topTouchInProgress && (
            <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-1.5 rounded-xl bg-amber-400/10 px-2.5 py-2 ring-1 ring-amber-300/30">
              <p className="text-center text-[11px] font-medium leading-relaxed text-amber-100">
                Top Touch — only the top card starts selected. Tap extra pile cards to include
                them in the meld. The rest of the pile still comes to your hand.
              </p>
              <button type="button" onClick={cancelTopTouch} className="action-btn action-btn-ghost !min-h-8 !text-[11px]">
                Cancel Top Touch
              </button>
            </div>
          )}

          {stockDepleted && isLocalTurn && (
            <button
              type="button"
              onClick={forceSuddenDeathEndRound}
              className="action-btn action-btn-danger mx-auto !min-h-9 !text-xs"
              title="Stock is empty. If you cannot Top Touch AND immediately empty your hand with a legal Show this turn, the round must end now."
            >
              Stock empty — End Round
            </button>
          )}

          {feedback && (
            <p className="mx-auto mt-0.5 w-full max-w-xl rounded-xl bg-red-900/35 px-4 py-2 text-center text-sm font-medium leading-snug text-red-50/90 ring-1 ring-red-300/25 backdrop-blur-sm sm:text-[14px]">
              {feedback.message}
            </p>
          )}
          {!feedback && showUnmetReasons.length > 0 && isActionPhase && (
            <p className="mx-auto max-w-xl text-center text-xs font-medium text-white/55">{showUnmetReasons.join(' ')}</p>
          )}
        </section>

        {/* SOUTH — hand always centered; avatar overlays the left */}
        <section className="relative flex w-full shrink-0 justify-center pb-0.5 pt-0">
          <div className="pointer-events-auto absolute bottom-1 left-0 z-20 flex flex-col items-center gap-1 pl-0.5 sm:left-1 sm:pl-0">
            <div className="flex items-center gap-2 rounded-full bg-black/35 px-2.5 py-1.5 ring-1 ring-white/10 backdrop-blur-sm">
              {seating.south && (
                <PlayerAvatar
                  name={seating.south.name}
                  color={seating.south.avatarColor}
                  connectionStatus={seating.south.connectionStatus}
                  size={40}
                />
              )}
              <p className="max-w-[4.5rem] truncate pr-0.5 text-sm font-semibold tracking-wide sm:max-w-[7rem]">
                {seating.south?.name}
              </p>
            </div>
            {isLocalTurn && remainingSeconds != null && (
              <TurnTimerBadge seconds={remainingSeconds} compact paused={isPaused} />
            )}
          </div>

          <div className="mx-auto flex w-full max-w-full items-end justify-center gap-2 px-1 sm:gap-2.5">
            <div
              ref={handRailRef}
              className="hand-rail min-w-0 justify-center overflow-visible"
              style={{ maxWidth: HAND_MAX_FAN_WIDTH }}
              data-flip-anchor={localPlayerId ? `hand-${localPlayerId}` : undefined}
              onPointerLeave={() => {
                if (!draggingId) setHoveredHandId(null)
              }}
            >
              <div className="relative mx-auto flex items-end justify-center" style={{ width: handFanWidth }}>
                {orderedLocalHand.map((card, i) => {
                  // Only the touched/dragged card enlarges — never neighbors swept during reorder.
                  const isActiveLift = draggingId === card.id || (!draggingId && hoveredHandId === card.id)
                  return (
                    <div
                      key={card.id}
                      onPointerDown={() => {
                        isReorderingRef.current = true
                        handleCardPointerDown(card.id)
                        setHoveredHandId(card.id)
                      }}
                      onPointerEnter={() => {
                        handleCardPointerEnter(card.id)
                        // While reordering, pointerenter fires on every card we swap past —
                        // do not treat those as hovered/enlarged.
                        if (!isReorderingRef.current) setHoveredHandId(card.id)
                      }}
                      className={`relative shrink-0 touch-none transition-opacity duration-150 ${
                        draggingId === card.id ? 'opacity-90' : ''
                      }`}
                      style={{
                        marginLeft: i === 0 ? 0 : -handOverlap,
                        zIndex: isActiveLift ? 80 : i,
                      }}
                    >
                      <AnimatedCard
                        flipId={card.id}
                        rank={card.rank}
                        suit={card.suit}
                        width={HAND_CARD_WIDTH}
                        selected={selectedCardIds.includes(card.id)}
                        isNew={isRecentlyAcquired(card.id)}
                        onClick={() => toggleSelectCard(card.id)}
                        className="hover:!translate-y-0"
                        wrapperClassName={`transition-transform duration-150 ease-out ${
                          isActiveLift ? '-translate-y-4 scale-110' : ''
                        }`}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="mb-1 shrink-0">
              <HandSortButtons
                activeMode={handSortMode}
                onSortSuit={handleSortHandBySuit}
                onSortRank={handleSortHandByRank}
              />
            </div>
          </div>

        </section>
      </div>

      {game.pendingSlide && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-yellow-300/40 bg-emerald-950 p-6 text-center shadow-2xl ring-1 ring-white/10">
            <h3 className="text-lg font-bold text-white">Replace the wild — choose an edge</h3>
            <p className="mt-2 text-sm leading-relaxed text-white/70">
              Your natural card takes the Joker/2&apos;s place. Where should the wild slide to?
            </p>
            <div className="mt-5 flex justify-center gap-3">
              <button type="button" onClick={() => resolveSlide('top')} className="action-btn action-btn-gold flex-1">
                Top edge
              </button>
              <button type="button" onClick={() => resolveSlide('bottom')} className="action-btn action-btn-ghost flex-1">
                Bottom edge
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
          onNewGame={startNewGame}
          onReturnToLobby={returnToLobby}
        />
      )}

      {!localPlayer && null}
    </div>
  )
}

function PozzettoActiveStatus({
  teams,
  localTeamId,
}: {
  teams: Team[]
  localTeamId: Team['id'] | undefined
}) {
  const lines = teams
    .filter((t) => t.pozzetto.claimed)
    .map((t) => ({
      id: t.id,
      text: t.id === localTeamId ? 'Pozzetto is active for us' : 'Pozzetto is active for them',
    }))
  if (lines.length === 0) return null
  return (
    <div className="pointer-events-auto flex max-w-[220px] flex-col items-end gap-1">
      {lines.map((line) => (
        <p
          key={line.id}
          className="rounded-md bg-black/45 px-2.5 py-1 text-right text-[11px] font-medium text-amber-100 ring-1 ring-amber-300/25"
        >
          {line.text}
        </p>
      ))}
    </div>
  )
}

function SidePlayer({
  player,
  cardCount,
  isActive = false,
  remainingSeconds = null,
  isPaused = false,
  highlight = false,
  roleLabel,
  stackOrientation,
  compact = false,
}: {
  player: Player
  cardCount: number
  isActive?: boolean
  remainingSeconds?: number | null
  isPaused?: boolean
  highlight?: boolean
  roleLabel: string
  stackOrientation: 'horizontal' | 'vertical' | 'side'
  compact?: boolean
}) {
  return (
    <div
      className={`flex transition-[box-shadow] duration-200 ${
        compact
          ? 'felt-panel w-full flex-col items-center gap-1.5 px-1.5 py-2 sm:px-2.5'
          : 'items-center gap-2.5 rounded-full bg-black/35 px-3 py-1.5 ring-1 ring-white/10 backdrop-blur-sm'
      } ${highlight && !compact ? 'ring-yellow-300/40' : ''} ${
        isActive ? 'ring-2 ring-yellow-300 shadow-[0_0_0_1px_rgba(250,204,21,0.25)]' : ''
      }`}
    >
      <PlayerAvatar
        name={player.name}
        color={player.avatarColor}
        connectionStatus={player.connectionStatus}
        size={compact ? 34 : 36}
      />
      <div className={`min-w-0 ${compact ? 'w-full text-center' : 'flex-1'}`}>
        <p className={`font-bold leading-tight text-white ${compact ? 'truncate text-[10px] sm:text-xs' : 'truncate text-xs'}`}>
          {player.name}
          {highlight && <span className="ml-1 text-[9px] font-semibold text-yellow-300/90">(bot)</span>}
        </p>
        {compact && (
          <p className="truncate text-[9px] text-white/45">
            {roleLabel}
            <span className="hidden sm:inline"> · Seat {player.seat + 1}</span>
          </p>
        )}
        {isActive && remainingSeconds != null && (
          <div className={`mt-1 ${compact ? 'flex justify-center' : ''}`}>
            <TurnTimerBadge seconds={remainingSeconds} compact paused={isPaused} />
          </div>
        )}
      </div>
      <MiniCardStack count={cardCount} flipAnchorId={`hand-${player.id}`} orientation={stackOrientation} />
    </div>
  )
}
