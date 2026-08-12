import { create } from 'zustand'
import type {
  CardModel,
  GameState,
  Player,
  PlayerId,
  RoomState,
  Team,
  TeamId,
} from '../types/game'
import { DEFAULT_TARGET_SCORE, DEFAULT_TURN_TIMER_SECONDS, normalizeTurnTimerSeconds, normalizeMaxPlayers, seatsPerTeam, type MaxPlayers } from '../types/game'
import { buildShuffledDeck, dealHands, sortHand } from '../lib/deck'
import { seedRemotePlayerFlights } from '../lib/seedRemoteFlights'
import { initialPozzettoState, shouldClaimPozzettoOnDiscard, shouldClaimPozzettoOnMeldEmpty } from '../engine/pozzetto'
import { evaluateShowEligibility } from '../engine/showEligibility'
import { EMPTY_HAND_FOUL_PENALTY, isIllegalEmptyHand } from '../engine/emptyHandFoul'
import { scoreRound } from '../engine/scoring'
import {
  appendCardFromHand,
  attemptMeldAction,
  createMeldFromHand,
  getNextPlayerId,
  performDiscard,
  performDrawFromStock,
  topDiscardMustBePlayed,
} from '../engine/turnEngine'
import { moveWildInMeld as moveWildInMeldEngine } from '../engine/meldValidation'
import {
  actionRetainFloor,
  planAiAppends,
  planAiDraw,
  planAiMelds,
  pickAiDiscard,
  type AiPlayContext,
} from '../engine/aiPlayer'
import {
  BOT_FLIP_DURATION_MS,
  getFlipAnchorRect,
  playDetachedCardFlight,
  playPozzettoClaimFlights,
  seedFlipOriginFromAnchor,
  seedFlipOriginIfUnknown,
} from '../hooks/useCardFlip'
import {
  bindSocketStoreHandlers,
  disconnectSocket,
  socketAttemptMeld,
  socketAutoEndTurn,
  socketCreateRoom,
  socketDeclareShow,
  socketDiscard,
  socketDraw,
  socketForceSuddenDeath,
  socketJoinRoom,
  socketMoveWild,
  socketNextRound,
  socketResolveSlide,
  socketReturnToLobby,
  socketRejoinRoom,
  socketSetReady,
  socketSetMaxPlayers,
  socketSetTarget,
  socketSetTeam,
  socketSetTimer,
  socketStartGame,
  socketStartNewGame,
  socketTogglePause,
  type RoomAck,
} from '../lib/socket'

export type PlayMode = 'solo' | 'online'

const ONLINE_SESSION_KEY = 'canasta.onlineSession'

const EMPTY_SELECTION = {
  selectedCardIds: [] as string[],
  selectedMeldId: null as string | null,
  topTouchInProgress: false,
  selectedDiscardIds: [] as string[],
}

async function runOnlineAction(
  get: () => GameStoreState,
  set: (partial: Partial<GameStoreState>) => void,
  run: () => Promise<RoomAck>,
  failMessage: string,
): Promise<boolean> {
  try {
    let ack = await run()
    // Only re-bind + retry when the socket lost its room mapping. Never retry
    // on timeout — the action may already have succeeded (e.g. stock draw),
    // and a second draw fails with "Already drew this turn".
    if (!ack.ok && (ack.error || '').toLowerCase().includes('not in a room')) {
      const rejoined = await get().actions.rejoinOnlineSession()
      if (rejoined) ack = await run()
    }
    if (!ack.ok) {
      set({ lastActionError: ack.error || failMessage })
      return false
    }
    // Prefer the ack payload so stock draw (and other actions) update even if
    // the async lobby broadcast is delayed or the ack races ahead of it.
    if (ack.game !== undefined || ack.room) {
      applyOnlineSnapshot({
        set,
        get,
        room: ack.room,
        game: ack.game === undefined ? undefined : ack.game,
        playerId: ack.playerId,
      })
    }
    return true
  } catch (err) {
    set({ lastActionError: err instanceof Error ? err.message : failMessage })
    return false
  }
}

function persistOnlineSession(roomId: string, playerId: string) {
  try {
    localStorage.setItem(ONLINE_SESSION_KEY, JSON.stringify({ roomId, playerId }))
  } catch {
    /* ignore */
  }
}

function clearOnlineSession() {
  try {
    localStorage.removeItem(ONLINE_SESSION_KEY)
  } catch {
    /* ignore */
  }
}

let onlineSyncBound = false
/** Room:state held until the matching game:state so meld/hand FLIP stays coherent. */
let pendingOnlineRoom: RoomState | null = null

function normalizeOnlineRoom(room: RoomState): RoomState {
  return { ...room, maxPlayers: normalizeMaxPlayers(room.maxPlayers) }
}

/**
 * Apply an online room/game snapshot (from socket push or action ack).
 * Seeds stock-draw FLIP origins and remote seat flights before React commits.
 */
function applyOnlineSnapshot(opts: {
  set: (partial: Partial<GameStoreState>) => void
  get: () => GameStoreState
  room?: RoomState | null
  game?: GameState | null
  playerId?: string
}): void {
  const { set, get, playerId } = opts
  const prev = get()
  const localId = playerId || prev.localPlayerId

  let room: RoomState | null | undefined = opts.room
  if (room) {
    room = normalizeOnlineRoom(room)
  } else if (opts.game !== undefined) {
    room = pendingOnlineRoom ?? prev.room
    pendingOnlineRoom = null
  }

  if (opts.game === undefined) {
    if (room) set({ room, ...(playerId ? { localPlayerId: playerId } : {}), playMode: 'online' })
    return
  }

  const game = opts.game
  if (!game) {
    set({
      ...(room ? { room } : {}),
      game: null,
      ...(playerId ? { localPlayerId: playerId } : {}),
      playMode: 'online',
      ...EMPTY_SELECTION,
    })
    return
  }

  // Skip no-op re-applies (ack + broadcast of the same state).
  if (
    prev.game &&
    prev.game.turn.turnNumber === game.turn.turnNumber &&
    prev.game.turn.phase === game.turn.phase &&
    prev.game.turn.activePlayerId === game.turn.activePlayerId &&
    prev.game.lastPlay?.at === game.lastPlay?.at &&
    prev.game.lastAcquired?.at === game.lastAcquired?.at &&
    (prev.game.hands[localId ?? '']?.length ?? 0) === (game.hands[localId ?? '']?.length ?? 0) &&
    prev.game.stock.length === game.stock.length &&
    prev.game.discardPile.cards.length === game.discardPile.cards.length
  ) {
    if (room && room !== prev.room) {
      set({ room, playMode: 'online', ...(playerId ? { localPlayerId: playerId } : {}) })
    }
    return
  }

  // Stock is a generic face-down card (no per-id AnimatedCard). Seed the
  // drawn card's origin from the stock pile BEFORE React mounts it in the
  // hand — online draw is async so Table cannot seed at click time.
  if (
    game.lastAcquired &&
    game.lastAcquired.at !== prev.game?.lastAcquired?.at &&
    game.lastAcquired.playerId === localId
  ) {
    const stockRect = getFlipAnchorRect('stock')
    if (stockRect) {
      for (const id of game.lastAcquired.cardIds) {
        seedFlipOriginIfUnknown(id, stockRect)
      }
    }
  }

  if (prev.game) {
    seedRemotePlayerFlights({
      prevGame: prev.game,
      prevRoom: prev.room,
      nextGame: game,
      nextRoom: room ?? prev.room,
      localPlayerId: localId,
    })
  }

  const handIds = new Set(localId ? (game.hands[localId] ?? []).map((c) => c.id) : [])
  const localTeam = (room ?? prev.room)?.teams.find((t) => localId && t.playerIds.includes(localId))
  const meldStillExists = !!(
    prev.selectedMeldId && localTeam?.melds.some((m) => m.id === prev.selectedMeldId)
  )
  const turnChanged =
    !!prev.game &&
    (game.turn.activePlayerId !== prev.game.turn.activePlayerId ||
      game.turn.phase !== prev.game.turn.phase ||
      game.turn.turnNumber !== prev.game.turn.turnNumber)

  const prunedSelected = turnChanged ? [] : prev.selectedCardIds.filter((id) => handIds.has(id))
  const clearTopTouch = turnChanged || game.turn.phase !== 'draw'

  set({
    ...(room ? { room } : {}),
    game,
    playMode: 'online',
    ...(playerId ? { localPlayerId: playerId } : {}),
    selectedCardIds: prunedSelected,
    selectedMeldId: turnChanged || !meldStillExists ? null : prev.selectedMeldId,
    ...(turnChanged || clearTopTouch ? { topTouchInProgress: false, selectedDiscardIds: [] } : {}),
  })
}

/** Per-action pacing for mock/bot turns — longer than the slow bot flight. */
const BOT_ACTION_MS = 1400
/** Extra pause after a bot finishes its turn, before the next bot (or human) acts. */
const BOT_BETWEEN_TURNS_MS = 600

const botFlip = { slow: true } as const
function botDetachedFlight(opts: Parameters<typeof playDetachedCardFlight>[0]) {
  return playDetachedCardFlight({ ...opts, durationMs: BOT_FLIP_DURATION_MS })
}

/** Bumped whenever a new game/round starts so in-flight bot timeouts abort cleanly. */
let botTurnGeneration = 0

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Waits `ms`, but also yields while the turn timer is paused so bot pacing
 * freezes alongside the human-visible pause state.
 */
async function sleepRespectingPause(ms: number, isCancelled: () => boolean): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < ms) {
    if (isCancelled()) return
    const paused = useGameStore.getState().game?.turn.isPaused ?? false
    if (paused) {
      await sleep(50)
      continue
    }
    const remaining = ms - (Date.now() - started)
    await sleep(Math.min(50, Math.max(0, remaining)))
  }
}

/**
 * The Rajasthani Canasta rules engine store.
 *
 * All state mutation now flows through the pure functions in `src/engine/`
 * (see meldValidation.ts, turnEngine.ts, pozzetto.ts, showEligibility.ts,
 * scoring.ts). This store is the ONLY place that mutates room/game state on
 * the client - it composes engine calls and calls `set(...)`. Once a real
 * server-authoritative engine exists, the intended integration path is to
 * replace the body of these actions with `socket.emit(...)` calls (see
 * `src/lib/socket.ts`) and have incoming server events call `set(...)` here
 * instead - the React components should not need to change.
 */

const HAND_SIZE = 13 // section 1: deal 13 cards to each player's hand
const POZZETTO_SIZE = 11 // section 1: two 11-card reserve stacks, one per team
/**
 * Clockwise seats after the local player (seat 0, team-a):
 *   1 = left-hand opponent, 2 = partner (opposite), 3 = right-hand opponent.
 * Turn order is therefore: Me → Opponent → Teammate → Opponent #2.
 */
const MOCK_SEATS: { name: string; teamId: TeamId }[] = [
  { name: 'Opponent (bot)', teamId: 'team-b' },
  { name: 'Teammate (bot)', teamId: 'team-a' },
  { name: 'Opponent #2 (bot)', teamId: 'team-b' },
]

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

function makeRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 5; i += 1) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

const AVATAR_COLORS = ['#ef4444', '#3b82f6', '#eab308', '#22c55e', '#a855f7', '#ec4899']

function makeMockPlayers(botCount: number): Player[] {
  return MOCK_SEATS.slice(0, Math.max(0, botCount)).map((seat, i) => ({
    id: randomId('mock'),
    name: seat.name,
    teamId: seat.teamId,
    seat: i + 1,
    isReady: true,
    isLocal: false,
    isMock: true,
    connectionStatus: 'connected',
    avatarColor: AVATAR_COLORS[(i + 1) % AVATAR_COLORS.length],
  }))
}

function makeTeams(players: Player[]): Team[] {
  const teamIds: TeamId[] = ['team-a', 'team-b']
  return teamIds.map((id) => ({
    id,
    name: id === 'team-a' ? 'Team Red' : 'Team Blue',
    playerIds: players.filter((p) => p.teamId === id).map((p) => p.id),
    melds: [],
    score: 0,
    hasGoneOut: false,
    pozzetto: initialPozzettoState(),
  }))
}

interface GameStoreState {
  room: RoomState | null
  game: GameState | null
  localPlayerId: PlayerId | null
  /** solo = local bots; online = FastAPI realtime backend */
  playMode: PlayMode
  selectedCardIds: string[]
  selectedMeldId: string | null
  /**
   * True while the player has initiated a Top Touch (tapped the top discard
   * card during their draw phase) but has not yet confirmed a meld
   * combination with it. See item 5: the rest of the discard pile is only
   * granted to the player's hand once a legal meld with the top card
   * actually succeeds - nothing is taken up front.
   */
  topTouchInProgress: boolean
  /**
   * While `topTouchInProgress`, ids of discard-pile cards included as meld
   * candidates. Always includes the top card (mandatory); other pile cards
   * can be toggled individually. Empty when no Top Touch is in progress.
   */
  selectedDiscardIds: string[]
  lastActionError: string | null
  actions: {
    /** Solo demo with bots (local-only, no server). */
    createRoom: (
      playerName: string,
      targetScore?: number,
      turnTimerSeconds?: number,
      maxPlayers?: MaxPlayers,
    ) => string
    joinRoom: (roomId: string, playerName: string) => void
    /** Online multiplayer via FastAPI Socket.IO backend. */
    createRoomOnline: (
      playerName: string,
      targetScore?: number,
      turnTimerSeconds?: number,
      maxPlayers?: MaxPlayers,
    ) => Promise<string>
    joinRoomOnline: (roomId: string, playerName: string) => Promise<void>
    rejoinOnlineSession: () => Promise<boolean>
    setLocalTeam: (teamId: TeamId) => void
    setLocalSeat: (seat: number) => void
    toggleReady: () => void
    setMatchTargetScore: (score: number) => void
    setTurnTimerSeconds: (seconds: number) => void
    /** Host: set lobby size to 2 (1v1) or 4 (2v2). */
    setMaxPlayers: (maxPlayers: MaxPlayers) => void
    startGame: () => void
    toggleSelectCard: (cardId: string) => void
    clearSelection: () => void
    selectMeldTarget: (meldId: string | null) => void
    drawFromStock: () => void
    /** Enters "propose a meld with the top discard card" mode (item 5, phase 1). */
    beginTopTouch: () => void
    /** Backs out of Top Touch mode without taking anything from the discard pile. */
    cancelTopTouch: () => void
    /**
     * While a Top Touch is in progress, toggles whether discard pile card
     * `cardId` is included in the meld candidate set. The top card itself
     * can never be excluded; other cards toggle independently.
     */
    toggleDiscardPileCard: (cardId: string) => void
    /**
     * The single unified meld action (item 3) behind the "Meld" button.
     * Uses the current hand-card selection + targeted meld group (and, if
     * `topTouchInProgress`, the selected discard cards) to either append to
     * the targeted meld or auto-detect + create a brand-new Set/Sequence.
     */
    attemptMeld: () => void
    /** Item 7: toggles a Set's single edge-positioned wild card between front/back. */
    moveWildInMeld: (meldId: string) => void
    resolveSlide: (edge: 'top' | 'bottom') => void
    discardSelected: () => void
    declareShow: () => void
    forceSuddenDeathEndRound: () => void
    /** Called when the local player's turn timer expires with no action taken; auto-discards and advances the turn. */
    autoEndTurn: () => void
    /** Pauses (freezing, not resetting) or resumes the active turn timer for everyone at the table. */
    togglePauseTimer: () => void
    /**
     * Starts a brand-new match at the table: scores → 0, melds cleared,
     * fresh deal, round 1. Stays on the game screen (does not return to lobby).
     */
    startNewGame: () => void
    /** Advance to the next round after round-end (online + solo). */
    startNextRound: () => void
    /** Leaves the table and returns the room to lobby status (game state cleared). */
    returnToLobby: () => void
    /**
     * Full exit: wipes room + game + local session from memory (no persisted
     * cache) and leaves the caller to navigate home.
     */
    exitToHome: () => void
    /** @internal mock-only helper, not meant to be called by UI code directly */
    _mockAdvanceUntilLocal: () => void
  }
}

function ensureOnlineSync(set: (partial: Partial<GameStoreState>) => void, get: () => GameStoreState) {
  if (onlineSyncBound) return
  onlineSyncBound = true
  // Melds live on room, hands/discard on game. Applying room:state one tick
  // before game:state mounts the same card id in a meld AND the hand, which
  // inverts FLIP (teleport to meld, then fly back to the hand).

  bindSocketStoreHandlers({
    onRoomState: (room, playerId) => {
      const normalized = normalizeOnlineRoom(room)
      const { game } = get()
      const defer =
        normalized.status === 'in-progress' || normalized.status === 'round-end' || !!game
      if (defer) {
        pendingOnlineRoom = normalized
        return
      }
      pendingOnlineRoom = null
      set({ room: normalized, localPlayerId: playerId, playMode: 'online' })
    },
    onGameState: (game, playerId) => {
      applyOnlineSnapshot({ set, get, game, playerId })
    },
    onActionError: (error) => set({ lastActionError: error }),
    // After a socket reconnect the server loses CLIENTS[sid] — rebind via rejoin.
    onReconnect: () => {
      void get().actions.rejoinOnlineSession()
    },
  })
}

function dealNewRound(room: RoomState): GameState {
  const playerIds = room.players.map((p) => p.id)
  const deck = buildShuffledDeck()
  const { hands, remaining } = dealHands(deck, playerIds, HAND_SIZE)
  const { hands: pozzettoByTeamRaw, remaining: stockAfterPozzetto } = dealHands(
    remaining,
    ['team-a', 'team-b'],
    POZZETTO_SIZE,
  )

  const sortedHands: Record<string, CardModel[]> = {}
  for (const id of playerIds) sortedHands[id] = sortHand(hands[id])

  const stock = [...stockAfterPozzetto]
  const firstDiscard = stock.shift()

  return {
    roomId: room.roomId,
    stock,
    discardPile: { cards: firstDiscard ? [firstDiscard] : [] },
    hands: sortedHands,
    pozzettoStacks: {
      'team-a': pozzettoByTeamRaw['team-a'],
      'team-b': pozzettoByTeamRaw['team-b'],
    },
    turn: {
      activePlayerId: playerIds[0],
      phase: 'draw',
      turnNumber: 1,
      hasDrawnThisTurn: false,
      startedAt: Date.now(),
      isPaused: false,
      pausedAt: null,
    },
    round: 1,
    roundScoresHistory: [],
    lastRoundScores: null,
    pendingSlide: null,
    lastTopTouchFailure: null,
    gameOverTeamId: null,
    lastAcquired: null,
    lastPlay: null,
    emptyHandFoulByTeam: { 'team-a': 0, 'team-b': 0 },
  }
}

function findTeamForPlayer(room: RoomState, playerId: PlayerId): Team | undefined {
  return room.teams.find((t) => t.playerIds.includes(playerId))
}

function advanceTurn(game: GameState, room: RoomState, fromPlayerId: PlayerId): GameState['turn'] {
  const playerIds = room.players.slice().sort((a, b) => a.seat - b.seat).map((p) => p.id)
  const nextPlayerId = getNextPlayerId(playerIds, fromPlayerId)
  return {
    activePlayerId: nextPlayerId,
    phase: 'draw',
    turnNumber: game.turn.turnNumber + 1,
    hasDrawnThisTurn: false,
    startedAt: Date.now(),
    isPaused: false,
    pausedAt: null,
  }
}

/** Claims a team's Pozzetto into a player's hand, if the trigger conditions hold. Mutates nothing; returns updated pieces. */
function tryClaimPozzetto(
  game: GameState,
  team: Team,
  playerId: PlayerId,
  hand: CardModel[],
  trigger: 'discard' | 'meld-empty',
  handSizeBeforeAction: number,
  localPlayerId: PlayerId | null = null,
): { hand: CardModel[]; pozzettoStacks: GameState['pozzettoStacks']; pozzetto: Team['pozzetto'] } {
  const shouldClaim =
    trigger === 'discard'
      ? shouldClaimPozzettoOnDiscard(handSizeBeforeAction, team.pozzetto.claimed)
      : shouldClaimPozzettoOnMeldEmpty(handSizeBeforeAction, team.pozzetto.claimed)

  if (!shouldClaim) {
    return { hand, pozzettoStacks: game.pozzettoStacks, pozzetto: team.pozzetto }
  }

  const reserve = game.pozzettoStacks[team.id]
  // Kick off pickup flights while the reserve pile is still on screen.
  playPozzettoClaimFlights({
    teamId: team.id,
    playerId,
    cardIds: reserve.map((c) => c.id),
    toLocalHand: playerId === localPlayerId,
    slow: playerId !== localPlayerId,
  })
  const newHand = sortHand([...hand, ...reserve])
  return {
    hand: newHand,
    pozzettoStacks: { ...game.pozzettoStacks, [team.id]: [] },
    pozzetto: { claimed: true, claimedByPlayerId: playerId, activated: team.pozzetto.activated },
  }
}

/**
 * Discarding after the reserve is already in hand activates the Pozzetto
 * (required for Show). Used by human discard, timer auto-discard, and bots.
 */
function pozzettoAfterDiscard(
  claimPozzetto: Team['pozzetto'],
  wasClaimedBeforeDiscard: boolean,
): Team['pozzetto'] {
  return {
    ...claimPozzetto,
    activated: wasClaimedBeforeDiscard ? true : claimPozzetto.activated,
  }
}

/**
 * If the player’s hand is empty and their team meets Show conditions, end
 * the round immediately. Going out by discarding/melding the last card must
 * not leave the match stuck mid-round waiting for a separate button press.
 */
function tryAutoShowEnd(
  room: RoomState,
  game: GameState,
  team: Team,
  playerId: PlayerId,
): { ended: true; room: RoomState; game: GameState } | { ended: false } {
  const handSize = game.hands[playerId]?.length ?? 0
  const elig = evaluateShowEligibility(team, handSize)
  if (!elig.eligible) return { ended: false }
  const nextRoom = withTeam(room, team.id, (t) => ({
    ...t,
    pozzetto: { ...t.pozzetto, activated: true },
  }))
  const scored = endRoundWithScore(nextRoom, game, 'show', team.id)
  return { ended: true, room: scored.room, game: scored.game }
}

function withTeam(room: RoomState, teamId: TeamId, updater: (team: Team) => Team): RoomState {
  return { ...room, teams: room.teams.map((t) => (t.id === teamId ? updater(t) : t)) }
}

/** Accumulate −150 empty-hand foul for a team (applied at round score). */
function withEmptyHandFoul(game: GameState, teamId: TeamId): GameState {
  const prev = game.emptyHandFoulByTeam ?? { 'team-a': 0, 'team-b': 0 }
  return {
    ...game,
    emptyHandFoulByTeam: {
      ...prev,
      [teamId]: (prev[teamId] ?? 0) + EMPTY_HAND_FOUL_PENALTY,
    },
  }
}

function endRoundWithScore(
  room: RoomState,
  game: GameState,
  endingType: 'show' | 'sudden-death',
  showingTeamId: TeamId | null,
): { room: RoomState; game: GameState } {
  const [teamA, teamB] = room.teams as [Team, Team]
  const handsByTeam: Record<TeamId, CardModel[]> = {
    'team-a': teamA.playerIds.flatMap((pid) => game.hands[pid] ?? []),
    'team-b': teamB.playerIds.flatMap((pid) => game.hands[pid] ?? []),
  }

  const result = scoreRound(
    game.round,
    endingType,
    [teamA, teamB],
    handsByTeam,
    showingTeamId,
    { 'team-a': 0, 'team-b': 0 },
    game.emptyHandFoulByTeam ?? { 'team-a': 0, 'team-b': 0 },
  )

  const teams = room.teams.map((t) => ({
    ...t,
    score: t.score + result.teams[t.id].total,
    hasGoneOut: endingType === 'show' && t.id === showingTeamId,
  }))

  const gameOverTeamId = teams.find((t) => t.score >= room.matchTargetScore)?.id ?? null

  return {
    room: { ...room, teams, status: 'round-end' },
    game: {
      ...game,
      lastRoundScores: result,
      roundScoresHistory: [...game.roundScoresHistory, result],
      gameOverTeamId,
    },
  }
}

export const useGameStore = create<GameStoreState>((set, get) => ({
  room: null,
  game: null,
  localPlayerId: null,
  playMode: 'solo',
  selectedCardIds: [],
  selectedMeldId: null,
  topTouchInProgress: false, selectedDiscardIds: [],
  lastActionError: null,

  actions: {
    createRoom: (playerName, targetScore, turnTimerSeconds, maxPlayers) => {
      const capacity = normalizeMaxPlayers(maxPlayers)
      const roomId = makeRoomCode()
      const localPlayer: Player = {
        id: randomId('local'),
        name: playerName || 'You',
        teamId: 'team-a',
        seat: 0,
        isReady: false,
        isLocal: true,
        isMock: false,
        connectionStatus: 'connected',
        avatarColor: AVATAR_COLORS[0],
      }
      const mockPlayers = makeMockPlayers(capacity - 1)
      const players = [localPlayer, ...mockPlayers]

      set({
        playMode: 'solo',
        room: {
          roomId,
          status: 'lobby',
          players,
          teams: makeTeams(players),
          hostPlayerId: localPlayer.id,
          matchTargetScore: targetScore ?? DEFAULT_TARGET_SCORE,
          turnTimerSeconds: normalizeTurnTimerSeconds(turnTimerSeconds),
          maxPlayers: capacity,
        },
        game: null,
        localPlayerId: localPlayer.id,
        selectedCardIds: [],
        selectedMeldId: null,
        topTouchInProgress: false, selectedDiscardIds: [],
        lastActionError: null,
      })

      return roomId
    },

    joinRoom: (roomId: string, playerName: string) => {
      const localPlayer: Player = {
        id: randomId('local'),
        name: playerName || 'You',
        teamId: 'team-a',
        seat: 0,
        isReady: false,
        isLocal: true,
        isMock: false,
        connectionStatus: 'connected',
        avatarColor: AVATAR_COLORS[0],
      }
      const mockPlayers = makeMockPlayers(3)
      const players = [localPlayer, ...mockPlayers]

      set({
        playMode: 'solo',
        room: {
          roomId: roomId.toUpperCase(),
          status: 'lobby',
          players,
          teams: makeTeams(players),
          hostPlayerId: localPlayer.id,
          matchTargetScore: DEFAULT_TARGET_SCORE,
          turnTimerSeconds: DEFAULT_TURN_TIMER_SECONDS,
          maxPlayers: 4,
        },
        game: null,
        localPlayerId: localPlayer.id,
        selectedCardIds: [],
        selectedMeldId: null,
        topTouchInProgress: false, selectedDiscardIds: [],
        lastActionError: null,
      })
    },

    createRoomOnline: async (playerName, targetScore, turnTimerSeconds, maxPlayers) => {
      ensureOnlineSync(set, get)
      const ack = await socketCreateRoom({
        playerName,
        targetScore,
        turnTimerSeconds,
        maxPlayers: normalizeMaxPlayers(maxPlayers),
      })
      if (!ack.ok || !ack.roomId || !ack.playerId || !ack.room) {
        throw new Error(ack.error || 'Could not create room.')
      }
      persistOnlineSession(ack.roomId, ack.playerId)
      set({
        playMode: 'online',
        room: { ...ack.room, maxPlayers: normalizeMaxPlayers(ack.room.maxPlayers) },
        game: null,
        localPlayerId: ack.playerId,
        selectedCardIds: [],
        selectedMeldId: null,
        topTouchInProgress: false,
        selectedDiscardIds: [],
        lastActionError: null,
      })
      return ack.roomId
    },

    joinRoomOnline: async (roomId, playerName) => {
      ensureOnlineSync(set, get)
      const ack = await socketJoinRoom({ roomId, playerName })
      if (!ack.ok || !ack.roomId || !ack.playerId || !ack.room) {
        throw new Error(ack.error || 'Could not join room.')
      }
      persistOnlineSession(ack.roomId, ack.playerId)
      set({
        playMode: 'online',
        room: { ...ack.room, maxPlayers: normalizeMaxPlayers(ack.room.maxPlayers) },
        game: ack.game ?? null,
        localPlayerId: ack.playerId,
        selectedCardIds: [],
        selectedMeldId: null,
        topTouchInProgress: false,
        selectedDiscardIds: [],
        lastActionError: null,
      })
    },

    rejoinOnlineSession: async () => {
      try {
        const raw = localStorage.getItem(ONLINE_SESSION_KEY)
        if (!raw) return false
        const { roomId, playerId } = JSON.parse(raw) as { roomId: string; playerId: string }
        if (!roomId || !playerId) return false
        ensureOnlineSync(set, get)
        const ack = await socketRejoinRoom({ roomId, playerId })
        if (!ack.ok || !ack.room || !ack.playerId) return false
        set({
          playMode: 'online',
          room: ack.room,
          game: ack.game ?? null,
          localPlayerId: ack.playerId,
          lastActionError: null,
        })
        return true
      } catch {
        return false
      }
    },

    setLocalTeam: (teamId: TeamId) => {
      const { room, localPlayerId, playMode } = get()
      if (!room || !localPlayerId) return
      if (playMode === 'online') {
        void runOnlineAction(get, set, () => socketSetTeam(teamId), 'Could not switch teams.')
        return
      }
      const perTeam = seatsPerTeam(normalizeMaxPlayers(room.maxPlayers))
      const count = room.players.filter((p) => p.teamId === teamId && p.id !== localPlayerId).length
      if (count >= perTeam) {
        set({ lastActionError: 'That team is full.' })
        return
      }
      const players = room.players.map((p) => (p.id === localPlayerId ? { ...p, teamId } : p))
      set({ room: { ...room, players, teams: makeTeams(players) }, lastActionError: null })
    },

    setLocalSeat: (seat: number) => {
      const { room, localPlayerId, playMode } = get()
      if (!room || !localPlayerId) return
      if (playMode === 'online') {
        // Seat changes online are host/lobby swaps via set_seat RPC — expose later if needed.
        return
      }
      const occupied = room.players.find((p) => p.seat === seat)
      const players = room.players.map((p) => {
        if (p.id === localPlayerId) return { ...p, seat }
        if (occupied && p.id === occupied.id) {
          const prevSeat = room.players.find((x) => x.id === localPlayerId)?.seat ?? 0
          return { ...p, seat: prevSeat }
        }
        return p
      })
      set({ room: { ...room, players } })
    },

    toggleReady: () => {
      const { room, localPlayerId, playMode } = get()
      if (!room || !localPlayerId) {
        set({ lastActionError: 'Not connected to a room — rejoin with the party code.' })
        return
      }
      const local = room.players.find((p) => p.id === localPlayerId)
      const nextReady = !(local?.isReady ?? false)
      if (playMode === 'online') {
        // Explicit boolean (not toggle) avoids double-click / duplicate-emit races.
        void (async () => {
          // Optimistic UI so mobile taps feel responsive while waiting for broadcast.
          set({
            room: {
              ...room,
              players: room.players.map((p) =>
                p.id === localPlayerId ? { ...p, isReady: nextReady } : p,
              ),
            },
            lastActionError: null,
          })
          let ack = await socketSetReady(nextReady)
          if (!ack.ok && (ack.error || '').toLowerCase().includes('not in a room')) {
            const rejoined = await get().actions.rejoinOnlineSession()
            if (rejoined) ack = await socketSetReady(nextReady)
          }
          if (!ack.ok) {
            set({ lastActionError: ack.error || 'Could not update ready status.' })
          }
        })()
        return
      }
      const players = room.players.map((p) =>
        p.id === localPlayerId ? { ...p, isReady: nextReady } : p,
      )
      set({ room: { ...room, players } })
    },

    setMatchTargetScore: (score: number) => {
      const { room, playMode } = get()
      if (!room) return
      if (playMode === 'online') {
        void runOnlineAction(
          get,
          set,
          () => socketSetTarget(Math.max(500, Math.round(score))),
          'Could not update target score.',
        )
        return
      }
      set({ room: { ...room, matchTargetScore: Math.max(500, Math.round(score)) } })
    },

    setTurnTimerSeconds: (seconds: number) => {
      const { room, playMode } = get()
      if (!room) return
      const next = normalizeTurnTimerSeconds(seconds === 0 ? 0 : seconds)
      if (playMode === 'online') {
        void (async () => {
          const ack = await socketSetTimer(next)
          if (!ack.ok) set({ lastActionError: ack.error || 'Could not update timer.' })
        })()
        // Optimistic so the host UI updates immediately.
        set({ room: { ...room, turnTimerSeconds: next }, lastActionError: null })
        return
      }
      set({ room: { ...room, turnTimerSeconds: next } })
    },

    setMaxPlayers: (maxPlayers: MaxPlayers) => {
      const { room, playMode, localPlayerId } = get()
      if (!room || room.status !== 'lobby') return
      if (localPlayerId !== room.hostPlayerId) {
        set({ lastActionError: 'Only the host can change the player count.' })
        return
      }
      const capacity = normalizeMaxPlayers(maxPlayers)
      if (room.players.filter((p) => !p.isMock).length > capacity) {
        set({
          lastActionError: `Cannot set ${capacity}-player lobby — ${room.players.filter((p) => !p.isMock).length} humans already joined.`,
        })
        return
      }
      if (playMode === 'online') {
        const previous = normalizeMaxPlayers(room.maxPlayers)
        void (async () => {
          const ack = await socketSetMaxPlayers(capacity)
          if (!ack.ok) {
            const current = get().room
            if (current) {
              set({
                room: { ...current, maxPlayers: previous },
                lastActionError: ack.error || 'Could not update player count.',
              })
            }
          }
        })()
        set({ room: { ...room, maxPlayers: capacity }, lastActionError: null })
        return
      }
      // Solo: rebuild bots to fill the selected capacity.
      const humans = room.players.filter((p) => !p.isMock)
      const bots = makeMockPlayers(capacity - humans.length)
      const players = [...humans, ...bots]
      set({
        room: {
          ...room,
          maxPlayers: capacity,
          players,
          teams: makeTeams(players),
        },
        lastActionError: null,
      })
    },

    startGame: () => {
      const { room, playMode } = get()
      if (!room) return
      if (playMode === 'online') {
        void (async () => {
          set({ lastActionError: null })
          await runOnlineAction(
            get,
            set,
            () => socketStartGame(),
            'Could not start the game. Only the host can start once the lobby is full and ready.',
          )
        })()
        return
      }
      const capacity = normalizeMaxPlayers(room.maxPlayers)
      const perTeam = capacity / 2
      const teamA = room.players.filter((p) => p.teamId === 'team-a').length
      const teamB = room.players.filter((p) => p.teamId === 'team-b').length
      if (
        room.players.length < capacity ||
        !room.players.every((p) => p.isReady) ||
        teamA !== perTeam ||
        teamB !== perTeam
      ) {
        return
      }

      botTurnGeneration += 1
      const game = dealNewRound(room)
      set({
        room: { ...room, status: 'in-progress' },
        game,
        selectedCardIds: [],
        selectedMeldId: null,
        topTouchInProgress: false, selectedDiscardIds: [],
        lastActionError: null,
      })
      // If a mock player opens the round, start their paced turn immediately.
      if (game.turn.activePlayerId !== get().localPlayerId) {
        setTimeout(() => get().actions._mockAdvanceUntilLocal(), BOT_BETWEEN_TURNS_MS)
      }
    },

    toggleSelectCard: (cardId: string) => {
      const { selectedCardIds, game, localPlayerId } = get()
      const hand = game && localPlayerId ? game.hands[localPlayerId] ?? [] : []
      if (!hand.some((c) => c.id === cardId)) return
      set({
        selectedCardIds: selectedCardIds.includes(cardId)
          ? selectedCardIds.filter((id) => id !== cardId)
          : [...selectedCardIds, cardId],
      })
    },

    clearSelection: () =>
      set({ selectedCardIds: [], selectedMeldId: null, topTouchInProgress: false, selectedDiscardIds: [] }),

    selectMeldTarget: (meldId: string | null) => set({ selectedMeldId: meldId }),

    drawFromStock: () => {
      const { game, room, localPlayerId, playMode } = get()
      if (!game || !room || !localPlayerId) return
      if (game.turn.activePlayerId !== localPlayerId || game.turn.phase !== 'draw') return
      if (game.stock.length === 0) return
      if (playMode === 'online') {
        void (async () => {
          set({ lastActionError: null })
          const ok = await runOnlineAction(get, set, () => socketDraw(), 'Could not draw from stock.')
          if (!ok) return
        })()
        return
      }

      const { stock, hand, drawnCard } = performDrawFromStock(game.stock, game.hands[localPlayerId])
      set({
        game: {
          ...game,
          stock,
          hands: { ...game.hands, [localPlayerId]: sortHand(hand) },
          turn: { ...game.turn, phase: 'action', hasDrawnThisTurn: true },
          lastAcquired: drawnCard ? { playerId: localPlayerId, cardIds: [drawnCard.id], at: Date.now() } : game.lastAcquired,
        },
        lastActionError: null,
      })
    },

    beginTopTouch: () => {
      const { game, localPlayerId } = get()
      if (!game || !localPlayerId) return
      if (game.turn.activePlayerId !== localPlayerId || game.turn.phase !== 'draw') return
      if (game.discardPile.cards.length === 0) return
      const topCard = game.discardPile.cards[game.discardPile.cards.length - 1]
      set({
        topTouchInProgress: true,
        selectedDiscardIds: [topCard.id],
        selectedCardIds: [],
        selectedMeldId: null,
        lastActionError: null,
      })
    },

    cancelTopTouch: () => {
      set({ topTouchInProgress: false, selectedDiscardIds: [], selectedCardIds: [], selectedMeldId: null, lastActionError: null })
    },

    toggleDiscardPileCard: (cardId: string) => {
      const { game, topTouchInProgress, selectedDiscardIds } = get()
      if (!game || !topTouchInProgress) return
      const cards = game.discardPile.cards
      const idx = cards.findIndex((c) => c.id === cardId)
      if (idx === -1) return

      const topCard = cards[cards.length - 1]
      // Top card is mandatory for Top Touch and can never be deselected.
      if (cardId === topCard.id) return

      const isSelected = selectedDiscardIds.includes(cardId)
      const nextIds = isSelected
        ? selectedDiscardIds.filter((id) => id !== cardId)
        : [...selectedDiscardIds, cardId]
      // Keep top card first for stable UI; preserve pile order otherwise.
      const ordered = cards.filter((c) => nextIds.includes(c.id)).map((c) => c.id)
      set({ selectedDiscardIds: ordered })
    },

    attemptMeld: () => {
      const {
        game,
        room,
        localPlayerId,
        selectedCardIds,
        selectedMeldId,
        topTouchInProgress,
        selectedDiscardIds,
        playMode,
      } = get()
      if (!game || !room || !localPlayerId) return
      if (game.turn.activePlayerId !== localPlayerId) return
      const team = findTeamForPlayer(room, localPlayerId)
      if (!team) return
      const hand = game.hands[localPlayerId] ?? []
      const handIds = new Set(hand.map((c) => c.id))
      // Never send orphaned selection ids to the server (common after online melds).
      const validSelected = selectedCardIds.filter((id) => handIds.has(id))
      if (validSelected.length !== selectedCardIds.length) {
        set({ selectedCardIds: validSelected })
      }

      if (playMode === 'online') {
        const topCard = game.discardPile.cards[game.discardPile.cards.length - 1]
        const inDrawTopTouch = topTouchInProgress && game.turn.phase === 'draw'
        const meldDiscardIds =
          inDrawTopTouch && topCard
            ? selectedDiscardIds.length > 0 && selectedDiscardIds.includes(topCard.id)
              ? selectedDiscardIds.filter((id) => game.discardPile.cards.some((c) => c.id === id))
              : [topCard.id]
            : []
        void (async () => {
          set({ lastActionError: null })
          const ok = await runOnlineAction(
            get,
            set,
            () =>
              socketAttemptMeld({
                handCardIds: validSelected,
                targetMeldId: selectedMeldId,
                selectedDiscardIds: meldDiscardIds,
              }),
            'Could not meld.',
          )
          if (!ok) return
          set({ ...EMPTY_SELECTION })
        })()
        return
      }

      // Two-phase Top Touch (item 5): individually selected discard cards
      // (always including the top card) are combined with the current
      // hand/meld selection. Only on success does the rest of the pile join
      // the hand — nothing is granted just for entering this mode.
      if (topTouchInProgress) {
        if (game.turn.phase !== 'draw') return
        if (game.discardPile.cards.length === 0) {
          set({ lastActionError: 'Discard pile is empty.', topTouchInProgress: false, selectedDiscardIds: [] })
          return
        }
        const topCard = game.discardPile.cards[game.discardPile.cards.length - 1]
        const meldDiscardIds =
          selectedDiscardIds.length > 0 && selectedDiscardIds.includes(topCard.id)
            ? selectedDiscardIds
            : [topCard.id]

        const result = attemptMeldAction({
          hand,
          team,
          selectedHandCardIds: validSelected,
          targetMeldId: selectedMeldId,
          topTouch: { discardPile: game.discardPile.cards, selectedDiscardIds: meldDiscardIds },
        })

        if (!result.ok) {
          // Nothing is taken from the discard pile on failure - the top card
          // stays put and the player may try a different combination.
          set({ lastActionError: result.error })
          return
        }

        const meldsAfter =
          result.kind === 'append'
            ? team.melds.map((m) => (m.id === result.meld.id ? result.meld : m))
            : [...team.melds, result.meld]

        const usedIds = new Set(result.usedDiscardCards.map((c) => c.id))
        const restOfPile = game.discardPile.cards.filter((c) => !usedIds.has(c.id))
        let handAfter = sortHand([...result.hand, ...restOfPile])
        const claim = tryClaimPozzetto(
          game,
          { ...team, melds: meldsAfter },
          localPlayerId,
          handAfter,
          'meld-empty',
          handAfter.length,
          localPlayerId,
        )
        handAfter = claim.hand
        const teamAfter: Team = { ...team, melds: meldsAfter, pozzetto: claim.pozzetto }
        if (isIllegalEmptyHand(teamAfter, handAfter.length)) {
          set({
            lastActionError:
              'Empty-hand foul (−150): after Pozzetto is claimed you must keep ≥1 card unless your team can Show.',
          })
          return
        }

        set({
          room: withTeam(room, team.id, (t) => ({
            ...t,
            melds: meldsAfter,
            pozzetto: claim.pozzetto,
          })),
          game: {
            ...game,
            discardPile: { cards: [] },
            hands: { ...game.hands, [localPlayerId]: handAfter },
            pozzettoStacks: claim.pozzettoStacks,
            turn: { ...game.turn, phase: 'action', hasDrawnThisTurn: true },
            lastAcquired: {
              playerId: localPlayerId,
              cardIds: [...result.usedDiscardCards.map((c) => c.id), ...restOfPile.map((c) => c.id)],
              at: Date.now(),
            },
            pendingSlide: null,
          },
          selectedCardIds: [],
          selectedMeldId: null,
          topTouchInProgress: false,
          selectedDiscardIds: [],
          lastActionError: null,
        })
        return
      }

      if (game.turn.phase !== 'action') return

      if (validSelected.length === 0 && !selectedMeldId) {
        set({ lastActionError: 'Select hand cards to meld.' })
        return
      }
      if (validSelected.length === 0) {
        set({ lastActionError: 'Select hand cards to meld.' })
        return
      }

      const result = attemptMeldAction({
        hand,
        team,
        selectedHandCardIds: validSelected,
        targetMeldId: selectedMeldId,
      })

      if (!result.ok) {
        if (result.needsSlideChoice) {
          set({
            game: {
              ...game,
              pendingSlide: {
                teamId: team.id,
                meldId: selectedMeldId!,
                displacedWildCardId: result.needsSlideChoice.displacedWildCardId,
              },
            },
            lastActionError: result.error,
          })
          return
        }
        set({ lastActionError: result.error })
        return
      }

      const meldsAfter =
        result.kind === 'append'
          ? team.melds.map((m) => (m.id === result.meld.id ? result.meld : m))
          : [...team.melds, result.meld]

      const claim = tryClaimPozzetto(
        game,
        { ...team, melds: meldsAfter },
        localPlayerId,
        result.hand,
        'meld-empty',
        result.hand.length,
        localPlayerId,
      )
      const teamAfter: Team = { ...team, melds: meldsAfter, pozzetto: claim.pozzetto }
      if (isIllegalEmptyHand(teamAfter, claim.hand.length)) {
        set({
          lastActionError:
            'Empty-hand foul (−150): after Pozzetto is claimed you must keep ≥1 card unless your team can Show.',
        })
        return
      }

      const nextRoom = withTeam(room, team.id, (t) => ({
        ...t,
        melds: meldsAfter,
        pozzetto: claim.pozzetto,
      }))
      const nextGame: GameState = {
        ...game,
        hands: { ...game.hands, [localPlayerId]: sortHand(claim.hand) },
        pozzettoStacks: claim.pozzettoStacks,
        pendingSlide: null,
      }
      const teamForShow = nextRoom.teams.find((t) => t.id === team.id)!
      const autoShow = tryAutoShowEnd(nextRoom, nextGame, teamForShow, localPlayerId)
      if (autoShow.ended) {
        set({
          room: autoShow.room,
          game: autoShow.game,
          selectedCardIds: [],
          selectedMeldId: null,
          topTouchInProgress: false,
          selectedDiscardIds: [],
          lastActionError: null,
        })
        return
      }

      set({
        room: nextRoom,
        game: nextGame,
        selectedCardIds: [],
        selectedMeldId: null,
        topTouchInProgress: false,
        selectedDiscardIds: [],
        lastActionError: null,
      })
    },

    moveWildInMeld: (meldId: string) => {
      const { game, room, localPlayerId, playMode } = get()
      if (!game || !room || !localPlayerId) return
      if (game.turn.activePlayerId !== localPlayerId) return
      if (playMode === 'online') {
        void runOnlineAction(get, set, () => socketMoveWild(meldId), 'Could not move wild.')
        return
      }
      const team = findTeamForPlayer(room, localPlayerId)
      if (!team) return
      const meld = team.melds.find((m) => m.id === meldId)
      if (!meld) return

      const result = moveWildInMeldEngine(meld)
      if (!result.ok) {
        set({ lastActionError: result.error })
        return
      }

      const nextRoom = withTeam(room, team.id, (t) => ({
        ...t,
        melds: t.melds.map((m) => (m.id === meldId ? result.meld : m)),
      }))
      set({ room: nextRoom, lastActionError: null })
    },

    resolveSlide: (edge: 'top' | 'bottom') => {
      const { game, room, localPlayerId, selectedCardIds, playMode } = get()
      if (!game || !room || !localPlayerId || !game.pendingSlide) return
      const team = room.teams.find((t) => t.id === game.pendingSlide!.teamId)
      const meld = team?.melds.find((m) => m.id === game.pendingSlide!.meldId)
      const hand = game.hands[localPlayerId] ?? []
      const validSelected = selectedCardIds.filter((id) => hand.some((c) => c.id === id))
      if (!team || !meld || validSelected.length !== 1) return
      if (playMode === 'online') {
        void (async () => {
          const ok = await runOnlineAction(
            get,
            set,
            () =>
              socketResolveSlide({
                edge,
                handCardIds: validSelected,
                targetMeldId: meld.id,
              }),
            'Could not resolve slide.',
          )
          if (ok) set({ ...EMPTY_SELECTION })
        })()
        return
      }

      const result = appendCardFromHand(game.hands[localPlayerId], validSelected[0], meld, edge, team)
      if (!result.ok) {
        set({ lastActionError: result.error, game: { ...game, pendingSlide: null } })
        return
      }

      const handSizeAfterMeld = result.hand.length
      const claim = tryClaimPozzetto(game, team, localPlayerId, result.hand, 'meld-empty', handSizeAfterMeld, localPlayerId)
      const meldsAfter = team.melds.map((m) => (m.id === meld.id ? result.meld : m))
      const teamAfterClaim: Team = { ...team, melds: meldsAfter, pozzetto: claim.pozzetto }
      if (isIllegalEmptyHand(teamAfterClaim, claim.hand.length)) {
        set({
          lastActionError:
            'Empty-hand foul (−150): after Pozzetto is claimed you must keep ≥1 card unless your team can Show.',
          game: { ...game, pendingSlide: null },
        })
        return
      }

      const nextRoom = withTeam(room, team.id, (t) => ({
        ...t,
        melds: meldsAfter,
        pozzetto: claim.pozzetto,
      }))

      set({
        room: nextRoom,
        game: {
          ...game,
          pozzettoStacks: claim.pozzettoStacks,
          hands: { ...game.hands, [localPlayerId]: sortHand(claim.hand) },
          pendingSlide: null,
        },
        selectedCardIds: [],
        selectedMeldId: null,
        topTouchInProgress: false, selectedDiscardIds: [],
        lastActionError: null,
      })
    },

    discardSelected: () => {
      const { game, room, localPlayerId, selectedCardIds, playMode } = get()
      if (!game || !room || !localPlayerId) return
      if (game.turn.activePlayerId !== localPlayerId) return
      if (game.turn.phase !== 'action' && game.turn.phase !== 'discard') return
      const hand = game.hands[localPlayerId] ?? []
      const validSelected = selectedCardIds.filter((id) => hand.some((c) => c.id === id))
      if (validSelected.length !== selectedCardIds.length) {
        set({ selectedCardIds: validSelected })
      }
      if (validSelected.length !== 1) {
        set({ lastActionError: 'Select exactly one card in your hand to discard.' })
        return
      }
      const cardId = validSelected[0]
      if (playMode === 'online') {
        void (async () => {
          set({ lastActionError: null })
          const ok = await runOnlineAction(get, set, () => socketDiscard(cardId), 'Could not discard.')
          if (ok) set({ ...EMPTY_SELECTION })
        })()
        return
      }

      const team = findTeamForPlayer(room, localPlayerId)
      if (!team) return

      const result = performDiscard(game.hands[localPlayerId], cardId, game.discardPile.cards)
      if (!result) return

      const wasClaimedBefore = team.pozzetto.claimed
      const claim = tryClaimPozzetto(game, team, localPlayerId, result.hand, 'discard', result.handSizeBeforeDiscard, localPlayerId)
      const finalPozzetto = pozzettoAfterDiscard(claim.pozzetto, wasClaimedBefore)
      const teamAfterDiscard: Team = { ...team, pozzetto: finalPozzetto }
      if (isIllegalEmptyHand(teamAfterDiscard, claim.hand.length)) {
        set({
          lastActionError:
            'Empty-hand foul (−150): after Pozzetto is claimed you must keep ≥1 card unless your team can Show.',
        })
        return
      }
      const nextRoom = withTeam(room, team.id, (t) => ({ ...t, pozzetto: finalPozzetto }))
      const nextGame: GameState = {
        ...game,
        discardPile: { cards: result.discardPile },
        pozzettoStacks: claim.pozzettoStacks,
        hands: { ...game.hands, [localPlayerId]: sortHand(claim.hand) },
      }
      const teamAfter = nextRoom.teams.find((t) => t.id === team.id)!
      const autoShow = tryAutoShowEnd(nextRoom, nextGame, teamAfter, localPlayerId)
      if (autoShow.ended) {
        set({
          room: autoShow.room,
          game: autoShow.game,
          selectedCardIds: [],
          selectedMeldId: null,
          topTouchInProgress: false,
          selectedDiscardIds: [],
          lastActionError: null,
        })
        return
      }

      set({
        room: nextRoom,
        game: {
          ...nextGame,
          turn: advanceTurn(game, room, localPlayerId),
        },
        selectedCardIds: [],
        selectedMeldId: null,
        topTouchInProgress: false, selectedDiscardIds: [],
        lastActionError: null,
      })

      setTimeout(() => get().actions._mockAdvanceUntilLocal(), BOT_BETWEEN_TURNS_MS)
    },

    declareShow: () => {
      const { game, room, localPlayerId, selectedCardIds, playMode } = get()
      if (!game || !room || !localPlayerId) return
      if (game.turn.activePlayerId !== localPlayerId || game.turn.phase !== 'action') return
      if (playMode === 'online') {
        void (async () => {
          const hand = get().game?.hands[localPlayerId] ?? []
          const valid = selectedCardIds.filter((id) => hand.some((c) => c.id === id))
          if (hand.length === 1) {
            if (valid.length !== 1) {
              set({ lastActionError: 'Select your final card to discard and declare Show.' })
              return
            }
            // Last-card discard auto-Shows on the server when eligible.
            const ok = await runOnlineAction(
              get,
              set,
              () => socketDiscard(valid[0]),
              'Could not discard the final card.',
            )
            if (ok) set({ ...EMPTY_SELECTION })
            return
          }
          const ok = await runOnlineAction(get, set, () => socketDeclareShow(), 'Could not declare Show.')
          if (ok) set({ ...EMPTY_SELECTION })
        })()
        return
      }
      const team = findTeamForPlayer(room, localPlayerId)
      if (!team) return

      let hand = game.hands[localPlayerId]
      let discardPile = game.discardPile.cards

      if (hand.length === 1) {
        // Standard Show: discard the final card while declaring.
        if (selectedCardIds.length !== 1) {
          set({ lastActionError: 'Select your final card to discard and declare Show.' })
          return
        }
        const result = performDiscard(hand, selectedCardIds[0], discardPile)
        if (!result) return
        hand = result.hand
        discardPile = result.discardPile
      }

      const elig = evaluateShowEligibility(team, hand.length)
      if (!elig.eligible) {
        set({ lastActionError: 'Show conditions not met.' })
        return
      }

      const nextRoom = withTeam(room, team.id, (t) => ({ ...t, pozzetto: { ...t.pozzetto, activated: true } }))
      const { room: scoredRoom, game: scoredGame } = endRoundWithScore(
        nextRoom,
        { ...game, hands: { ...game.hands, [localPlayerId]: hand }, discardPile: { cards: discardPile } },
        'show',
        team.id,
      )

      set({
        room: scoredRoom,
        game: scoredGame,
        selectedCardIds: [],
        selectedMeldId: null,
        topTouchInProgress: false, selectedDiscardIds: [],
        lastActionError: null,
      })
    },

    forceSuddenDeathEndRound: () => {
      const { room, game, playMode } = get()
      if (!room || !game) return
      if (game.stock.length !== 0) return
      if (playMode === 'online') {
        void runOnlineAction(get, set, () => socketForceSuddenDeath(), 'Could not end the round.')
        return
      }
      const { room: scoredRoom, game: scoredGame } = endRoundWithScore(room, game, 'sudden-death', null)
      set({
        room: scoredRoom,
        game: scoredGame,
        selectedCardIds: [],
        selectedMeldId: null,
        topTouchInProgress: false,
        selectedDiscardIds: [],
      })
    },

    // Fires when the visible per-player turn countdown reaches zero for the
    // local player. Mirrors the mock-AI's "simplest legal action" strategy:
    // draw if needed, then discard (preferring whatever the player already
    // had selected) so the turn always resolves instead of stalling.
    autoEndTurn: () => {
      const { game, room, localPlayerId, selectedCardIds, playMode } = get()
      if (!game || !room || !localPlayerId) return
      if (game.turn.activePlayerId !== localPlayerId) return
      if (room.status !== 'in-progress') return
      if (playMode === 'online') {
        void runOnlineAction(get, set, () => socketAutoEndTurn(), 'Could not auto-end the turn.')
        return
      }
      const team = findTeamForPlayer(room, localPlayerId)
      if (!team) return

      let stock = game.stock
      let hand = game.hands[localPlayerId]
      let lastAcquired = game.lastAcquired

      if (game.turn.phase === 'draw' && stock.length > 0) {
        const drawResult = performDrawFromStock(stock, hand)
        stock = drawResult.stock
        hand = drawResult.hand
        if (drawResult.drawnCard) {
          lastAcquired = { playerId: localPlayerId, cardIds: [drawResult.drawnCard.id], at: Date.now() }
        }
      }

      const cardIdToDiscard = selectedCardIds.find((id) => hand.some((c) => c.id === id)) ?? hand[0]?.id

      if (!cardIdToDiscard) {
        set({
          game: {
            ...game,
            stock,
            hands: { ...game.hands, [localPlayerId]: sortHand(hand) },
            turn: advanceTurn(game, room, localPlayerId),
            lastAcquired,
          },
          selectedCardIds: [],
          selectedMeldId: null,
          topTouchInProgress: false, selectedDiscardIds: [],
          lastActionError: 'Time expired — turn skipped automatically.',
        })
        setTimeout(() => get().actions._mockAdvanceUntilLocal(), BOT_BETWEEN_TURNS_MS)
        return
      }

      const result = performDiscard(hand, cardIdToDiscard, game.discardPile.cards)
      if (!result) return

      const wasClaimedBefore = team.pozzetto.claimed
      const claim = tryClaimPozzetto(game, team, localPlayerId, result.hand, 'discard', result.handSizeBeforeDiscard, localPlayerId)
      const finalPozzetto = pozzettoAfterDiscard(claim.pozzetto, wasClaimedBefore)
      const teamAfterDiscard: Team = { ...team, pozzetto: finalPozzetto }
      const nextRoom = withTeam(room, team.id, (t) => ({ ...t, pozzetto: finalPozzetto }))
      let nextGame: GameState = {
        ...game,
        stock,
        discardPile: { cards: result.discardPile },
        pozzettoStacks: claim.pozzettoStacks,
        hands: { ...game.hands, [localPlayerId]: sortHand(claim.hand) },
        lastAcquired,
      }
      if (isIllegalEmptyHand(teamAfterDiscard, claim.hand.length)) {
        nextGame = withEmptyHandFoul(nextGame, team.id)
      }
      const teamAfter = nextRoom.teams.find((t) => t.id === team.id)!
      const autoShow = tryAutoShowEnd(nextRoom, nextGame, teamAfter, localPlayerId)
      if (autoShow.ended) {
        set({
          room: autoShow.room,
          game: autoShow.game,
          selectedCardIds: [],
          selectedMeldId: null,
          topTouchInProgress: false,
          selectedDiscardIds: [],
          lastActionError: null,
        })
        return
      }

      set({
        room: nextRoom,
        game: {
          ...nextGame,
          turn: advanceTurn(game, room, localPlayerId),
        },
        selectedCardIds: [],
        selectedMeldId: null,
        topTouchInProgress: false, selectedDiscardIds: [],
        lastActionError: isIllegalEmptyHand(teamAfterDiscard, claim.hand.length)
          ? 'Time expired — empty-hand foul (−150).'
          : 'Time expired — turn ended automatically.',
      })

      setTimeout(() => get().actions._mockAdvanceUntilLocal(), BOT_BETWEEN_TURNS_MS)
    },

    togglePauseTimer: () => {
      const { game, playMode } = get()
      if (!game) return

      const nextTurn = game.turn.isPaused
        ? {
            ...game.turn,
            isPaused: false,
            pausedAt: null,
            // Shift deadline by pause duration so remaining time continues where it froze.
            startedAt:
              game.turn.startedAt +
              (game.turn.pausedAt != null ? Date.now() - game.turn.pausedAt : 0),
          }
        : { ...game.turn, isPaused: true, pausedAt: Date.now() }

      if (playMode === 'online') {
        const snapshot = game
        set({ game: { ...game, turn: nextTurn }, lastActionError: null })
        void (async () => {
          const ok = await runOnlineAction(
            get,
            set,
            () => socketTogglePause(),
            'Could not pause/resume the timer.',
          )
          if (!ok) set({ game: snapshot })
        })()
        return
      }

      set({ game: { ...game, turn: nextTurn } })
    },

    startNewGame: () => {
      const { room, playMode } = get()
      if (!room) return
      if (playMode === 'online') {
        void runOnlineAction(get, set, () => socketStartNewGame(), 'Could not start a new game.')
        return
      }
      botTurnGeneration += 1
      // Full match reset: wipe scores, melds, pozzetto, history — then redeal.
      const teams = room.teams.map((t) => ({
        ...t,
        melds: [],
        hasGoneOut: false,
        score: 0,
        pozzetto: initialPozzettoState(),
      }))
      const nextRoomState: RoomState = { ...room, teams, status: 'in-progress' }
      const nextGame = dealNewRound(nextRoomState)
      nextGame.round = 1
      nextGame.roundScoresHistory = []
      nextGame.gameOverTeamId = null
      nextGame.lastRoundScores = null
      set({
        room: nextRoomState,
        game: nextGame,
        selectedCardIds: [],
        selectedMeldId: null,
        topTouchInProgress: false,
        selectedDiscardIds: [],
        lastActionError: null,
      })
      if (nextGame.turn.activePlayerId !== get().localPlayerId) {
        setTimeout(() => get().actions._mockAdvanceUntilLocal(), BOT_BETWEEN_TURNS_MS)
      }
    },

    startNextRound: () => {
      const { room, game, playMode } = get()
      if (!room || !game) return
      if (playMode === 'online') {
        void runOnlineAction(get, set, () => socketNextRound(), 'Could not start the next round.')
        return
      }
      if (room.status !== 'round-end' || game.gameOverTeamId) return
      botTurnGeneration += 1
      const teams = room.teams.map((t) => ({
        ...t,
        melds: [],
        hasGoneOut: false,
        pozzetto: initialPozzettoState(),
      }))
      const nextRoomState: RoomState = { ...room, teams, status: 'in-progress' }
      const nextGame = dealNewRound(nextRoomState)
      nextGame.round = game.round + 1
      nextGame.roundScoresHistory = game.roundScoresHistory
      set({
        room: nextRoomState,
        game: nextGame,
        selectedCardIds: [],
        selectedMeldId: null,
        topTouchInProgress: false,
        selectedDiscardIds: [],
        lastActionError: null,
      })
      if (nextGame.turn.activePlayerId !== get().localPlayerId) {
        setTimeout(() => get().actions._mockAdvanceUntilLocal(), BOT_BETWEEN_TURNS_MS)
      }
    },

    returnToLobby: () => {
      const { room, playMode } = get()
      if (!room) return
      if (playMode === 'online') {
        void runOnlineAction(get, set, () => socketReturnToLobby(), 'Could not return to lobby.')
        return
      }
      botTurnGeneration += 1
      // Exit table play but keep the room (players / teams) so lobby can restart.
      const teams = room.teams.map((t) => ({
        ...t,
        melds: [],
        hasGoneOut: false,
        pozzetto: initialPozzettoState(),
      }))
      const players = room.players.map((p) => ({
        ...p,
        // Bots stay auto-ready; humans must opt in again for the next start.
        isReady: !!p.isMock,
      }))
      set({
        room: { ...room, teams, players, status: 'lobby' },
        game: null,
        selectedCardIds: [],
        selectedMeldId: null,
        topTouchInProgress: false,
        selectedDiscardIds: [],
        lastActionError: null,
      })
    },

    exitToHome: () => {
      botTurnGeneration += 1
      clearOnlineSession()
      disconnectSocket()
      // Wipe all in-memory session state (there is no localStorage persistence;
      // this is the full "clear cache" / leave site session for the client).
      set({
        room: null,
        game: null,
        localPlayerId: null,
        playMode: 'solo',
        selectedCardIds: [],
        selectedMeldId: null,
        topTouchInProgress: false,
        selectedDiscardIds: [],
        lastActionError: null,
      })
    },

    /**
     * Internal-only mock helper: plays one mock/AI player's full turn as a
     * paced sequence of animated actions (draw → melds/appends → discard),
     * then waits {@link BOT_BETWEEN_TURNS_MS} before the next mock player
     * (or returns control when it's the local human's turn).
     *
     * Each sub-action uses the same card-flight duration as the human
     * player so bot turns feel watchable rather than an instant state jump.
     */
    _mockAdvanceUntilLocal: () => {
      if (get().playMode === 'online') return
      void runMockBotTurn(get, set)
    },
  },
}))

type StoreGet = typeof useGameStore.getState
type StoreSet = typeof useGameStore.setState

async function runMockBotTurn(get: StoreGet, set: StoreSet): Promise<void> {
  if (get().playMode === 'online') return
  const generation = botTurnGeneration
  const isCancelled = () =>
    botTurnGeneration !== generation || get().room?.status !== 'in-progress'

  const { game, room, localPlayerId } = get()
  if (!game || !room || !localPlayerId) return
  if (game.turn.activePlayerId === localPlayerId) return
  if (room.status !== 'in-progress') return

  const activeId = game.turn.activePlayerId
  const team = findTeamForPlayer(room, activeId)
  if (!team) return

  const handAnchor = `hand-${activeId}`

  // ----- 1) Draw: stock, OR Top Touch when it enables an immediate meld -----
  {
    const latest = get()
    if (!latest.game || !latest.room || isCancelled()) return
    const liveTeam = findTeamForPlayer(latest.room, activeId)
    if (!liveTeam) return
    // Skip draw if this seat already drew (e.g. tests / resumed mid-turn).
    if (!latest.game.turn.hasDrawnThisTurn) {
    let hand = latest.game.hands[activeId]
    let melds = liveTeam.melds
    const drawPlan = planAiDraw(hand, melds, latest.game.discardPile.cards, liveTeam.id)

    if (drawPlan.source === 'top-touch' && latest.game.discardPile.cards.length > 0) {
      const discardPile = latest.game.discardPile.cards
      const topCard = discardPile[discardPile.length - 1]
      // Same Top Touch rule as humans: pickup is illegal unless the top card
      // is part of the unlocking meld. Force-include top if the planner omitted it.
      const selectedDiscardIds = (() => {
        const ids =
          drawPlan.selectedDiscardIds.length > 0
            ? [...drawPlan.selectedDiscardIds]
            : [topCard.id]
        if (!ids.includes(topCard.id)) ids.push(topCard.id)
        return ids
      })()
      const topGate = topDiscardMustBePlayed(discardPile, selectedDiscardIds)
      let topTouchApplied = false
      if (topGate.ok) {
        const result = attemptMeldAction({
          hand,
          team: liveTeam,
          selectedHandCardIds: drawPlan.handCardIds,
          targetMeldId: drawPlan.targetMeldId,
          topTouch: { discardPile, selectedDiscardIds },
        })
        // Refuse to clear the pile unless the top card was actually melded.
        const playedTop =
          result.ok && result.usedDiscardCards.some((c) => c.id === topCard.id)
        if (result.ok && playedTop) {
          topTouchApplied = true
          for (const card of result.usedDiscardCards) {
            seedFlipOriginFromAnchor(card.id, 'discard', botFlip)
          }
          for (const id of drawPlan.handCardIds) seedFlipOriginFromAnchor(id, handAnchor, botFlip)
          const usedIds = new Set(result.usedDiscardCards.map((c) => c.id))
          const restOfPile = discardPile.filter((c) => !usedIds.has(c.id))
          const meldsAfter =
            result.kind === 'append'
              ? liveTeam.melds.map((m) => (m.id === result.meld.id ? result.meld : m))
              : [...liveTeam.melds, result.meld]
          // Remainder of the pile joins the hand (same as human Top Touch success).
          // If that leaves the bot at 0 cards, claim Pozzetto mid-turn (any seat).
          let combinedHand = sortHand([...result.hand, ...restOfPile])
          let nextStacks = latest.game.pozzettoStacks
          let nextPozzetto = liveTeam.pozzetto
          if (combinedHand.length === 0 && !liveTeam.pozzetto.claimed) {
            const claim = tryClaimPozzetto(
              latest.game,
              liveTeam,
              activeId,
              combinedHand,
              'meld-empty',
              0,
              get().localPlayerId,
            )
            combinedHand = claim.hand
            nextStacks = claim.pozzettoStacks
            nextPozzetto = claim.pozzetto
          }
          const nextRoom = withTeam(latest.room, liveTeam.id, (t) => ({
            ...t,
            melds: meldsAfter,
            pozzetto: nextPozzetto,
          }))
          const handRect = getFlipAnchorRect(handAnchor)
          const discardRect = getFlipAnchorRect('discard')
          if (discardRect && handRect) {
            for (const _card of restOfPile) {
              void botDetachedFlight({ from: discardRect, to: handRect, faceDown: true })
            }
          }
          set({
            room: nextRoom,
            game: {
              ...latest.game,
              hands: { ...latest.game.hands, [activeId]: combinedHand },
              discardPile: { cards: [] },
              pozzettoStacks: nextStacks,
              turn: { ...latest.game.turn, phase: 'action', hasDrawnThisTurn: true },
              lastAcquired: {
                playerId: activeId,
                cardIds: [...result.usedDiscardCards.map((c) => c.id), ...restOfPile.map((c) => c.id)],
                at: Date.now(),
              },
            },
          })
          await sleepRespectingPause(BOT_ACTION_MS, isCancelled)
          if (isCancelled()) return
        }
      }
      if (!topTouchApplied && latest.game.stock.length > 0) {
        // Top Touch plan failed validation at apply-time — fall back to stock.
        const stockRect = getFlipAnchorRect('stock')
        const handRect = getFlipAnchorRect(handAnchor)
        const drawResult = performDrawFromStock(latest.game.stock, hand)
        if (stockRect && handRect && drawResult.drawnCard) {
          void botDetachedFlight({ from: stockRect, to: handRect, faceDown: true })
        }
        set({
          game: {
            ...latest.game,
            stock: drawResult.stock,
            hands: { ...latest.game.hands, [activeId]: sortHand(drawResult.hand) },
            turn: { ...latest.game.turn, phase: 'action', hasDrawnThisTurn: true },
            lastAcquired: {
              playerId: activeId,
              cardIds: drawResult.drawnCard ? [drawResult.drawnCard.id] : [],
              at: Date.now(),
            },
          },
        })
        await sleepRespectingPause(BOT_ACTION_MS, isCancelled)
        if (isCancelled()) return
      }
    } else if (latest.game.stock.length > 0) {
      const stockRect = getFlipAnchorRect('stock')
      const handRect = getFlipAnchorRect(handAnchor)
      const drawResult = performDrawFromStock(latest.game.stock, hand)
      if (stockRect && handRect && drawResult.drawnCard) {
        void botDetachedFlight({ from: stockRect, to: handRect, faceDown: true })
      }
      set({
        game: {
          ...latest.game,
          stock: drawResult.stock,
          hands: { ...latest.game.hands, [activeId]: sortHand(drawResult.hand) },
          turn: { ...latest.game.turn, phase: 'action', hasDrawnThisTurn: true },
          lastAcquired: {
            playerId: activeId,
            cardIds: drawResult.drawnCard ? [drawResult.drawnCard.id] : [],
            at: Date.now(),
          },
        },
      })
      await sleepRespectingPause(BOT_ACTION_MS, isCancelled)
      if (isCancelled()) return
    }
    } // end !hasDrawnThisTurn
  }

  /** Public-info AI context (own/opponent melds + Pozzetto/Show floor). */
  function buildAiContext(team: Team, handSize: number): AiPlayContext {
    const roomNow = get().room
    const gameNow = get().game
    const opp = roomNow?.teams.find((t) => t.id !== team.id)
    const elig = evaluateShowEligibility(team, handSize)
    return {
      teamId: team.id,
      ownMelds: team.melds,
      opponentMelds: opp?.melds ?? [],
      discardPile: gameNow?.discardPile.cards ?? [],
      pozzettoClaimed: team.pozzetto.claimed,
      // May empty only when Show conditions (aside from hand-empty) are met.
      mayEmptyForShow: elig.reserveActivated && elig.canastaWinCondition,
      handSize,
    }
  }

  // Plan melds/appends/discard against the post-draw hand.
  // Order: append into existing melds FIRST (so e.g. Queens join an existing
  // Queens set), then open new melds, then append again. If the bot empties
  // their hand mid-turn and claims Pozzetto, re-run the action loop so they
  // can play from the reserve (teammate and opponents alike).
  async function runAppendPass(): Promise<boolean> {
    let claimedMidTurn = false
    const snap = get()
    if (!snap.game || !snap.room || isCancelled()) return false
    const liveTeam = findTeamForPlayer(snap.room, activeId)
    if (!liveTeam) return false
    let hand = snap.game.hands[activeId]
    let melds = liveTeam.melds
    const appendPlans = planAiAppends(hand, melds, buildAiContext(liveTeam, hand.length))
    for (const plan of appendPlans.plans) {
      const step = get()
      if (!step.game || !step.room || isCancelled()) return claimedMidTurn
      const stepTeam = findTeamForPlayer(step.room, activeId)
      if (!stepTeam) return claimedMidTurn
      hand = step.game.hands[activeId]
      melds = stepTeam.melds
      const meld = melds.find((m) => m.id === plan.meldId)
      const card = hand.find((c) => c.id === plan.cardId)
      if (!meld || !card) continue
      const floor = actionRetainFloor(buildAiContext(stepTeam, hand.length))
      if (hand.length - 1 < floor) continue
      seedFlipOriginFromAnchor(card.id, handAnchor, botFlip)
      // Auto-resolve Slide to the top edge — bots have no UI prompt, and
      // naturalizing a wild-filled slot (e.g. 7 into 6-★-8-9-10) is preferred.
      const result = appendCardFromHand(hand, plan.cardId, meld, 'top', stepTeam)
      if (!result.ok) continue
      hand = result.hand
      melds = melds.map((m) => (m.id === meld.id ? result.meld : m))
      let nextRoom = withTeam(step.room, stepTeam.id, (t) => ({ ...t, melds }))
      let nextStacks = step.game.pozzettoStacks
      let nextGameBase = step.game
      if (hand.length === 0 && !stepTeam.pozzetto.claimed) {
        const claim = tryClaimPozzetto(
          step.game,
          stepTeam,
          activeId,
          hand,
          'meld-empty',
          0,
          get().localPlayerId,
        )
        hand = claim.hand
        nextStacks = claim.pozzettoStacks
        nextRoom = withTeam(nextRoom, stepTeam.id, (t) => ({ ...t, pozzetto: claim.pozzetto }))
        if (claim.pozzetto.claimed && !stepTeam.pozzetto.claimed) claimedMidTurn = true
      } else if (
        isIllegalEmptyHand({ ...stepTeam, melds, pozzetto: stepTeam.pozzetto }, hand.length)
      ) {
        // Should be rare (retain floor); still score the foul if it happens.
        nextGameBase = withEmptyHandFoul(step.game, stepTeam.id)
      }
      set({
        room: nextRoom,
        game: {
          ...nextGameBase,
          pozzettoStacks: nextStacks,
          hands: { ...nextGameBase.hands, [activeId]: sortHand(hand) },
          turn: { ...nextGameBase.turn, phase: 'action', hasDrawnThisTurn: true },
        },
      })
      await sleepRespectingPause(BOT_ACTION_MS, isCancelled)
      if (isCancelled()) return claimedMidTurn
    }
    return claimedMidTurn
  }

  async function runNewMeldPass(): Promise<boolean> {
    let claimedMidTurn = false
    const latest = get()
    if (!latest.game || !latest.room || isCancelled()) return false
    const currentTeam = findTeamForPlayer(latest.room, activeId)
    if (!currentTeam) return false
    let hand = latest.game.hands[activeId]
    const melds = currentTeam.melds

    const meldPlans = planAiMelds(hand, currentTeam.id, melds, buildAiContext(currentTeam, hand.length))
    for (const plan of meldPlans.plans) {
      const snap = get()
      if (!snap.game || !snap.room || isCancelled()) return claimedMidTurn
      const liveTeam = findTeamForPlayer(snap.room, activeId)
      if (!liveTeam) return claimedMidTurn
      hand = snap.game.hands[activeId]
      const cards = hand.filter((c) => plan.cardIds.includes(c.id))
      if (cards.length !== plan.cardIds.length) continue
      const floor = actionRetainFloor(buildAiContext(liveTeam, hand.length))
      if (hand.length - cards.length < floor) continue
      for (const card of cards) seedFlipOriginFromAnchor(card.id, handAnchor, botFlip)
      const built = createMeldFromHand(hand, plan.cardIds, plan.kind, liveTeam.id)
      if (!built.ok) continue
      hand = built.hand
      const nextMelds = [...liveTeam.melds, built.meld]
      let nextRoom = withTeam(snap.room, liveTeam.id, (t) => ({ ...t, melds: nextMelds }))
      let nextStacks = snap.game.pozzettoStacks
      if (hand.length === 0 && !liveTeam.pozzetto.claimed) {
        const claim = tryClaimPozzetto(
          snap.game,
          liveTeam,
          activeId,
          hand,
          'meld-empty',
          0,
          get().localPlayerId,
        )
        hand = claim.hand
        nextStacks = claim.pozzettoStacks
        nextRoom = withTeam(nextRoom, liveTeam.id, (t) => ({ ...t, pozzetto: claim.pozzetto }))
        if (claim.pozzetto.claimed && !liveTeam.pozzetto.claimed) claimedMidTurn = true
      }
      set({
        room: nextRoom,
        game: {
          ...snap.game,
          pozzettoStacks: nextStacks,
          hands: { ...snap.game.hands, [activeId]: sortHand(hand) },
          turn: { ...snap.game.turn, phase: 'action', hasDrawnThisTurn: true },
        },
      })
      await sleepRespectingPause(BOT_ACTION_MS, isCancelled)
      if (isCancelled()) return claimedMidTurn
    }
    return claimedMidTurn
  }

  // Up to 2 full action cycles: the second covers playing from a mid-turn
  // Pozzetto pickup (running-turn activation).
  for (let cycle = 0; cycle < 2; cycle += 1) {
    const claimedA = await runAppendPass()
    if (isCancelled()) return
    const claimedM = await runNewMeldPass()
    if (isCancelled()) return
    const claimedB = await runAppendPass()
    if (isCancelled()) return
    if (!(claimedA || claimedM || claimedB)) break
  }

  /** Discard one card (claiming Pozzetto on last-card discard), then advance. */
  async function finishBotDiscard(): Promise<boolean> {
    const snap = get()
    if (!snap.game || !snap.room || isCancelled()) return false
    const liveTeam = findTeamForPlayer(snap.room, activeId)
    if (!liveTeam) return false
    const hand = snap.game.hands[activeId]
    if (hand.length === 0) return false
    // Planners keep ≥2 cards after Pozzetto (unless Show). If somehow down to
    // 1, rules still require a discard — that's the foul case to score later.
    const aiCtx = buildAiContext(liveTeam, hand.length)
    const discardCard = pickAiDiscard(hand, aiCtx) ?? hand[0]
    seedFlipOriginFromAnchor(discardCard.id, handAnchor, botFlip)
    const handSizeBeforeDiscard = hand.length
    const finalHand = hand.filter((c) => c.id !== discardCard.id)
    const discardPile = [...snap.game.discardPile.cards, discardCard]
    const wasClaimedBefore = liveTeam.pozzetto.claimed
    const claim = tryClaimPozzetto(
      snap.game,
      liveTeam,
      activeId,
      finalHand,
      'discard',
      handSizeBeforeDiscard,
      get().localPlayerId,
    )
    const finalPozzetto = pozzettoAfterDiscard(claim.pozzetto, wasClaimedBefore)
    const nextRoom = withTeam(snap.room, liveTeam.id, (t) => ({
      ...t,
      pozzetto: finalPozzetto,
    }))
    let nextGame: GameState = {
      ...snap.game,
      hands: { ...snap.game.hands, [activeId]: sortHand(claim.hand) },
      discardPile: { cards: discardPile },
      pozzettoStacks: claim.pozzettoStacks,
    }
    const teamAfterDiscard: Team = { ...liveTeam, pozzetto: finalPozzetto }
    if (isIllegalEmptyHand(teamAfterDiscard, claim.hand.length)) {
      nextGame = withEmptyHandFoul(nextGame, liveTeam.id)
    }
    const teamAfter = nextRoom.teams.find((t) => t.id === liveTeam.id)!
    const autoShow = tryAutoShowEnd(nextRoom, nextGame, teamAfter, activeId)
    if (autoShow.ended) {
      set({ room: autoShow.room, game: autoShow.game })
      await sleepRespectingPause(BOT_ACTION_MS, isCancelled)
      return true
    }

    const nextTurn = advanceTurn(snap.game, snap.room, activeId)
    set({
      room: nextRoom,
      game: {
        ...nextGame,
        turn: nextTurn,
      },
    })
    await sleepRespectingPause(BOT_ACTION_MS, isCancelled)
    if (isCancelled()) return true

    await sleepRespectingPause(BOT_BETWEEN_TURNS_MS, isCancelled)
    if (isCancelled()) return true
    if (nextTurn.activePlayerId !== get().localPlayerId) {
      get().actions._mockAdvanceUntilLocal()
    }
    return true
  }

  // Safety: if the hand is empty and Pozzetto is still unclaimed (any bot seat,
  // including the human's teammate), pick it up mid-turn and play from it.
  {
    const snap = get()
    if (!snap.game || !snap.room || isCancelled()) return
    const liveTeam = findTeamForPlayer(snap.room, activeId)
    const hand = snap.game.hands[activeId] ?? []
    if (liveTeam && hand.length === 0 && !liveTeam.pozzetto.claimed) {
      const claim = tryClaimPozzetto(
        snap.game,
        liveTeam,
        activeId,
        hand,
        'meld-empty',
        0,
        get().localPlayerId,
      )
      set({
        room: withTeam(snap.room, liveTeam.id, (t) => ({ ...t, pozzetto: claim.pozzetto })),
        game: {
          ...snap.game,
          hands: { ...snap.game.hands, [activeId]: sortHand(claim.hand) },
          pozzettoStacks: claim.pozzettoStacks,
        },
      })
      if (claim.pozzetto.claimed && claim.hand.length > 0) {
        await sleepRespectingPause(BOT_ACTION_MS, isCancelled)
        if (isCancelled()) return
        await runAppendPass()
        if (isCancelled()) return
        await runNewMeldPass()
        if (isCancelled()) return
        await runAppendPass()
        if (isCancelled()) return
      }
    }
  }

  // ----- Discard: required whenever the bot still holds cards -----
  if (await finishBotDiscard()) return
  if (isCancelled()) return

  // Empty hand (no discard) — Show if eligible, otherwise advance the turn.
  {
    const snap = get()
    if (!snap.game || !snap.room || isCancelled()) return
    const liveTeam = findTeamForPlayer(snap.room, activeId)
    if (liveTeam) {
      const autoShow = tryAutoShowEnd(snap.room, snap.game, liveTeam, activeId)
      if (autoShow.ended) {
        set({ room: autoShow.room, game: autoShow.game })
        return
      }
    }
    const nextTurn = advanceTurn(snap.game, snap.room, activeId)
    set({ game: { ...snap.game, turn: nextTurn } })
    await sleepRespectingPause(BOT_BETWEEN_TURNS_MS, isCancelled)
    if (isCancelled()) return
    if (nextTurn.activePlayerId !== get().localPlayerId) {
      get().actions._mockAdvanceUntilLocal()
    }
  }
}
