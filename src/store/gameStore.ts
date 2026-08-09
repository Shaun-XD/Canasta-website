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
import { DEFAULT_TARGET_SCORE, DEFAULT_TURN_TIMER_SECONDS } from '../types/game'
import { buildShuffledDeck, dealHands, sortHand } from '../lib/deck'
import { initialPozzettoState, shouldClaimPozzettoOnDiscard, shouldClaimPozzettoOnMeldEmpty } from '../engine/pozzetto'
import { evaluateShowEligibility } from '../engine/showEligibility'
import { scoreRound } from '../engine/scoring'
import {
  appendCardFromHand,
  attemptMeldAction,
  createMeldFromHand,
  getNextPlayerId,
  performDiscard,
  performDrawFromStock,
} from '../engine/turnEngine'
import { moveWildEdgeInSet } from '../engine/meldValidation'
import { planAiAppends, planAiMelds, pickAiDiscard } from '../engine/aiPlayer'
import {
  FLIP_DURATION_MS,
  getFlipAnchorRect,
  playDetachedCardFlight,
  seedFlipOriginFromAnchor,
} from '../hooks/useCardFlip'

/** Per-action pacing for mock/bot turns — matches the human card-flight duration. */
const BOT_ACTION_MS = FLIP_DURATION_MS
/** Extra pause after a bot finishes its turn, before the next bot (or human) acts. */
const BOT_BETWEEN_TURNS_MS = 500

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
const MOCK_PLAYER_NAMES = ['Player 2 (mock)', 'Player 3 (mock)', 'Player 4 (mock)']

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

const MOCK_TEAM_IDS: TeamId[] = ['team-a', 'team-b', 'team-b']

function makeMockPlayers(): Player[] {
  return MOCK_PLAYER_NAMES.map((name, i) => ({
    id: randomId('mock'),
    name,
    teamId: MOCK_TEAM_IDS[i],
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
   * While `topTouchInProgress`, how many cards counting down from the top of
   * the discard pile are currently included as meld candidates (always >= 1
   * - the top card itself is mandatory and can never be excluded). 0 when no
   * Top Touch is in progress.
   */
  selectedDiscardCount: number
  lastActionError: string | null
  actions: {
    createRoom: (playerName: string, targetScore?: number, turnTimerSeconds?: number) => string
    joinRoom: (roomId: string, playerName: string) => void
    setLocalTeam: (teamId: TeamId) => void
    setLocalSeat: (seat: number) => void
    toggleReady: () => void
    setMatchTargetScore: (score: number) => void
    setTurnTimerSeconds: (seconds: number) => void
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
     * While a Top Touch is in progress, toggles whether the discard pile
     * card `cardId` (and everything above it, i.e. closer to the top) is
     * included in the candidate set. Since cards can only be taken off the
     * pile top-down, this always resolves to a contiguous run counting down
     * from the top - the top card itself can never be excluded.
     */
    toggleDiscardPileCard: (cardId: string) => void
    /**
     * The single unified meld action (item 3) behind the "Meld" button.
     * Uses the current hand-card selection + targeted meld group (and, if
     * `topTouchInProgress`, the top discard card) to either append to the
     * targeted meld or auto-detect + create a brand-new Set/Sequence.
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
    nextRound: () => void
    returnToLobby: () => void
    /** @internal mock-only helper, not meant to be called by UI code directly */
    _mockAdvanceUntilLocal: () => void
  }
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
): { hand: CardModel[]; pozzettoStacks: GameState['pozzettoStacks']; pozzetto: Team['pozzetto'] } {
  const shouldClaim =
    trigger === 'discard'
      ? shouldClaimPozzettoOnDiscard(handSizeBeforeAction, team.pozzetto.claimed)
      : shouldClaimPozzettoOnMeldEmpty(handSizeBeforeAction, team.pozzetto.claimed)

  if (!shouldClaim) {
    return { hand, pozzettoStacks: game.pozzettoStacks, pozzetto: team.pozzetto }
  }

  const reserve = game.pozzettoStacks[team.id]
  const newHand = sortHand([...hand, ...reserve])
  return {
    hand: newHand,
    pozzettoStacks: { ...game.pozzettoStacks, [team.id]: [] },
    pozzetto: { claimed: true, claimedByPlayerId: playerId, activated: team.pozzetto.activated },
  }
}

function withTeam(room: RoomState, teamId: TeamId, updater: (team: Team) => Team): RoomState {
  return { ...room, teams: room.teams.map((t) => (t.id === teamId ? updater(t) : t)) }
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

  const result = scoreRound(game.round, endingType, [teamA, teamB], handsByTeam, showingTeamId)

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
  selectedCardIds: [],
  selectedMeldId: null,
  topTouchInProgress: false, selectedDiscardCount: 0,
  lastActionError: null,

  actions: {
    createRoom: (playerName: string, targetScore?: number, turnTimerSeconds?: number) => {
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
      const mockPlayers = makeMockPlayers()
      const players = [localPlayer, ...mockPlayers]

      set({
        room: {
          roomId,
          status: 'lobby',
          players,
          teams: makeTeams(players),
          hostPlayerId: localPlayer.id,
          matchTargetScore: targetScore ?? DEFAULT_TARGET_SCORE,
          turnTimerSeconds: turnTimerSeconds && turnTimerSeconds > 0 ? Math.round(turnTimerSeconds) : DEFAULT_TURN_TIMER_SECONDS,
        },
        game: null,
        localPlayerId: localPlayer.id,
        selectedCardIds: [],
        selectedMeldId: null,
        topTouchInProgress: false, selectedDiscardCount: 0,
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
      const mockPlayers = makeMockPlayers()
      const players = [localPlayer, ...mockPlayers]

      set({
        room: {
          roomId: roomId.toUpperCase(),
          status: 'lobby',
          players,
          teams: makeTeams(players),
          hostPlayerId: localPlayer.id,
          matchTargetScore: DEFAULT_TARGET_SCORE,
          turnTimerSeconds: DEFAULT_TURN_TIMER_SECONDS,
        },
        game: null,
        localPlayerId: localPlayer.id,
        selectedCardIds: [],
        selectedMeldId: null,
        topTouchInProgress: false, selectedDiscardCount: 0,
        lastActionError: null,
      })
    },

    setLocalTeam: (teamId: TeamId) => {
      const { room, localPlayerId } = get()
      if (!room || !localPlayerId) return
      const players = room.players.map((p) => (p.id === localPlayerId ? { ...p, teamId } : p))
      set({ room: { ...room, players, teams: makeTeams(players) } })
    },

    setLocalSeat: (seat: number) => {
      const { room, localPlayerId } = get()
      if (!room || !localPlayerId) return
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
      const { room, localPlayerId } = get()
      if (!room || !localPlayerId) return
      const players = room.players.map((p) => (p.id === localPlayerId ? { ...p, isReady: !p.isReady } : p))
      set({ room: { ...room, players } })
    },

    setMatchTargetScore: (score: number) => {
      const { room } = get()
      if (!room) return
      set({ room: { ...room, matchTargetScore: Math.max(500, Math.round(score)) } })
    },

    setTurnTimerSeconds: (seconds: number) => {
      const { room } = get()
      if (!room) return
      set({ room: { ...room, turnTimerSeconds: Math.max(10, Math.round(seconds)) } })
    },

    startGame: () => {
      const { room } = get()
      if (!room) return
      if (room.players.length < 4 || !room.players.every((p) => p.isReady)) return

      botTurnGeneration += 1
      const game = dealNewRound(room)
      set({
        room: { ...room, status: 'in-progress' },
        game,
        selectedCardIds: [],
        selectedMeldId: null,
        topTouchInProgress: false, selectedDiscardCount: 0,
        lastActionError: null,
      })
      // If a mock player opens the round, start their paced turn immediately.
      if (game.turn.activePlayerId !== get().localPlayerId) {
        setTimeout(() => get().actions._mockAdvanceUntilLocal(), BOT_BETWEEN_TURNS_MS)
      }
    },

    toggleSelectCard: (cardId: string) => {
      const { selectedCardIds } = get()
      set({
        selectedCardIds: selectedCardIds.includes(cardId)
          ? selectedCardIds.filter((id) => id !== cardId)
          : [...selectedCardIds, cardId],
      })
    },

    clearSelection: () =>
      set({ selectedCardIds: [], selectedMeldId: null, topTouchInProgress: false, selectedDiscardCount: 0 }),

    selectMeldTarget: (meldId: string | null) => set({ selectedMeldId: meldId }),

    drawFromStock: () => {
      const { game, room, localPlayerId } = get()
      if (!game || !room || !localPlayerId) return
      if (game.turn.activePlayerId !== localPlayerId || game.turn.phase !== 'draw') return
      if (game.stock.length === 0) return

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
      set({
        topTouchInProgress: true,
        selectedDiscardCount: 1,
        selectedCardIds: [],
        selectedMeldId: null,
        lastActionError: null,
      })
    },

    cancelTopTouch: () => {
      set({ topTouchInProgress: false, selectedDiscardCount: 0, selectedCardIds: [], selectedMeldId: null, lastActionError: null })
    },

    toggleDiscardPileCard: (cardId: string) => {
      const { game, topTouchInProgress, selectedDiscardCount } = get()
      if (!game || !topTouchInProgress) return
      const cards = game.discardPile.cards
      const idx = cards.findIndex((c) => c.id === cardId)
      if (idx === -1) return

      // Cards can only be picked up top-down, so the candidate set is always
      // the contiguous run counting down from the top. Clicking a card that
      // is already part of that run shrinks the run to end just above it
      // (deselecting it and everything further from the top); clicking one
      // that isn't yet included extends the run down to include it. The top
      // card itself (distanceFromTop === 0) can never drop below a run
      // length of 1 - it is the one mandatory Top Touch card.
      const distanceFromTop = cards.length - 1 - idx
      const isSelected = distanceFromTop < selectedDiscardCount
      const nextCount = isSelected ? Math.max(1, distanceFromTop) : distanceFromTop + 1
      set({ selectedDiscardCount: nextCount })
    },

    attemptMeld: () => {
      const { game, room, localPlayerId, selectedCardIds, selectedMeldId, topTouchInProgress, selectedDiscardCount } = get()
      if (!game || !room || !localPlayerId) return
      if (game.turn.activePlayerId !== localPlayerId) return
      const team = findTeamForPlayer(room, localPlayerId)
      if (!team) return
      const hand = game.hands[localPlayerId]

      // Two-phase Top Touch (item 5): the selected contiguous top-down run
      // of discard cards (always including the top card) is combined with
      // the current hand/meld selection and only ever attempted, never
      // committed speculatively - the rest of the pile is granted to the
      // hand ONLY on success, right here in the same action.
      if (topTouchInProgress) {
        if (game.turn.phase !== 'draw') return
        if (game.discardPile.cards.length === 0) {
          set({ lastActionError: 'Discard pile is empty.', topTouchInProgress: false, selectedDiscardCount: 0 })
          return
        }
        const count = Math.max(1, Math.min(selectedDiscardCount, game.discardPile.cards.length))
        const restOfPile = game.discardPile.cards.slice(0, game.discardPile.cards.length - count)
        const selectedDiscardIds = game.discardPile.cards.slice(game.discardPile.cards.length - count).map((c) => c.id)

        const result = attemptMeldAction({
          hand,
          team,
          selectedHandCardIds: selectedCardIds,
          targetMeldId: selectedMeldId,
          topTouch: { discardPile: game.discardPile.cards, selectedDiscardIds },
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

        const combinedHand = sortHand([...result.hand, ...restOfPile])
        const claim = tryClaimPozzetto(game, team, localPlayerId, combinedHand, 'meld-empty', combinedHand.length)

        const nextRoom = withTeam(room, team.id, (t) => ({ ...t, melds: meldsAfter, pozzetto: claim.pozzetto }))

        set({
          room: nextRoom,
          game: {
            ...game,
            discardPile: { cards: [] },
            pozzettoStacks: claim.pozzettoStacks,
            hands: { ...game.hands, [localPlayerId]: sortHand(claim.hand) },
            turn: { ...game.turn, phase: 'action', hasDrawnThisTurn: true },
            lastAcquired:
              restOfPile.length > 0
                ? { playerId: localPlayerId, cardIds: restOfPile.map((c) => c.id), at: Date.now() }
                : game.lastAcquired,
          },
          topTouchInProgress: false, selectedDiscardCount: 0,
          selectedCardIds: [],
          selectedMeldId: null,
          lastActionError: null,
        })
        return
      }

      // Normal in-hand meld (item 3): create a new meld or append to a
      // targeted existing one, auto-detecting Set vs Sequence.
      if (game.turn.phase !== 'action') {
        set({ lastActionError: 'You can only meld during your action phase (after drawing).' })
        return
      }
      if (selectedCardIds.length === 0 && !selectedMeldId) {
        set({ lastActionError: 'Select hand cards to meld, or a meld group to append to.' })
        return
      }
      if (selectedCardIds.length === 0) {
        set({ lastActionError: 'Select at least one hand card to meld.' })
        return
      }

      const result = attemptMeldAction({
        hand,
        team,
        selectedHandCardIds: selectedCardIds,
        targetMeldId: selectedMeldId,
      })

      if (!result.ok) {
        if (result.needsSlideChoice && selectedMeldId) {
          set({
            game: {
              ...game,
              pendingSlide: { teamId: team.id, meldId: selectedMeldId, displacedWildCardId: result.needsSlideChoice.displacedWildCardId },
            },
            lastActionError: null,
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

      const claim = tryClaimPozzetto(game, team, localPlayerId, result.hand, 'meld-empty', result.hand.length)

      const nextRoom = withTeam(room, team.id, (t) => ({ ...t, melds: meldsAfter, pozzetto: claim.pozzetto }))

      set({
        room: nextRoom,
        game: {
          ...game,
          pozzettoStacks: claim.pozzettoStacks,
          hands: { ...game.hands, [localPlayerId]: sortHand(claim.hand) },
        },
        selectedCardIds: [],
        selectedMeldId: null,
        lastActionError: null,
      })
    },

    moveWildInMeld: (meldId: string) => {
      const { game, room, localPlayerId } = get()
      if (!game || !room || !localPlayerId) return
      if (game.turn.activePlayerId !== localPlayerId) return
      const team = findTeamForPlayer(room, localPlayerId)
      if (!team) return
      const meld = team.melds.find((m) => m.id === meldId)
      if (!meld) return

      const result = moveWildEdgeInSet(meld)
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
      const { game, room, localPlayerId, selectedCardIds } = get()
      if (!game || !room || !localPlayerId || !game.pendingSlide) return
      const team = room.teams.find((t) => t.id === game.pendingSlide!.teamId)
      const meld = team?.melds.find((m) => m.id === game.pendingSlide!.meldId)
      if (!team || !meld || selectedCardIds.length !== 1) return

      const result = appendCardFromHand(game.hands[localPlayerId], selectedCardIds[0], meld, edge)
      if (!result.ok) {
        set({ lastActionError: result.error, game: { ...game, pendingSlide: null } })
        return
      }

      const handSizeAfterMeld = result.hand.length
      const claim = tryClaimPozzetto(game, team, localPlayerId, result.hand, 'meld-empty', handSizeAfterMeld)

      const nextRoom = withTeam(room, team.id, (t) => ({
        ...t,
        melds: t.melds.map((m) => (m.id === meld.id ? result.meld : m)),
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
        topTouchInProgress: false, selectedDiscardCount: 0,
        lastActionError: null,
      })
    },

    discardSelected: () => {
      const { game, room, localPlayerId, selectedCardIds } = get()
      if (!game || !room || !localPlayerId) return
      if (game.turn.activePlayerId !== localPlayerId) return
      if (game.turn.phase !== 'action' && game.turn.phase !== 'discard') return
      if (selectedCardIds.length !== 1) return

      const team = findTeamForPlayer(room, localPlayerId)
      if (!team) return

      const result = performDiscard(game.hands[localPlayerId], selectedCardIds[0], game.discardPile.cards)
      if (!result) return

      const wasClaimedBefore = team.pozzetto.claimed
      const claim = tryClaimPozzetto(game, team, localPlayerId, result.hand, 'discard', result.handSizeBeforeDiscard)
      const activated = wasClaimedBefore ? true : team.pozzetto.activated
      const finalPozzetto = { ...claim.pozzetto, activated }

      const nextRoom = withTeam(room, team.id, (t) => ({ ...t, pozzetto: finalPozzetto }))

      set({
        room: nextRoom,
        game: {
          ...game,
          discardPile: { cards: result.discardPile },
          pozzettoStacks: claim.pozzettoStacks,
          hands: { ...game.hands, [localPlayerId]: sortHand(claim.hand) },
          turn: advanceTurn(game, room, localPlayerId),
        },
        selectedCardIds: [],
        selectedMeldId: null,
        topTouchInProgress: false, selectedDiscardCount: 0,
        lastActionError: null,
      })

      setTimeout(() => get().actions._mockAdvanceUntilLocal(), BOT_BETWEEN_TURNS_MS)
    },

    declareShow: () => {
      const { game, room, localPlayerId, selectedCardIds } = get()
      if (!game || !room || !localPlayerId) return
      if (game.turn.activePlayerId !== localPlayerId || game.turn.phase !== 'action') return
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
        topTouchInProgress: false, selectedDiscardCount: 0,
        lastActionError: null,
      })
    },

    forceSuddenDeathEndRound: () => {
      const { room, game } = get()
      if (!room || !game) return
      if (game.stock.length !== 0) return
      const { room: scoredRoom, game: scoredGame } = endRoundWithScore(room, game, 'sudden-death', null)
      set({
        room: scoredRoom,
        game: scoredGame,
        selectedCardIds: [],
        selectedMeldId: null,
        topTouchInProgress: false,
        selectedDiscardCount: 0,
      })
    },

    // Fires when the visible per-player turn countdown reaches zero for the
    // local player. Mirrors the mock-AI's "simplest legal action" strategy:
    // draw if needed, then discard (preferring whatever the player already
    // had selected) so the turn always resolves instead of stalling.
    autoEndTurn: () => {
      const { game, room, localPlayerId, selectedCardIds } = get()
      if (!game || !room || !localPlayerId) return
      if (game.turn.activePlayerId !== localPlayerId) return
      if (room.status !== 'in-progress') return
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
          topTouchInProgress: false, selectedDiscardCount: 0,
          lastActionError: 'Time expired — turn skipped automatically.',
        })
        setTimeout(() => get().actions._mockAdvanceUntilLocal(), BOT_BETWEEN_TURNS_MS)
        return
      }

      const result = performDiscard(hand, cardIdToDiscard, game.discardPile.cards)
      if (!result) return

      const wasClaimedBefore = team.pozzetto.claimed
      const claim = tryClaimPozzetto(game, team, localPlayerId, result.hand, 'discard', result.handSizeBeforeDiscard)
      const activated = wasClaimedBefore ? true : team.pozzetto.activated
      const finalPozzetto = { ...claim.pozzetto, activated }
      const nextRoom = withTeam(room, team.id, (t) => ({ ...t, pozzetto: finalPozzetto }))

      set({
        room: nextRoom,
        game: {
          ...game,
          stock,
          discardPile: { cards: result.discardPile },
          pozzettoStacks: claim.pozzettoStacks,
          hands: { ...game.hands, [localPlayerId]: sortHand(claim.hand) },
          turn: advanceTurn(game, room, localPlayerId),
          lastAcquired,
        },
        selectedCardIds: [],
        selectedMeldId: null,
        topTouchInProgress: false, selectedDiscardCount: 0,
        lastActionError: 'Time expired — turn ended automatically.',
      })

      setTimeout(() => get().actions._mockAdvanceUntilLocal(), BOT_BETWEEN_TURNS_MS)
    },

    togglePauseTimer: () => {
      const { game } = get()
      if (!game) return

      if (game.turn.isPaused) {
        // Resume: shift `startedAt` forward by however long the pause
        // lasted, so the deadline (startedAt + turnTimerSeconds) moves out
        // by the same amount and the remaining time picks up exactly where
        // it was frozen, instead of resetting.
        const pausedDurationMs = game.turn.pausedAt != null ? Date.now() - game.turn.pausedAt : 0
        set({
          game: {
            ...game,
            turn: { ...game.turn, isPaused: false, pausedAt: null, startedAt: game.turn.startedAt + pausedDurationMs },
          },
        })
        return
      }

      set({ game: { ...game, turn: { ...game.turn, isPaused: true, pausedAt: Date.now() } } })
    },

    nextRound: () => {
      const { room, game } = get()
      if (!room || !game) return
      if (game.gameOverTeamId) {
        set({
          room: { ...room, status: 'lobby' },
          game: null,
          selectedCardIds: [],
          selectedMeldId: null,
          topTouchInProgress: false,
          selectedDiscardCount: 0,
        })
        return
      }
      botTurnGeneration += 1
      const teams = room.teams.map((t) => ({ ...t, melds: [], hasGoneOut: false, pozzetto: initialPozzettoState() }))
      const nextRoomState: RoomState = { ...room, teams, status: 'in-progress' }
      const nextGame = dealNewRound(nextRoomState)
      nextGame.round = game.round + 1
      nextGame.roundScoresHistory = game.roundScoresHistory
      set({ room: nextRoomState, game: nextGame, selectedCardIds: [], selectedMeldId: null, topTouchInProgress: false, selectedDiscardCount: 0, lastActionError: null })
      if (nextGame.turn.activePlayerId !== get().localPlayerId) {
        setTimeout(() => get().actions._mockAdvanceUntilLocal(), BOT_BETWEEN_TURNS_MS)
      }
    },

    returnToLobby: () => {
      const { room } = get()
      if (!room) return
      botTurnGeneration += 1
      set({
        room: { ...room, status: 'lobby' },
        game: null,
        selectedCardIds: [],
        selectedMeldId: null,
        topTouchInProgress: false, selectedDiscardCount: 0,
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
      void runMockBotTurn(get, set)
    },
  },
}))

type StoreGet = typeof useGameStore.getState
type StoreSet = typeof useGameStore.setState

async function runMockBotTurn(get: StoreGet, set: StoreSet): Promise<void> {
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

  // ----- 1) Draw from stock (face-down flight stock → bot hand stack) -----
  {
    const latest = get()
    if (!latest.game || isCancelled()) return
    let stock = latest.game.stock
    let hand = latest.game.hands[activeId]
    if (stock.length > 0) {
      const stockRect = getFlipAnchorRect('stock')
      const handRect = getFlipAnchorRect(handAnchor)
      const drawResult = performDrawFromStock(stock, hand)
      stock = drawResult.stock
      hand = drawResult.hand
      if (stockRect && handRect && drawResult.drawnCard) {
        void playDetachedCardFlight({ from: stockRect, to: handRect, faceDown: true })
      }
      set({
        game: {
          ...latest.game,
          stock,
          hands: { ...latest.game.hands, [activeId]: sortHand(hand) },
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
  }

  // Plan melds/appends/discard against the post-draw hand (single plan pass
  // so later steps don't re-greedily invent new melds mid-turn).
  {
    const latest = get()
    if (!latest.game || !latest.room || isCancelled()) return
    const currentTeam = findTeamForPlayer(latest.room, activeId)
    if (!currentTeam) return
    let hand = latest.game.hands[activeId]
    let melds = currentTeam.melds

    const meldPlans = planAiMelds(hand, currentTeam.id)
    // ----- 2) Lay each planned set, one animated action at a time -----
    for (const plan of meldPlans.plans) {
      const snap = get()
      if (!snap.game || !snap.room || isCancelled()) return
      const liveTeam = findTeamForPlayer(snap.room, activeId)
      if (!liveTeam) return
      hand = snap.game.hands[activeId]
      melds = liveTeam.melds
      const cards = hand.filter((c) => plan.cardIds.includes(c.id))
      if (cards.length !== plan.cardIds.length) continue
      for (const card of cards) seedFlipOriginFromAnchor(card.id, handAnchor)
      const built = createMeldFromHand(hand, plan.cardIds, 'set', liveTeam.id)
      if (!built.ok) continue
      hand = built.hand
      melds = [...melds, built.meld]
      const nextRoom = withTeam(snap.room, liveTeam.id, (t) => ({ ...t, melds }))
      set({
        room: nextRoom,
        game: {
          ...snap.game,
          hands: { ...snap.game.hands, [activeId]: sortHand(hand) },
        },
      })
      await sleepRespectingPause(BOT_ACTION_MS, isCancelled)
      if (isCancelled()) return
    }

    // ----- 3) Append single cards onto existing team melds -----
    {
      const snap = get()
      if (!snap.game || !snap.room || isCancelled()) return
      const liveTeam = findTeamForPlayer(snap.room, activeId)
      if (!liveTeam) return
      hand = snap.game.hands[activeId]
      melds = liveTeam.melds
      const appendPlans = planAiAppends(hand, melds)
      for (const plan of appendPlans.plans) {
        const step = get()
        if (!step.game || !step.room || isCancelled()) return
        const stepTeam = findTeamForPlayer(step.room, activeId)
        if (!stepTeam) return
        hand = step.game.hands[activeId]
        melds = stepTeam.melds
        const meld = melds.find((m) => m.id === plan.meldId)
        const card = hand.find((c) => c.id === plan.cardId)
        if (!meld || !card) continue
        seedFlipOriginFromAnchor(card.id, handAnchor)
        const result = appendCardFromHand(hand, plan.cardId, meld)
        // Skip Slide-choice appends (no UI prompt available for mock players).
        if (!result.ok) continue
        hand = result.hand
        melds = melds.map((m) => (m.id === meld.id ? result.meld : m))
        const nextRoom = withTeam(step.room, stepTeam.id, (t) => ({ ...t, melds }))
        set({
          room: nextRoom,
          game: {
            ...step.game,
            hands: { ...step.game.hands, [activeId]: sortHand(hand) },
          },
        })
        await sleepRespectingPause(BOT_ACTION_MS, isCancelled)
        if (isCancelled()) return
      }
    }

    // ----- 4) Discard (flight from bot hand stack → discard pile) -----
    {
      const snap = get()
      if (!snap.game || !snap.room || isCancelled()) return
      const liveTeam = findTeamForPlayer(snap.room, activeId)
      if (!liveTeam) return
      hand = snap.game.hands[activeId]
      const discardCard = pickAiDiscard(hand)
      if (discardCard) {
        seedFlipOriginFromAnchor(discardCard.id, handAnchor)
        const handSizeBeforeDiscard = hand.length
        const finalHand = hand.filter((c) => c.id !== discardCard.id)
        const discardPile = [...snap.game.discardPile.cards, discardCard]
        const claim = tryClaimPozzetto(
          snap.game,
          liveTeam,
          activeId,
          finalHand,
          'discard',
          handSizeBeforeDiscard,
        )
        const nextRoom = withTeam(snap.room, liveTeam.id, (t) => ({
          ...t,
          pozzetto: claim.pozzetto,
        }))
        const nextTurn = advanceTurn(snap.game, snap.room, activeId)
        set({
          room: nextRoom,
          game: {
            ...snap.game,
            hands: { ...snap.game.hands, [activeId]: sortHand(claim.hand) },
            discardPile: { cards: discardPile },
            pozzettoStacks: claim.pozzettoStacks,
            turn: nextTurn,
          },
        })
        await sleepRespectingPause(BOT_ACTION_MS, isCancelled)
        if (isCancelled()) return

        await sleepRespectingPause(BOT_BETWEEN_TURNS_MS, isCancelled)
        if (isCancelled()) return
        if (nextTurn.activePlayerId !== get().localPlayerId) {
          get().actions._mockAdvanceUntilLocal()
        }
        return
      }
    }
  }

  // No discard possible (empty hand) — still advance the turn.
  {
    const snap = get()
    if (!snap.game || !snap.room || isCancelled()) return
    const nextTurn = advanceTurn(snap.game, snap.room, activeId)
    set({ game: { ...snap.game, turn: nextTurn } })
    await sleepRespectingPause(BOT_BETWEEN_TURNS_MS, isCancelled)
    if (isCancelled()) return
    if (nextTurn.activePlayerId !== get().localPlayerId) {
      get().actions._mockAdvanceUntilLocal()
    }
  }
}
