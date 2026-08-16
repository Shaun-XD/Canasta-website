import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import { PlayerAvatar } from '../components/PlayerAvatar'
import { MiniCardStack } from '../components/MiniCardStack'
import { Card } from '../components/Card'
import { AnimatedCard } from '../components/AnimatedCard'
import { DiscardPileView, DISCARD_CARD_WIDTH, DISCARD_VISIBLE_CARDS, discardFanWidth } from '../components/DiscardPileView'
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
import { planHandFan, scaledHandCardWidth } from './tableLayout'

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

  useEffect(() => {
    const orientation = screen.orientation
    void orientation?.lock('landscape').catch(() => {
      /* Browser only allows this in an installed PWA or fullscreen. */
    })
    return () => {
      try {
        orientation?.unlock()
      } catch {
        /* not locked */
      }
    }
  }, [])

  // Item 3: the stock pile is rendered as one generic face-down card (not a
  // per-card element), so a freshly-drawn card has no prior on-screen rect
  // to fly FROM. We capture the stock pile's rect at click time and seed it
  // for the drawn card's id so the FLIP animation in `AnimatedCard` picks it
  // up as the origin once that card renders inside the hand.
  const stockRef = useRef<HTMLButtonElement>(null)
  const handRailRef = useRef<HTMLDivElement>(null)
  const [handRailWidth, setHandRailWidth] = useState(() =>
    typeof window === 'undefined' ? 360 : Math.max(280, window.innerWidth - 32),
  )
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window === 'undefined' ? 800 : window.innerHeight,
  )
  const [menuOpen, setMenuOpen] = useState(false)
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
    if (!menuOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [menuOpen])

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
      setHandRailWidth(Math.max(0, raw - 16))
      setViewportHeight(window.innerHeight)
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
      const discardCount = selectedDiscardIds.length
      // Hand cards are optional. A legal new meld can be entirely from the
      // discard pile (3+ including the top card), mixed with the hand, or
      // appended onto an existing team meld.
      if (!selectedMeldId && validSelectedCount + discardCount < 3) {
        return reportInvalidAction(
          'Select a legal meld: at least 3 cards from the discard pile and/or your hand (the top discard is required), or choose an existing meld to add onto.',
        )
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

  const handCount = orderedLocalHand.length
  const handCardWidth = scaledHandCardWidth(handRailWidth, viewportHeight)
  const handFan = planHandFan(handCount, handRailWidth, handCardWidth)
  const handPeek = handFan.peek
  const handOverlap = handCardWidth - handPeek
  const handFanWidth = handFan.fanWidth
  const hubCardWidth = Math.round(
    Math.min(DISCARD_CARD_WIDTH, Math.max(viewportHeight <= 540 ? 30 : 48, handCardWidth * 0.82)),
  )
  const meldCardWidthCap = Math.max(32, Math.round(handCardWidth * 0.86))
  const discardFanMax = discardFanWidth(hubCardWidth, DISCARD_VISIBLE_CARDS)

  return (
    <div className={`felt-bg table-shell relative flex flex-col text-white ${menuOpen ? 'table-menu-open' : ''}`}>
      <div className="rotate-landscape-gate" role="dialog" aria-label="Rotate to landscape">
        <div className="rotate-landscape-card">
          <p className="text-lg font-bold text-white">Rotate your phone</p>
          <p className="mt-1 text-sm text-white/70">Canasta is played in landscape.</p>
        </div>
      </div>

      {menuOpen && (
        <button
          type="button"
          className="table-menu-scrim"
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <header className="table-topbar shrink-0">
        <p className="table-topbar-room min-w-0 truncate text-xs font-semibold tracking-wide text-white/85">
          <span className="font-mono text-yellow-300">{room.roomId}</span>
        </p>

        <div className="table-topbar-north flex min-w-0 justify-center">
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
              inHeader
            />
          )}
        </div>

        <div className="table-topbar-end flex shrink-0 items-center gap-1.5">
          <PozzettoStacks
            compact
            teams={room.teams}
            localTeamId={localTeam?.id}
            stackCounts={{
              'team-a': game.pozzettoStacks['team-a']?.length ?? 0,
              'team-b': game.pozzettoStacks['team-b']?.length ?? 0,
            }}
          />
          <button
              type="button"
              className="table-menu-btn"
              aria-label={menuOpen ? 'Close table menu' : 'Open table menu'}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span />
              <span />
              <span />
            </button>
        </div>
      </header>

      {menuOpen && (
        <div className="table-menu-panel" role="dialog" aria-modal="true" aria-label="Table menu">
          <p className="table-menu-kicker">Room {room.roomId}</p>
          <p className="px-4 pb-2 text-[12px] text-white/60">
            Round {game.round} · {room.matchTargetScore} pts ·{' '}
            {timerEnabled ? `${room.turnTimerSeconds}s` : 'No timer'}
          </p>
          {timerEnabled && (
            <button
              type="button"
              onClick={() => {
                togglePauseTimer()
                setMenuOpen(false)
              }}
            >
              {isPaused ? 'Resume timer' : 'Pause timer'}
            </button>
          )}
          <button
            type="button"
            className="table-menu-exit"
            onClick={() => {
              setMenuOpen(false)
              exitToHome()
            }}
          >
            Exit
          </button>
        </div>
      )}

      <div className="relative mx-auto flex w-full max-w-[90rem] min-h-0 flex-1 flex-col gap-1 px-1.5 py-1 sm:gap-1.5 sm:px-3 sm:py-1.5">
        {/* WEST | MELDS (grow) | EAST — melds own the vertical space */}
        <div className="melds-row relative flex min-h-0 flex-[1_1_0] items-stretch gap-1 sm:gap-1.5">
          <div className="side-seat side-seat-west flex w-11 shrink-0 flex-col items-center justify-center">
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
                      maxCardWidth={meldCardWidthCap}
                    />
                  </div>
                </div>
              )
            })}
          </section>

          <div className="side-seat side-seat-east flex w-11 shrink-0 flex-col items-center justify-center">
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

        {/* Play dock — landscape: stock | discard | hand | sort | actions */}
        <section className="play-hub play-dock relative mx-auto w-full max-w-[90rem] shrink-0 px-2 py-1 sm:px-3 sm:py-1.5">
          <div className="play-dock-banner">
            <TurnBanner
              playerName={activePlayer?.name ?? ''}
              phase={game.turn.phase}
              isLocalTurn={isLocalTurn}
              remainingSeconds={remainingSeconds}
              isPaused={isPaused}
              compact
            />
          </div>

          <div className="play-dock-row">
            <div className="play-dock-local">
              <div className="flex items-center gap-1.5 rounded-full bg-black/35 px-2 py-1 ring-1 ring-white/10 backdrop-blur-sm">
                {seating.south && (
                  <PlayerAvatar
                    name={seating.south.name}
                    color={seating.south.avatarColor}
                    connectionStatus={seating.south.connectionStatus}
                    size={36}
                  />
                )}
                <p className="play-dock-local-name max-w-[4.5rem] truncate pr-0.5 text-sm font-semibold tracking-wide sm:max-w-[7rem]">
                  {seating.south?.name}
                </p>
              </div>
              {isLocalTurn && remainingSeconds != null && (
                <TurnTimerBadge seconds={remainingSeconds} compact paused={isPaused} />
              )}
            </div>

            <div className="play-dock-piles">
              <button
                ref={stockRef}
                type="button"
                disabled={!isDrawPhase || stockDepleted || topTouchInProgress}
                onClick={handleDrawFromStock}
                className="stock-btn transition enabled:hover:-translate-y-0.5 enabled:focus-visible:outline enabled:focus-visible:outline-2 enabled:focus-visible:outline-offset-2 enabled:focus-visible:outline-yellow-300 disabled:opacity-45"
                title="Draw from stock"
                data-flip-anchor="stock"
                aria-label={`Draw from stock (${game.stock.length} cards)`}
              >
                <Card faceDown width={hubCardWidth} />
              </button>

              <div className="discard-slot shrink-0" data-flip-anchor="discard">
                <DiscardPileView
                  cards={game.discardPile.cards.filter((c) => !meldedCardIds.has(c.id))}
                  cardWidth={hubCardWidth}
                  maxWidth={discardFanMax}
                  showBadge={false}
                  topCardInteractive={isDrawPhase && !topTouchInProgress}
                  onTopCardClick={handleBeginTopTouch}
                  topTouchInProgress={topTouchInProgress}
                  selectedDiscardIds={selectedDiscardIds}
                  onToggleDiscardCard={toggleDiscardPileCard}
                />
              </div>
            </div>

            <div className="play-dock-hand min-w-0">
              <div
                ref={handRailRef}
                className={`hand-rail min-w-0 justify-center ${
                  handFan.swipe ? 'hand-rail-swipe overflow-x-auto overflow-y-visible' : 'overflow-visible'
                }`}
                style={{ maxWidth: '100%' }}
                data-flip-anchor={localPlayerId ? `hand-${localPlayerId}` : undefined}
                onPointerLeave={() => {
                  if (!draggingId) setHoveredHandId(null)
                }}
              >
                <div className="relative mx-auto flex items-end justify-center" style={{ width: handFanWidth }}>
                  {orderedLocalHand.map((card, i) => {
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
                          width={handCardWidth}
                          selected={selectedCardIds.includes(card.id)}
                          isNew={isRecentlyAcquired(card.id)}
                          onClick={() => toggleSelectCard(card.id)}
                          className="hover:!translate-y-0"
                          wrapperClassName={`transition-transform duration-150 ease-out ${
                            isActiveLift ? '-translate-y-2 scale-105' : ''
                          }`}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="play-dock-tools">
              <div className="mb-0.5 shrink-0">
                <HandSortButtons
                  activeMode={handSortMode}
                  onSortSuit={handleSortHandBySuit}
                  onSortRank={handleSortHandByRank}
                />
              </div>
              <div
                key={feedback?.token ?? 'stable'}
                className={`action-stack flex w-[3.4rem] shrink-0 flex-col items-stretch gap-1 self-end ${
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
                  title={
                    topTouchInProgress
                      ? 'Meld any legal combination of selected discard cards (top required) and hand cards - hand cards are optional - or add them onto one of your team\'s melds'
                      : "Select hand cards (and optionally one of your team's melds above to append to or a natural card to swap in for a wild)"
                  }
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
                  Show
                </button>
              </div>
            </div>
          </div>

          <div className="play-dock-help">
            {topTouchInProgress && (
              <button type="button" onClick={cancelTopTouch} className="action-btn action-btn-ghost mx-auto !min-h-8 !text-[11px]">
                Cancel
              </button>
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
  inHeader = false,
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
  inHeader?: boolean
}) {
  return (
    <div
      className={`flex transition-[box-shadow] duration-200 ${
        inHeader
          ? 'north-header items-center gap-1 rounded-full bg-black/30 px-1.5 py-0.5 ring-1 ring-white/10'
          : compact
            ? 'felt-panel side-player w-full flex-col items-center gap-0.5 px-1 py-1'
            : 'items-center gap-2.5 rounded-full bg-black/35 px-3 py-1.5 ring-1 ring-white/10 backdrop-blur-sm'
      } ${highlight && !compact && !inHeader ? 'ring-yellow-300/40' : ''} ${
        isActive ? 'ring-2 ring-yellow-300 shadow-[0_0_0_1px_rgba(250,204,21,0.25)]' : ''
      }`}
    >
      <PlayerAvatar
        name={player.name}
        color={player.avatarColor}
        connectionStatus={player.connectionStatus}
        size={inHeader || compact ? 22 : 36}
      />
      {!inHeader && (
        <div className={`side-player-meta min-w-0 ${compact ? 'w-full text-center' : 'flex-1'}`}>
          <p className={`font-bold leading-tight text-white ${compact ? 'truncate text-[9px]' : 'truncate text-xs'}`}>
            {player.name}
            {highlight && <span className="ml-1 text-[9px] font-semibold text-yellow-300/90">(bot)</span>}
          </p>
          {compact && (
            <p className="truncate text-[8px] text-white/45">
              {roleLabel}
            </p>
          )}
          {isActive && remainingSeconds != null && (
            <div className={`mt-1 ${compact ? 'flex justify-center' : ''}`}>
              <TurnTimerBadge seconds={remainingSeconds} compact paused={isPaused} />
            </div>
          )}
        </div>
      )}
      <MiniCardStack count={cardCount} flipAnchorId={`hand-${player.id}`} orientation={stackOrientation} />
    </div>
  )
}
