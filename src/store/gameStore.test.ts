import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { useGameStore } from './gameStore'
import { c } from '../engine/testHelpers'
import { buildSequence } from '../engine/meldValidation'
import type { CardModel, Meld } from '../types/game'

/**
 * Regression coverage for the "discard pile disappears on click" bug: the
 * root cause traced back to `useCardFlip` misreading scroll-only movement
 * as a real card move (see `useCardFlip.ts`), but this store-level test
 * guards the adjacent assumption the bug report asked to double-check -
 * that `toggleDiscardPileCard` only ever tracks selection ids and never
 * touches the discard pile's own card array.
 */
function startGameWithDiscardPile(discardCards: CardModel[]) {
  const { actions } = useGameStore.getState()
  actions.createRoom('Tester')
  actions.toggleReady()
  actions.startGame()

  const { game } = useGameStore.getState()
  if (!game) throw new Error('expected startGame() to produce a game')

  const topId = discardCards[discardCards.length - 1].id
  useGameStore.setState({
    game: { ...game, discardPile: { cards: discardCards } },
    topTouchInProgress: true,
    selectedDiscardIds: [topId],
  })
}

describe('toggleDiscardPileCard', () => {
  beforeEach(() => {
    useGameStore.setState({
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
  })

  it('never changes the discard pile array (length, contents, or identity) - only the selection ids', () => {
    const discardCards = [c('3', 'hearts'), c('4', 'hearts'), c('5', 'hearts')]
    startGameWithDiscardPile(discardCards)

    const pileBefore = useGameStore.getState().game!.discardPile.cards

    useGameStore.getState().actions.toggleDiscardPileCard(discardCards[1].id)

    const state = useGameStore.getState()
    expect(state.game!.discardPile.cards).toBe(pileBefore)
    expect(state.game!.discardPile.cards.length).toBe(3)
    expect(state.game!.discardPile.cards).toEqual(discardCards)
    expect(state.selectedDiscardIds).toEqual([discardCards[1].id, discardCards[2].id])
  })

  it('toggles a middle card independently without forcing neighboring cards selected', () => {
    const discardCards = [c('3', 'hearts'), c('4', 'hearts'), c('5', 'hearts'), c('6', 'hearts')]
    startGameWithDiscardPile(discardCards)

    // Select only the bottom-most card + top (skip the middle two).
    useGameStore.getState().actions.toggleDiscardPileCard(discardCards[0].id)
    expect(useGameStore.getState().selectedDiscardIds).toEqual([discardCards[0].id, discardCards[3].id])
    expect(useGameStore.getState().game!.discardPile.cards.length).toBe(4)

    useGameStore.getState().actions.toggleDiscardPileCard(discardCards[0].id)
    expect(useGameStore.getState().selectedDiscardIds).toEqual([discardCards[3].id])
    expect(useGameStore.getState().game!.discardPile.cards.length).toBe(4)
  })

  it('cannot deselect the top/most-recent discard card', () => {
    const discardCards = [c('3', 'hearts'), c('4', 'hearts'), c('5', 'hearts')]
    startGameWithDiscardPile(discardCards)
    const topId = discardCards[2].id

    useGameStore.getState().actions.toggleDiscardPileCard(topId)

    expect(useGameStore.getState().selectedDiscardIds).toEqual([topId])
  })

  it('is a no-op when no Top Touch is in progress', () => {
    const discardCards = [c('3', 'hearts'), c('4', 'hearts')]
    startGameWithDiscardPile(discardCards)
    useGameStore.setState({ topTouchInProgress: false, selectedDiscardIds: [] })

    useGameStore.getState().actions.toggleDiscardPileCard(discardCards[0].id)

    const state = useGameStore.getState()
    expect(state.selectedDiscardIds).toEqual([])
    expect(state.game!.discardPile.cards.length).toBe(2)
  })
})

describe('Show / Pozzetto activation on going out', () => {
  beforeEach(() => {
    useGameStore.setState({
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
  })

  function fakeCanasta(): import('../types/game').Meld {
    return {
      id: `m-${Math.random()}`,
      type: 'set',
      ownerTeamId: 'team-a',
      rank: '8',
      suit: null,
      slots: Array.from({ length: 7 }, (_, i) => ({
        card: c('8', i % 2 === 0 ? 'hearts' : 'spades'),
        slotRank: '8' as const,
        isWildFill: false,
      })),
      wildCount: 0,
      canBecomeLimpa: true,
      classification: 'mixed-canasta',
      isCanasta: true,
    }
  }

  it('activates Pozzetto on discard after claim, and auto-ends the round when Show conditions are met', () => {
    const { actions } = useGameStore.getState()
    actions.createRoom('Tester')
    actions.toggleReady()
    actions.startGame()

    const state = useGameStore.getState()
    const localId = state.localPlayerId!
    const room = state.room!
    const game = state.game!
    const team = room.teams.find((t) => t.playerIds.includes(localId))!
    const lastCard = c('3', 'clubs')

    useGameStore.setState({
      room: {
        ...room,
        teams: room.teams.map((t) =>
          t.id === team.id
            ? {
                ...t,
                melds: [fakeCanasta(), fakeCanasta(), fakeCanasta()],
                pozzetto: { claimed: true, claimedByPlayerId: localId, activated: false },
              }
            : t,
        ),
      },
      game: {
        ...game,
        hands: { ...game.hands, [localId]: [lastCard] },
        turn: {
          ...game.turn,
          activePlayerId: localId,
          phase: 'action',
          hasDrawnThisTurn: true,
        },
      },
      selectedCardIds: [lastCard.id],
    })

    useGameStore.getState().actions.discardSelected()

    const after = useGameStore.getState()
    const teamAfter = after.room!.teams.find((t) => t.id === team.id)!
    expect(teamAfter.pozzetto.activated).toBe(true)
    expect(after.room!.status).toBe('round-end')
    expect(after.game!.lastRoundScores?.endingType).toBe('show')
    expect(after.game!.lastRoundScores?.showingTeamId).toBe(team.id)
  })

  it('teammate bot claims Pozzetto when discarding their last card', async () => {
    vi.useFakeTimers()
    const { actions } = useGameStore.getState()
    actions.createRoom('Tester')
    actions.toggleReady()
    actions.startGame()

    const state = useGameStore.getState()
    const room = state.room!
    const game = state.game!
    const teammate = room.players.find((p) => p.name === 'Teammate (bot)')!
    expect(teammate.teamId).toBe('team-a')
    const team = room.teams.find((t) => t.id === 'team-a')!
    const lastCard = c('3', 'clubs')
    const reserve = Array.from({ length: 11 }, (_, i) => c('4', i % 2 === 0 ? 'hearts' : 'spades'))

    useGameStore.setState({
      room: {
        ...room,
        teams: room.teams.map((t) =>
          t.id === team.id
            ? { ...t, pozzetto: { claimed: false, claimedByPlayerId: null, activated: false } }
            : t,
        ),
      },
      game: {
        ...game,
        discardPile: { cards: [] },
        pozzettoStacks: { ...game.pozzettoStacks, 'team-a': reserve },
        hands: { ...game.hands, [teammate.id]: [lastCard] },
        turn: {
          ...game.turn,
          activePlayerId: teammate.id,
          phase: 'action',
          hasDrawnThisTurn: true,
        },
      },
    })

    useGameStore.getState().actions._mockAdvanceUntilLocal()
    for (let i = 0; i < 30; i += 1) {
      await vi.advanceTimersByTimeAsync(1400 + 20)
      const after = useGameStore.getState()
      const teamAfter = after.room!.teams.find((t) => t.id === 'team-a')!
      if (teamAfter.pozzetto.claimed) break
    }
    vi.useRealTimers()

    const after = useGameStore.getState()
    const teamAfter = after.room!.teams.find((t) => t.id === 'team-a')!
    expect(teamAfter.pozzetto.claimed).toBe(true)
    expect(teamAfter.pozzetto.claimedByPlayerId).toBe(teammate.id)
    expect(after.game!.pozzettoStacks['team-a']).toHaveLength(0)
    // Reserve joined the teammate's hand after the final discard.
    expect(after.game!.hands[teammate.id]).toHaveLength(11)
  })

  it('teammate bot claims Pozzetto mid-turn when melding empties their hand', async () => {
    vi.useFakeTimers()
    const { actions } = useGameStore.getState()
    actions.createRoom('Tester')
    actions.toggleReady()
    actions.startGame()

    const state = useGameStore.getState()
    const room = state.room!
    const game = state.game!
    const teammate = room.players.find((p) => p.name === 'Teammate (bot)')!
    const team = room.teams.find((t) => t.id === 'team-a')!
    // Existing set of 8s — bot appends three more 8s and empties the hand.
    const existing = fakeCanasta()
    existing.slots = existing.slots.slice(0, 3)
    existing.isCanasta = false
    existing.classification = 'in-progress'
    const handEights = [c('8', 'hearts'), c('8', 'spades'), c('8', 'clubs')]
    const reserve = Array.from({ length: 11 }, (_, i) => c('5', i % 2 === 0 ? 'diamonds' : 'clubs'))

    useGameStore.setState({
      room: {
        ...room,
        teams: room.teams.map((t) =>
          t.id === team.id
            ? {
                ...t,
                melds: [existing],
                pozzetto: { claimed: false, claimedByPlayerId: null, activated: false },
              }
            : t,
        ),
      },
      game: {
        ...game,
        discardPile: { cards: [] },
        pozzettoStacks: { ...game.pozzettoStacks, 'team-a': reserve },
        hands: { ...game.hands, [teammate.id]: handEights },
        turn: {
          ...game.turn,
          activePlayerId: teammate.id,
          phase: 'action',
          hasDrawnThisTurn: true,
        },
      },
    })

    useGameStore.getState().actions._mockAdvanceUntilLocal()
    for (let i = 0; i < 40; i += 1) {
      await vi.advanceTimersByTimeAsync(1400 + 20)
      const after = useGameStore.getState()
      const teamAfter = after.room!.teams.find((t) => t.id === 'team-a')!
      if (teamAfter.pozzetto.claimed) break
    }
    vi.useRealTimers()

    const after = useGameStore.getState()
    const teamAfter = after.room!.teams.find((t) => t.id === 'team-a')!
    expect(teamAfter.pozzetto.claimed).toBe(true)
    expect(teamAfter.pozzetto.claimedByPlayerId).toBe(teammate.id)
    expect(after.game!.pozzettoStacks['team-a']).toHaveLength(0)
  })

  it('bot discard after Pozzetto claim activates the reserve (so Show is possible)', async () => {
    vi.useFakeTimers()
    const { actions } = useGameStore.getState()
    actions.createRoom('Tester')
    actions.toggleReady()
    actions.startGame()

    const state = useGameStore.getState()
    const localId = state.localPlayerId!
    const room = state.room!
    const game = state.game!
    const botId = room.players.find((p) => p.id !== localId)!.id
    const botTeam = room.teams.find((t) => t.playerIds.includes(botId))!
    const discardCard = c('4', 'diamonds')

    // Claimed but not activated — mirrors the stuck "Pozzetto claimed" UI state.
    // Phase draw with empty discard so the bot must draw stock then discard.
    useGameStore.setState({
      room: {
        ...room,
        teams: room.teams.map((t) =>
          t.id === botTeam.id
            ? {
                ...t,
                melds: [fakeCanasta(), fakeCanasta(), fakeCanasta()],
                pozzetto: { claimed: true, claimedByPlayerId: botId, activated: false },
              }
            : t,
        ),
      },
      game: {
        ...game,
        discardPile: { cards: [] },
        hands: { ...game.hands, [botId]: [discardCard, c('5', 'clubs')] },
        turn: {
          ...game.turn,
          activePlayerId: botId,
          phase: 'draw',
          hasDrawnThisTurn: false,
        },
      },
    })

    useGameStore.getState().actions._mockAdvanceUntilLocal()
    for (let i = 0; i < 20; i += 1) {
      await vi.advanceTimersByTimeAsync(1400 + 20)
      const after = useGameStore.getState()
      const teamAfter = after.room!.teams.find((t) => t.id === botTeam.id)!
      if (teamAfter.pozzetto.activated || after.room!.status === 'round-end') break
    }
    vi.useRealTimers()

    const after = useGameStore.getState()
    const teamAfter = after.room!.teams.find((t) => t.id === botTeam.id)!
    expect(teamAfter.pozzetto.activated || after.room!.status === 'round-end').toBe(true)
  })
})

describe('mock/bot turn pacing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useGameStore.setState({
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
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('plays a mock turn as paced steps (not one instant jump) and waits ~500ms before the next mock player', async () => {
    const { actions } = useGameStore.getState()
    actions.createRoom('Tester')
    actions.toggleReady()
    actions.startGame()

    const started = useGameStore.getState()
    expect(started.game).toBeTruthy()
    expect(started.room).toBeTruthy()
    const localId = started.localPlayerId!
    // Force the active player to be a mock so _mockAdvanceUntilLocal has work.
    const mockId = started.room!.players.find((p) => p.id !== localId)!.id
    const stockBefore = started.game!.stock.length
    const mockHandBefore = started.game!.hands[mockId].length

    useGameStore.setState({
      game: {
        ...started.game!,
        turn: {
          ...started.game!.turn,
          activePlayerId: mockId,
          phase: 'draw',
          hasDrawnThisTurn: false,
          startedAt: Date.now(),
          isPaused: false,
          pausedAt: null,
        },
      },
    })

    // Kick the paced bot turn.
    useGameStore.getState().actions._mockAdvanceUntilLocal()

    // Immediately after kickoff (before any await timers), the draw step may
    // already have applied synchronously up to the first sleep - advance
    // just past one action duration and confirm the bot has drawn.
    await vi.advanceTimersByTimeAsync(1400 + 20) // BOT_ACTION_MS

    const afterDraw = useGameStore.getState()
    // Either stock draw or Top Touch counts as the bot's draw step.
    const stockShrunk = afterDraw.game!.stock.length < stockBefore
    const discardShrunk =
      afterDraw.game!.discardPile.cards.length < started.game!.discardPile.cards.length
    const turnedOver = afterDraw.game!.turn.activePlayerId !== mockId
    const handChanged = afterDraw.game!.hands[mockId].length !== mockHandBefore
    expect(stockShrunk || discardShrunk || turnedOver || handChanged).toBe(true)

    // Drain the rest of the turn (melds/appends/discard + 500ms gap) and any
    // subsequent mock turns until it loops back (cap so we don't spin forever).
    for (let i = 0; i < 60; i += 1) {
      await vi.advanceTimersByTimeAsync(1400 + 600)
      if (useGameStore.getState().game?.turn.activePlayerId === localId) break
    }

    expect(useGameStore.getState().game!.turn.activePlayerId).toBe(localId)
  })
})

describe('local stock draw', () => {
  beforeEach(() => {
    useGameStore.setState({
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
  })

  it('adds one card to the hand and sets phase to action', () => {
    const { actions } = useGameStore.getState()
    actions.createRoom('Tester')
    actions.toggleReady()
    actions.startGame()

    const before = useGameStore.getState()
    const localId = before.localPlayerId!
    const handLen = before.game!.hands[localId].length
    const stockLen = before.game!.stock.length
    expect(before.game!.turn.phase).toBe('draw')
    expect(before.game!.turn.activePlayerId).toBe(localId)

    actions.drawFromStock()

    const after = useGameStore.getState()
    expect(after.game!.hands[localId].length).toBe(handLen + 1)
    expect(after.game!.stock.length).toBe(stockLen - 1)
    expect(after.game!.turn.phase).toBe('action')
    expect(after.game!.turn.hasDrawnThisTurn).toBe(true)
  })
})

describe('Top Touch meld from the discard pile', () => {
  beforeEach(() => {
    useGameStore.setState({
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
  })

  function setupDrawTurn(opts: {
    discardCards: CardModel[]
    hand: CardModel[]
    existingMeld?: Meld
  }) {
    const { actions } = useGameStore.getState()
    actions.createRoom('Tester')
    actions.toggleReady()
    actions.startGame()

    const state = useGameStore.getState()
    const localId = state.localPlayerId!
    const game = state.game!
    const room = state.room!
    const topId = opts.discardCards[opts.discardCards.length - 1].id
    const team = room.teams.find((t) => t.playerIds.includes(localId))!
    const nextRoom = opts.existingMeld
      ? {
          ...room,
          teams: room.teams.map((t) => (t.id === team.id ? { ...t, melds: [opts.existingMeld!] } : t)),
        }
      : room

    useGameStore.setState({
      playMode: 'solo',
      room: nextRoom,
      game: {
        ...game,
        discardPile: { cards: opts.discardCards },
        hands: { ...game.hands, [localId]: opts.hand },
        turn: {
          ...game.turn,
          activePlayerId: localId,
          phase: 'draw',
          hasDrawnThisTurn: false,
          isPaused: true,
        },
      },
      topTouchInProgress: true,
      selectedDiscardIds: [topId],
      selectedCardIds: [],
      selectedMeldId: null,
      lastActionError: null,
    })
    return localId
  }

  it('melds three discard cards with no hand cards selected', () => {
    const discardCards = [c('4', 'hearts'), c('4', 'spades'), c('4', 'clubs')]
    const localId = setupDrawTurn({ discardCards, hand: [c('3', 'diamonds')] })

    useGameStore.getState().actions.toggleDiscardPileCard(discardCards[0].id)
    useGameStore.getState().actions.toggleDiscardPileCard(discardCards[1].id)
    expect(useGameStore.getState().selectedDiscardIds).toHaveLength(3)

    useGameStore.getState().actions.attemptMeld()

    const after = useGameStore.getState()
    expect(after.lastActionError).toBeNull()
    expect(after.topTouchInProgress).toBe(false)
    expect(after.game!.discardPile.cards).toEqual([])
    expect(after.game!.turn.phase).toBe('action')
    const team = after.room!.teams.find((t) => t.playerIds.includes(localId))!
    expect(team.melds).toHaveLength(1)
    expect(team.melds[0].type).toBe('set')
    expect(team.melds[0].rank).toBe('4')
    expect(team.melds[0].slots).toHaveLength(3)
    expect(after.game!.hands[localId].map((card) => card.rank)).toEqual(['3'])
  })

  it('melds two discard cards plus one hand card', () => {
    const buried = c('5', 'hearts')
    const top = c('5', 'clubs')
    const handFive = c('5', 'spades')
    const localId = setupDrawTurn({
      discardCards: [c('K', 'diamonds'), buried, top],
      hand: [handFive, c('3', 'diamonds')],
    })

    useGameStore.getState().actions.toggleDiscardPileCard(buried.id)
    useGameStore.setState({ selectedCardIds: [handFive.id] })
    useGameStore.getState().actions.attemptMeld()

    const after = useGameStore.getState()
    expect(after.lastActionError).toBeNull()
    const team = after.room!.teams.find((t) => t.playerIds.includes(localId))!
    expect(team.melds[0].rank).toBe('5')
    expect(team.melds[0].slots).toHaveLength(3)
    expect(after.game!.hands[localId].some((card) => card.id === handFive.id)).toBe(false)
  })

  it('appends multiple discard cards onto an existing sequence', () => {
    const existing = buildSequence(
      [c('5', 'spades'), c('6', 'spades'), c('7', 'spades')],
      'team-a',
    )
    if (!existing.ok) throw new Error('setup failed')
    const eight = c('8', 'spades')
    const nine = c('9', 'spades')
    const localId = setupDrawTurn({
      discardCards: [eight, nine],
      hand: [c('3', 'diamonds')],
      existingMeld: existing.meld,
    })

    useGameStore.getState().actions.toggleDiscardPileCard(eight.id)
    useGameStore.setState({ selectedMeldId: existing.meld.id })
    useGameStore.getState().actions.attemptMeld()

    const after = useGameStore.getState()
    expect(after.lastActionError).toBeNull()
    const team = after.room!.teams.find((t) => t.playerIds.includes(localId))!
    expect(team.melds[0].slots.map((s) => s.slotRank)).toEqual(['5', '6', '7', '8', '9'])
  })
})
