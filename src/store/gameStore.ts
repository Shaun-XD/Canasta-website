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
import { buildShuffledDeck, dealHands, sortHand } from '../lib/deck'

/**
 * Mock/placeholder game store.
 *
 * This is the ONLY place that mutates room/game state on the client. That is
 * intentional: once a real server-authoritative rules engine exists, the
 * plan is to swap the body of these action functions for `socket.emit(...)`
 * calls (see `src/lib/socket.ts`) and have incoming server events call
 * `set(...)` here instead - the React components below should not need to
 * change at all, since they only ever call `useGameStore.getState().actions`.
 *
 * TODO(rules): every bit of "game logic" in this file (dealing size, meld
 * validity, turn advancement, going-out, scoring) is a plausible placeholder
 * only. None of it should be treated as final Canasta rules.
 */

const HAND_SIZE = 11 // TODO(rules): confirm real starting hand size
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

// Local player is always seat 0 / team-a. To make two balanced teams of two,
// exactly one mock player also joins team-a and the other two join team-b.
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
    melds: {},
    redThrees: [],
    score: 0,
    hasGoneOut: false,
  }))
}

interface GameStoreState {
  room: RoomState | null
  game: GameState | null
  localPlayerId: PlayerId | null
  selectedCardIds: string[]
  actions: {
    createRoom: (playerName: string) => string
    joinRoom: (roomId: string, playerName: string) => void
    setLocalTeam: (teamId: TeamId) => void
    setLocalSeat: (seat: number) => void
    toggleReady: () => void
    startGame: () => void
    toggleSelectCard: (cardId: string) => void
    clearSelection: () => void
    drawFromStock: () => void
    drawFromDiscard: () => void
    discardSelected: () => void
    layMeldFromSelection: () => void
    triggerRoundEnd: () => void
    nextRound: () => void
    returnToLobby: () => void
    /** @internal mock-only helper, not meant to be called by UI code directly */
    _mockAdvanceUntilLocal: () => void
  }
}

export const useGameStore = create<GameStoreState>((set, get) => ({
  room: null,
  game: null,
  localPlayerId: null,
  selectedCardIds: [],

  actions: {
    createRoom: (playerName: string) => {
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
        },
        game: null,
        localPlayerId: localPlayer.id,
        selectedCardIds: [],
      })

      return roomId
    },

    joinRoom: (roomId: string, playerName: string) => {
      // TODO(backend): real join flow will hit the server and receive the
      // authoritative room state back. For now we mock a room the same way
      // createRoom does, just keyed to the provided room code.
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
        },
        game: null,
        localPlayerId: localPlayer.id,
        selectedCardIds: [],
      })
    },

    setLocalTeam: (teamId: TeamId) => {
      const { room, localPlayerId } = get()
      if (!room || !localPlayerId) return
      const players = room.players.map((p) =>
        p.id === localPlayerId ? { ...p, teamId } : p,
      )
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
      const players = room.players.map((p) =>
        p.id === localPlayerId ? { ...p, isReady: !p.isReady } : p,
      )
      set({ room: { ...room, players } })
    },

    startGame: () => {
      const { room } = get()
      if (!room) return
      if (room.players.length < 4 || !room.players.every((p) => p.isReady)) return

      const playerIds = room.players.map((p) => p.id)
      const deck = buildShuffledDeck()
      const { hands, remaining } = dealHands(deck, playerIds, HAND_SIZE)
      const { hands: feet, remaining: stockAfterFeet } = dealHands(
        remaining,
        playerIds,
        HAND_SIZE,
      )

      const sortedHands: Record<string, CardModel[]> = {}
      for (const id of playerIds) sortedHands[id] = sortHand(hands[id])

      const hasPickedUpFoot: Record<string, boolean> = {}
      for (const id of playerIds) hasPickedUpFoot[id] = false

      const firstDiscard = stockAfterFeet.shift()

      const game: GameState = {
        roomId: room.roomId,
        stock: stockAfterFeet,
        discardPile: { cards: firstDiscard ? [firstDiscard] : [], isFrozen: false },
        hands: sortedHands,
        feet,
        hasPickedUpFoot,
        turn: { activePlayerId: playerIds[0], phase: 'draw', turnNumber: 1 },
        round: 1,
        lastRoundScores: null,
      }

      set({ room: { ...room, status: 'in-progress' }, game, selectedCardIds: [] })
    },

    toggleSelectCard: (cardId: string) => {
      const { selectedCardIds } = get()
      set({
        selectedCardIds: selectedCardIds.includes(cardId)
          ? selectedCardIds.filter((id) => id !== cardId)
          : [...selectedCardIds, cardId],
      })
    },

    clearSelection: () => set({ selectedCardIds: [] }),

    drawFromStock: () => {
      const { game, localPlayerId } = get()
      if (!game || !localPlayerId) return
      if (game.turn.activePlayerId !== localPlayerId || game.turn.phase !== 'draw') return
      if (game.stock.length === 0) return

      const stock = [...game.stock]
      const drawn = stock.pop() as CardModel
      const hands = {
        ...game.hands,
        [localPlayerId]: sortHand([...game.hands[localPlayerId], drawn]),
      }

      set({
        game: { ...game, stock, hands, turn: { ...game.turn, phase: 'meld' } },
      })
    },

    drawFromDiscard: () => {
      // TODO(rules): real Canasta discard pickup usually requires melding a
      // matching pair and follows "frozen pile" restrictions. This mock
      // version just lets the active player pick up the whole pile.
      const { game, localPlayerId } = get()
      if (!game || !localPlayerId) return
      if (game.turn.activePlayerId !== localPlayerId || game.turn.phase !== 'draw') return
      if (game.discardPile.cards.length === 0) return

      const pickedUp = game.discardPile.cards
      const hands = {
        ...game.hands,
        [localPlayerId]: sortHand([...game.hands[localPlayerId], ...pickedUp]),
      }

      set({
        game: {
          ...game,
          discardPile: { cards: [], isFrozen: false },
          hands,
          turn: { ...game.turn, phase: 'meld' },
        },
      })
    },

    discardSelected: () => {
      const { game, localPlayerId, selectedCardIds } = get()
      if (!game || !localPlayerId) return
      if (game.turn.activePlayerId !== localPlayerId) return
      if (selectedCardIds.length !== 1) return

      const [cardId] = selectedCardIds
      const hand = game.hands[localPlayerId]
      const card = hand.find((c) => c.id === cardId)
      if (!card) return

      const hands = {
        ...game.hands,
        [localPlayerId]: hand.filter((c) => c.id !== cardId),
      }
      const discardPile = { ...game.discardPile, cards: [...game.discardPile.cards, card] }

      const playerIds = Object.keys(game.hands)
      const currentIndex = playerIds.indexOf(localPlayerId)
      const nextPlayerId = playerIds[(currentIndex + 1) % playerIds.length]

      set({
        game: {
          ...game,
          hands,
          discardPile,
          turn: {
            activePlayerId: nextPlayerId,
            phase: 'draw',
            turnNumber: game.turn.turnNumber + 1,
          },
        },
        selectedCardIds: [],
      })

      // Mock round-robin "AI" turns for placeholder players so the demo can
      // be played solo. TODO(backend): remove once real players/server
      // drive opposing turns.
      setTimeout(() => get().actions._mockAdvanceUntilLocal(), 500)
    },

    layMeldFromSelection: () => {
      // TODO(rules): real meld validation (minimum card counts, point
      // thresholds, wild card limits, "going out" restrictions) is pending.
      // This mock only groups selected cards by matching rank as a
      // placeholder so the UI flow can be demonstrated end-to-end.
      const { game, room, localPlayerId, selectedCardIds } = get()
      if (!game || !room || !localPlayerId) return
      if (game.turn.activePlayerId !== localPlayerId) return
      if (selectedCardIds.length < 2) return

      const hand = game.hands[localPlayerId]
      const selectedCards = hand.filter((c) => selectedCardIds.includes(c.id))
      if (selectedCards.length < 2) return

      const rank = selectedCards.find((c) => c.rank !== 'JOKER')?.rank ?? selectedCards[0].rank
      const sameRank = selectedCards.every(
        (c) => c.rank === rank || c.rank === 'JOKER',
      )
      if (!sameRank) return // TODO(rules): support real sequence/wild-card melds

      const player = room.players.find((p) => p.id === localPlayerId)
      const teamId = player?.teamId
      if (!teamId) return

      const teams = room.teams.map((team) => {
        if (team.id !== teamId) return team
        const existing = team.melds[rank]
        const cards = existing ? [...existing.cards, ...selectedCards] : selectedCards
        return {
          ...team,
          melds: {
            ...team.melds,
            [rank]: { rank, cards, isCanasta: cards.length >= 7 },
          },
        }
      })

      const hands = {
        ...game.hands,
        [localPlayerId]: hand.filter((c) => !selectedCardIds.includes(c.id)),
      }

      set({
        room: { ...room, teams },
        game: { ...game, hands },
        selectedCardIds: [],
      })
    },

    triggerRoundEnd: () => {
      // Dev/test helper: real scoring is not implemented yet, so this just
      // fabricates plausible score numbers to demo the round-end overlay.
      const { room, game } = get()
      if (!room || !game) return
      const scores: Record<TeamId, number> = {
        'team-a': Math.floor(Math.random() * 400) + 50,
        'team-b': Math.floor(Math.random() * 400) + 50,
      }
      set({
        room: { ...room, status: 'round-end' },
        game: { ...game, lastRoundScores: scores },
      })
    },

    nextRound: () => {
      const { room } = get()
      if (!room) return
      set({ room: { ...room, status: 'lobby' }, game: null, selectedCardIds: [] })
    },

    returnToLobby: () => {
      const { room } = get()
      if (!room) return
      set({
        room: { ...room, status: 'lobby' },
        game: null,
        selectedCardIds: [],
      })
    },

    // Internal-only mock helper (not part of the public action surface, but
    // exposed via the actions object for simplicity). Advances turns for
    // mock/placeholder players until it's the local player's turn again, or
    // performs a trivial draw+discard for them.
    _mockAdvanceUntilLocal: () => {
      const { game, localPlayerId } = get()
      if (!game || !localPlayerId) return
      if (game.turn.activePlayerId === localPlayerId) return

      const activeId = game.turn.activePlayerId
      const stock = [...game.stock]
      const drawn = stock.length > 0 ? stock.pop()! : undefined
      const handWithDraw = drawn ? [...game.hands[activeId], drawn] : game.hands[activeId]

      const cardToDiscard = handWithDraw[Math.floor(Math.random() * handWithDraw.length)]
      const remainingHand = handWithDraw.filter((c) => c.id !== cardToDiscard.id)

      const hands = { ...game.hands, [activeId]: remainingHand }
      const discardPile = {
        ...game.discardPile,
        cards: [...game.discardPile.cards, cardToDiscard],
      }

      const playerIds = Object.keys(game.hands)
      const currentIndex = playerIds.indexOf(activeId)
      const nextPlayerId = playerIds[(currentIndex + 1) % playerIds.length]

      set({
        game: {
          ...game,
          stock,
          hands,
          discardPile,
          turn: {
            activePlayerId: nextPlayerId,
            phase: 'draw',
            turnNumber: game.turn.turnNumber + 1,
          },
        },
      })

      if (nextPlayerId !== localPlayerId) {
        setTimeout(() => get().actions._mockAdvanceUntilLocal(), 500)
      }
    },
  },
}))
