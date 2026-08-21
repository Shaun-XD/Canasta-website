import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
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
import { useIsHandheld } from '../lib/device'
import { evaluateShowEligibility, unmetShowConditions } from '../engine/showEligibility'
import type { CardModel, Player, Team } from '../types/game'
import { meldCards } from '../types/game'
import { planHandFan, scaledHandCardWidth } from './tableLayout'

const HAND_CARD_WIDTH = 78
const HAND_BASE_COUNT = 13
const HAND_COMFORT_PEEK = 48
const HAND_MIN_PEEK = 12
const HAND_REF_WIDTH = HAND_CARD_WIDTH + (HAND_BASE_COUNT - 1) * HAND_COMFORT_PEEK
const HAND_MAX_FAN_WIDTH = HAND_CARD_WIDTH + (HAND_BASE_COUNT - 1) * Math.round(HAND_COMFORT_PEEK * 1.5)
const HAND_CARD_ASPECT = 1.4

function fanSlotPlaceholderStyle(width: number, marginLeft: number): CSSProperties {
  return {
    width,
    height: Math.round(width * HAND_CARD_ASPECT),
    marginLeft,
    visibility: 'hidden',
    pointerEvents: 'none',
  }
}

function fanCardDragStyle(
  isDragging: boolean,
  dragPoint: { left: number; top: number } | null,
  width: number,
  marginLeft: number,
  zIndex: number,
): CSSProperties {
  if (isDragging && dragPoint) {
    return {
      position: 'fixed',
      left: dragPoint.left,
      top: dragPoint.top,
      width,
      margin: 0,
      zIndex: 500,
      transition: 'none',
      pointerEvents: 'none',
    }
  }
  return {
    marginLeft,
    zIndex,
    transition: isDragging ? 'none' : undefined,
  }
}

export function Table() {
  const handheld = useIsHandheld()
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
    if (!handheld) return
    const orientation = screen.orientation
    const lock = (
      orientation as ScreenOrientation & { lock?: (mode: string) => Promise<void> }
    ).lock
    if (lock) {
      void lock.call(orientation, 'landscape').catch(() => {
        /* Browser only allows this in an installed PWA or fullscreen. */
      })
    }
    return () => {
      try {
        orientation?.unlock()
      } catch {
        /* not locked */
      }
    }
  }, [handheld])

  // Item 3: the stock pile is rendered as one generic face-down card (not a
  // per-card element), so a freshly-drawn card has no prior on-screen rect
  // to fly FROM. We capture the stock pile's rect at click time and seed it
  // for the drawn card's id so the FLIP animation in `AnimatedCard` picks it
  // up as the origin once that card renders inside the hand.
  const stockRef = useRef<HTMLButtonElement>(null)
  const handRailRef = useRef<HTMLDivElement>(null)
  const [handRailWidth, setHandRailWidth] = useState(() =>
    typeof window === 'undefined' ? HAND_MAX_FAN_WIDTH : Math.max(HAND_REF_WIDTH, window.innerWidth - 32),
  )
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window === 'undefined' ? 800 : window.innerHeight,
  )
  const [menuOpen, setMenuOpen] = useState(false)
  const [hoveredHandId, setHoveredHandId] = useState<string | null>(null)
  /** Dismiss the score overlay to inspect the final table, then return. */
  const [reviewingTable, setReviewingTable] = useState(false)
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

  useEffect(() => {
    if (room?.status !== 'round-end' && room?.status !== 'game-end') {
      setReviewingTable(false)
    }
  }, [room?.status])

  useLayoutEffect(() => {
    const el = handRailRef.current
    if (!el) return
    const measure = () => {
      // Measure the full-width parent, not the fan itself — otherwise a
      // shrink-wrapped rail and the peek math fight each other into a tiny hand.
      const parent = el.parentElement
      const raw = parent?.clientWidth ?? el.clientWidth
      setHandRailWidth(handheld ? Math.max(0, raw - 16) : Math.max(HAND_REF_WIDTH, raw - 16))
      setViewportHeight(window.innerHeight)
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (el.parentElement) ro.observe(el.parentElement)
    ro.observe(el)
    return () => ro.disconnect()
  }, [handheld])

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
    dragPoint,
    handlePointerDown: handleCardPointerDown,
    handlePointerEnter: handleCardPointerEnter,
    applyOrder: applyHandOrder,
    consumeClickIfDragged,
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
  const liveGame = game
  const activePlayer = room.players.find((p) => p.id === liveGame.turn.activePlayerId)
  const topDiscard = liveGame.discardPile.cards[liveGame.discardPile.cards.length - 1]
  const roundOver = room.status === 'round-end' || room.status === 'game-end'
  const revealHands = roundOver

  function seatHand(playerId: string): CardModel[] {
    return (liveGame.hands[playerId] ?? []).filter((c) => !meldedCardIds.has(c.id))
  }

  const isDrawPhase = isLocalTurn && game.turn.phase === 'draw' && !roundOver
  const isActionPhase = isLocalTurn && game.turn.phase === 'action' && !roundOver
  const stockDepleted = game.stock.length === 0
  // Count only ids still in hand — stale ids from a prior online meld must not
  // block Discard while the UI only highlights the live card(s).
  const handIdSet = new Set(localHand.map((c) => c.id))
  const validSelectedCount = selectedCardIds.filter((id) => handIdSet.has(id)).length
  const canDiscard =
    !roundOver &&
    (isActionPhase || (isLocalTurn && game.turn.phase === 'discard')) &&
    validSelectedCount === 1

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
  // Stock and discard-pile faces share one size. On the phone dock they match
  // the 46px action buttons (width = height × 100/140).
  const hubCardWidth = handheld
    ? Math.round(46 * (100 / 140))
    : Math.round(
        Math.min(DISCARD_CARD_WIDTH, Math.max(viewportHeight <= 540 ? 30 : 48, handCardWidth * 0.82)),
      )
  const meldCardWidthCap = Math.max(32, Math.round(handCardWidth * 0.86))
  const discardFanMax = discardFanWidth(hubCardWidth, DISCARD_VISIBLE_CARDS)

  const desktopHandPeek = (() => {
    if (handCount <= 1) return HAND_CARD_WIDTH
    if (handCount < HAND_BASE_COUNT) {
      const spread = HAND_BASE_COUNT / handCount
      return Math.min(HAND_CARD_WIDTH - 4, Math.round(HAND_COMFORT_PEEK * spread))
    }
    const fitWidth = Math.min(HAND_REF_WIDTH, handRailWidth)
    return Math.max(HAND_MIN_PEEK, (fitWidth - HAND_CARD_WIDTH) / (handCount - 1))
  })()
  const desktopHandOverlap = HAND_CARD_WIDTH - desktopHandPeek
  const desktopHandFanWidth =
    handCount <= 1 ? HAND_CARD_WIDTH : HAND_CARD_WIDTH + (handCount - 1) * desktopHandPeek

  if (handheld) {
  return (
    <div className={`felt-bg table-shell table-shell-handheld relative flex flex-col text-white ${menuOpen ? 'table-menu-open' : ''}`}>
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
              cards={seatHand(seating.north.id)}
              revealHands={revealHands}
              isActive={game.turn.activePlayerId === seating.north.id}
              remainingSeconds={remainingSeconds}
              isPaused={isPaused}
              highlight
              roleLabel={room.players.length === 2 ? 'Opponent' : 'Teammate'}
              stackOrientation="horizontal"
              inHeader
              dense
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

      <div className="table-board relative mx-auto flex w-full max-w-[90rem] min-h-0 flex-1 flex-col gap-1 px-1.5 py-1 sm:gap-1.5 sm:px-3 sm:py-1.5">
        {/* WEST | MELDS (grow) | EAST — melds own the vertical space */}
        <div className="melds-row relative flex min-h-0 flex-[1_1_0] items-stretch gap-1 sm:gap-1.5">
          <div className={`side-seat side-seat-west flex shrink-0 flex-col items-center justify-center ${revealHands ? 'w-16 overflow-visible' : 'w-11'}`}>
            {seating.west && (
              <SidePlayer
                player={seating.west}
                cardCount={game.hands[seating.west.id]?.length ?? 0}
                cards={seatHand(seating.west.id)}
                revealHands={revealHands}
                isActive={game.turn.activePlayerId === seating.west.id}
                remainingSeconds={remainingSeconds}
                isPaused={isPaused}
                roleLabel="Opponent"
                stackOrientation="side"
                compact
                dense
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
                      selectable={(isActionPhase || topTouchInProgress) && isLocalSide && !roundOver}
                      selectedMeldId={selectedMeldId}
                      onSelectMeld={(id) => selectMeldTarget(selectedMeldId === id ? null : id)}
                      canModify={isLocalTurn && isLocalSide}
                      onMoveWild={moveWildInMeld}
                      maxCardWidth={meldCardWidthCap}
                      compact
                    />
                  </div>
                </div>
              )
            })}
          </section>

          <div className={`side-seat side-seat-east flex shrink-0 flex-col items-center justify-center ${revealHands ? 'w-16 overflow-visible' : 'w-11'}`}>
            {seating.east && (
              <SidePlayer
                player={seating.east}
                cardCount={game.hands[seating.east.id]?.length ?? 0}
                cards={seatHand(seating.east.id)}
                revealHands={revealHands}
                isActive={game.turn.activePlayerId === seating.east.id}
                remainingSeconds={remainingSeconds}
                isPaused={isPaused}
                roleLabel="Opponent"
                stackOrientation="side"
                compact
                dense
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
                    size={26}
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
                type="button"
                disabled={!canDiscard}
                onClick={discardSelected}
                className="play-dock-discard action-btn action-btn-danger action-btn-stack"
              >
                Discard
              </button>
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
                  compactWindow
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
                    const isDragging = draggingId === card.id
                    const isActiveLift = isDragging || (!draggingId && hoveredHandId === card.id)
                    const marginLeft = i === 0 ? 0 : -handOverlap
                    const zIndex = isDragging ? 220 : isActiveLift ? 80 : i
                    return (
                      <Fragment key={card.id}>
                        {isDragging && (
                          <div
                            className="relative shrink-0"
                            style={fanSlotPlaceholderStyle(handCardWidth, marginLeft)}
                            aria-hidden
                          />
                        )}
                        <div
                          data-hand-card-id={card.id}
                          onPointerDown={(e) => {
                            isReorderingRef.current = true
                            handleCardPointerDown(card.id, e)
                            setHoveredHandId(card.id)
                          }}
                          onPointerEnter={() => {
                            handleCardPointerEnter(card.id)
                            if (!isReorderingRef.current) setHoveredHandId(card.id)
                          }}
                          className={`relative shrink-0 touch-none ${isDragging ? 'opacity-95' : 'transition-opacity duration-150'}`}
                          style={fanCardDragStyle(isDragging, dragPoint, handCardWidth, marginLeft, zIndex)}
                        >
                          <AnimatedCard
                            flipId={card.id}
                            rank={card.rank}
                            suit={card.suit}
                            width={handCardWidth}
                            selected={selectedCardIds.includes(card.id)}
                            isNew={isRecentlyAcquired(card.id)}
                            onClick={() => {
                              if (consumeClickIfDragged()) return
                              toggleSelectCard(card.id)
                            }}
                            className="hover:!translate-y-0"
                            wrapperClassName={`transition-transform duration-150 ease-out ${
                              isActiveLift && !isDragging ? '-translate-y-2 scale-105' : ''
                            }`}
                          />
                        </div>
                      </Fragment>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="play-dock-tools">
              <div className="shrink-0 self-center">
                <HandSortButtons
                  activeMode={handSortMode}
                  onSortSuit={handleSortHandBySuit}
                  onSortRank={handleSortHandByRank}
                />
              </div>
              <div
                key={feedback?.token ?? 'stable'}
                className={`action-stack flex shrink-0 flex-row items-center gap-1 self-center ${
                  feedback ? 'animate-shake' : ''
                }`}
              >
                <button
                  type="button"
                  disabled={roundOver}
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

      {(room.status === 'round-end' || room.status === 'game-end') && !reviewingTable && (
        <RoundEndModal
          teams={room.teams}
          scores={game.lastRoundScores}
          matchTargetScore={room.matchTargetScore}
          gameOverTeamId={game.gameOverTeamId}
          onReviewTable={() => setReviewingTable(true)}
          onNewGame={startNewGame}
          onReturnToLobby={returnToLobby}
        />
      )}

      {reviewingTable && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[60] flex justify-center px-4">
          <button
            type="button"
            onClick={() => setReviewingTable(false)}
            className="pointer-events-auto min-h-12 rounded-full bg-yellow-400 px-6 py-3 text-sm font-bold text-emerald-950 shadow-lg ring-1 ring-black/10"
          >
            Back to scores
          </button>
        </div>
      )}

      {!localPlayer && null}
    </div>
    )
  }

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
        <div className="flex max-w-full shrink-0 justify-center overflow-x-auto">
          {seating.north && (
            <SidePlayer
              player={seating.north}
              cardCount={game.hands[seating.north.id]?.length ?? 0}
              cards={seatHand(seating.north.id)}
              revealHands={revealHands}
              isActive={game.turn.activePlayerId === seating.north.id}
              remainingSeconds={remainingSeconds}
              isPaused={isPaused}
              highlight
              roleLabel={room.players.length === 2 ? 'Opponent' : 'Teammate'}
              stackOrientation="horizontal"
            />
          )}
        </div>

        <div className="melds-row flex min-h-0 flex-[1_1_0] items-stretch gap-1.5 sm:gap-2">
          <div className={`flex shrink-0 flex-col items-center justify-center ${revealHands ? 'w-[4.5rem] overflow-visible sm:w-[6.5rem]' : 'w-[3.75rem] sm:w-[5.75rem]'}`}>
            {seating.west && (
              <SidePlayer
                player={seating.west}
                cardCount={game.hands[seating.west.id]?.length ?? 0}
                cards={seatHand(seating.west.id)}
                revealHands={revealHands}
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
                      selectable={(isActionPhase || topTouchInProgress) && isLocalSide && !roundOver}
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

          <div className={`flex shrink-0 flex-col items-center justify-center ${revealHands ? 'w-[4.5rem] overflow-visible sm:w-[6.5rem]' : 'w-[3.75rem] sm:w-[5.75rem]'}`}>
            {seating.east && (
              <SidePlayer
                player={seating.east}
                cardCount={game.hands[seating.east.id]?.length ?? 0}
                cards={seatHand(seating.east.id)}
                revealHands={revealHands}
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

          <div className="flex w-full items-end gap-2 sm:gap-3">
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

            <div className="flex min-w-0 flex-1 flex-col items-center gap-0.5" data-flip-anchor="discard">
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
              className={`action-stack ml-auto flex w-[4.75rem] shrink-0 flex-col items-stretch gap-2.5 self-center sm:w-[7.25rem] sm:gap-2 ${
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
                disabled={roundOver}
                onClick={handleMeld}
                className="action-btn action-btn-blue action-btn-stack"
                title={
                  topTouchInProgress
                    ? "Meld any legal combination of selected discard cards (top required) and hand cards - hand cards are optional - or add them onto one of your team's melds"
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
              <div className="relative mx-auto flex items-end justify-center" style={{ width: desktopHandFanWidth }}>
                {orderedLocalHand.map((card, i) => {
                  const isDragging = draggingId === card.id
                  const isActiveLift = isDragging || (!draggingId && hoveredHandId === card.id)
                  const marginLeft = i === 0 ? 0 : -desktopHandOverlap
                  const zIndex = isDragging ? 220 : isActiveLift ? 80 : i
                  return (
                    <Fragment key={card.id}>
                      {isDragging && (
                        <div
                          className="relative shrink-0"
                          style={fanSlotPlaceholderStyle(HAND_CARD_WIDTH, marginLeft)}
                          aria-hidden
                        />
                      )}
                      <div
                        data-hand-card-id={card.id}
                        onPointerDown={(e) => {
                          isReorderingRef.current = true
                          handleCardPointerDown(card.id, e)
                          setHoveredHandId(card.id)
                        }}
                        onPointerEnter={() => {
                          handleCardPointerEnter(card.id)
                          if (!isReorderingRef.current) setHoveredHandId(card.id)
                        }}
                        className={`relative shrink-0 touch-none ${isDragging ? 'opacity-95' : 'transition-opacity duration-150'}`}
                        style={fanCardDragStyle(isDragging, dragPoint, HAND_CARD_WIDTH, marginLeft, zIndex)}
                      >
                        <AnimatedCard
                          flipId={card.id}
                          rank={card.rank}
                          suit={card.suit}
                          width={HAND_CARD_WIDTH}
                          selected={selectedCardIds.includes(card.id)}
                          isNew={isRecentlyAcquired(card.id)}
                          onClick={() => {
                            if (consumeClickIfDragged()) return
                            toggleSelectCard(card.id)
                          }}
                          className="hover:!translate-y-0"
                          wrapperClassName={`transition-transform duration-150 ease-out ${
                            isActiveLift && !isDragging ? '-translate-y-4 scale-110' : ''
                          }`}
                        />
                      </div>
                    </Fragment>
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

      {(room.status === 'round-end' || room.status === 'game-end') && !reviewingTable && (
        <RoundEndModal
          teams={room.teams}
          scores={game.lastRoundScores}
          matchTargetScore={room.matchTargetScore}
          gameOverTeamId={game.gameOverTeamId}
          onReviewTable={() => setReviewingTable(true)}
          onNewGame={startNewGame}
          onReturnToLobby={returnToLobby}
        />
      )}

      {reviewingTable && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[60] flex justify-center px-4">
          <button
            type="button"
            onClick={() => setReviewingTable(false)}
            className="pointer-events-auto min-h-12 rounded-full bg-yellow-400 px-6 py-3 text-sm font-bold text-emerald-950 shadow-lg ring-1 ring-black/10"
          >
            Back to scores
          </button>
        </div>
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
  cards,
  revealHands = false,
  isActive = false,
  remainingSeconds = null,
  isPaused = false,
  highlight = false,
  roleLabel,
  stackOrientation,
  compact = false,
  inHeader = false,
  dense = false,
}: {
  player: Player
  cardCount: number
  cards?: CardModel[]
  revealHands?: boolean
  isActive?: boolean
  remainingSeconds?: number | null
  isPaused?: boolean
  highlight?: boolean
  roleLabel: string
  stackOrientation: 'horizontal' | 'vertical' | 'side'
  compact?: boolean
  inHeader?: boolean
  dense?: boolean
}) {
  return (
    <div
      className={`flex transition-[box-shadow] duration-200 ${
        inHeader
          ? revealHands
            ? 'north-header items-center gap-1 overflow-visible rounded-2xl bg-black/30 px-1.5 py-0.5 ring-1 ring-white/10'
            : 'north-header items-center gap-1 rounded-full bg-black/30 px-1.5 py-0.5 ring-1 ring-white/10'
          : compact && dense
            ? 'felt-panel side-player w-full flex-col items-center gap-0.5 overflow-visible px-1 py-1'
            : compact
              ? 'felt-panel w-full flex-col items-center gap-1.5 overflow-visible px-1.5 py-2 sm:px-2.5'
              : revealHands
                ? 'items-center gap-2.5 overflow-visible rounded-2xl bg-black/35 px-3 py-2 ring-1 ring-white/10 backdrop-blur-sm'
                : 'items-center gap-2.5 rounded-full bg-black/35 px-3 py-1.5 ring-1 ring-white/10 backdrop-blur-sm'
      } ${highlight && !compact && !inHeader ? 'ring-yellow-300/40' : ''} ${
        isActive && !revealHands ? 'ring-2 ring-yellow-300 shadow-[0_0_0_1px_rgba(250,204,21,0.25)]' : ''
      }`}
    >
      <PlayerAvatar
        name={player.name}
        color={player.avatarColor}
        connectionStatus={player.connectionStatus}
        size={inHeader || dense ? 22 : compact ? 34 : 36}
      />
      {!inHeader && (
        <div className={`side-player-meta min-w-0 ${compact ? 'w-full text-center' : 'flex-1'}`}>
          <p className={`font-bold leading-tight text-white ${dense ? 'truncate text-[9px]' : compact ? 'truncate text-[10px] sm:text-xs' : 'truncate text-xs'}`}>
            {player.name}
            {highlight && <span className="ml-1 text-[9px] font-semibold text-yellow-300/90">(bot)</span>}
          </p>
          {compact && (
            <p className={`truncate text-white/45 ${dense ? 'text-[8px]' : 'text-[9px]'}`}>
              {roleLabel}
              {!dense && <span className="hidden sm:inline"> · Seat {player.seat + 1}</span>}
            </p>
          )}
          {isActive && remainingSeconds != null && (
            <div className={`mt-1 ${compact ? 'flex justify-center' : ''}`}>
              <TurnTimerBadge seconds={remainingSeconds} compact paused={isPaused} />
            </div>
          )}
        </div>
      )}
      <MiniCardStack
        count={cardCount}
        cards={revealHands ? cards : undefined}
        faceUp={revealHands}
        flipAnchorId={`hand-${player.id}`}
        orientation={stackOrientation}
        dense={dense}
      />
    </div>
  )
}
