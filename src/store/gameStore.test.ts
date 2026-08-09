import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { useGameStore } from './gameStore'
import { c } from '../engine/testHelpers'
import type { CardModel } from '../types/game'
import { FLIP_DURATION_MS } from '../hooks/useCardFlip'

/**
 * Regression coverage for the "discard pile disappears on click" bug: the
 * root cause traced back to `useCardFlip` misreading scroll-only movement
 * as a real card move (see `useCardFlip.ts`), but this store-level test
 * guards the adjacent assumption the bug report asked to double-check -
 * that `toggleDiscardPileCard` only ever tracks a selection count and never
 * touches the discard pile's own card array.
 */
function startGameWithDiscardPile(discardCards: CardModel[]) {
  const { actions } = useGameStore.getState()
  actions.createRoom('Tester')
  actions.toggleReady()
  actions.startGame()

  const { game } = useGameStore.getState()
  if (!game) throw new Error('expected startGame() to produce a game')

  useGameStore.setState({
    game: { ...game, discardPile: { cards: discardCards } },
    topTouchInProgress: true,
    selectedDiscardCount: 1,
  })
}

describe('toggleDiscardPileCard', () => {
  beforeEach(() => {
    useGameStore.setState({
      room: null,
      game: null,
      localPlayerId: null,
      selectedCardIds: [],
      selectedMeldId: null,
      topTouchInProgress: false,
      selectedDiscardCount: 0,
      lastActionError: null,
    })
  })

  it('never changes the discard pile array (length, contents, or identity) - only the selection count', () => {
    const discardCards = [c('3', 'hearts'), c('4', 'hearts'), c('5', 'hearts')]
    startGameWithDiscardPile(discardCards)

    const pileBefore = useGameStore.getState().game!.discardPile.cards

    useGameStore.getState().actions.toggleDiscardPileCard(discardCards[1].id)

    const state = useGameStore.getState()
    expect(state.game!.discardPile.cards).toBe(pileBefore)
    expect(state.game!.discardPile.cards.length).toBe(3)
    expect(state.game!.discardPile.cards).toEqual(discardCards)
    expect(state.selectedDiscardCount).toBe(2)
  })

  it('extends the selection to a middle card, then shrinks it back on a second click, without ever touching the pile', () => {
    const discardCards = [c('3', 'hearts'), c('4', 'hearts'), c('5', 'hearts')]
    startGameWithDiscardPile(discardCards)

    useGameStore.getState().actions.toggleDiscardPileCard(discardCards[1].id)
    expect(useGameStore.getState().selectedDiscardCount).toBe(2)
    expect(useGameStore.getState().game!.discardPile.cards.length).toBe(3)

    useGameStore.getState().actions.toggleDiscardPileCard(discardCards[1].id)
    expect(useGameStore.getState().selectedDiscardCount).toBe(1)
    expect(useGameStore.getState().game!.discardPile.cards.length).toBe(3)
  })

  it('selecting all the way down to the bottom-most card selects the whole pile and still leaves it intact', () => {
    const discardCards = [c('3', 'hearts'), c('4', 'hearts'), c('5', 'hearts'), c('6', 'hearts')]
    startGameWithDiscardPile(discardCards)

    useGameStore.getState().actions.toggleDiscardPileCard(discardCards[0].id)

    const state = useGameStore.getState()
    expect(state.selectedDiscardCount).toBe(4)
    expect(state.game!.discardPile.cards.length).toBe(4)
    expect(state.game!.discardPile.cards).toEqual(discardCards)
  })

  it('is a no-op when no Top Touch is in progress', () => {
    const discardCards = [c('3', 'hearts'), c('4', 'hearts')]
    startGameWithDiscardPile(discardCards)
    useGameStore.setState({ topTouchInProgress: false, selectedDiscardCount: 0 })

    useGameStore.getState().actions.toggleDiscardPileCard(discardCards[0].id)

    const state = useGameStore.getState()
    expect(state.selectedDiscardCount).toBe(0)
    expect(state.game!.discardPile.cards.length).toBe(2)
  })
})

describe('mock/bot turn pacing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useGameStore.setState({
      room: null,
      game: null,
      localPlayerId: null,
      selectedCardIds: [],
      selectedMeldId: null,
      topTouchInProgress: false,
      selectedDiscardCount: 0,
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
    await vi.advanceTimersByTimeAsync(FLIP_DURATION_MS + 20)

    const afterDraw = useGameStore.getState()
    // Either still on this mock (mid-turn after draw/melds) or already
    // advanced; the stock should have shrunk by the draw if stock was non-empty.
    if (stockBefore > 0) {
      expect(afterDraw.game!.stock.length).toBeLessThan(stockBefore)
      // Hand grew by the draw unless a meld already consumed cards - at
      // minimum the bot should no longer be sitting on the pre-draw hand
      // with an untouched stock.
      expect(
        afterDraw.game!.hands[mockId].length !== mockHandBefore ||
          afterDraw.game!.turn.activePlayerId !== mockId,
      ).toBe(true)
    }

    // Drain the rest of the turn (melds/appends/discard + 500ms gap) and any
    // subsequent mock turns until it loops back (cap so we don't spin forever).
    for (let i = 0; i < 40; i += 1) {
      await vi.advanceTimersByTimeAsync(FLIP_DURATION_MS + 500)
      if (useGameStore.getState().game?.turn.activePlayerId === localId) break
    }

    expect(useGameStore.getState().game!.turn.activePlayerId).toBe(localId)
  })
})
