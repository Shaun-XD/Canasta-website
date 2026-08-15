import type { CardModel, Meld, PlayerId, Team, TeamId } from '../types/game'
import { appendToMeld, buildSequence, buildSet, type AppendContext } from './meldValidation'

export const TOP_TOUCH_FAILURE_PENALTY = 150

export function getNextPlayerId(orderedPlayerIds: PlayerId[], currentPlayerId: PlayerId): PlayerId {
  const idx = orderedPlayerIds.indexOf(currentPlayerId)
  return orderedPlayerIds[(idx + 1) % orderedPlayerIds.length]
}

// ---------------------------------------------------------------------------
// Phase 1: Draw
// ---------------------------------------------------------------------------

export function performDrawFromStock(
  stock: CardModel[],
  hand: CardModel[],
): { stock: CardModel[]; hand: CardModel[]; drawnCard: CardModel | null } {
  if (stock.length === 0) return { stock, hand, drawnCard: null }
  const nextStock = [...stock]
  const drawn = nextStock.pop() as CardModel
  return { stock: nextStock, hand: [...hand, drawn], drawnCard: drawn }
}

export type TopTouchPlan =
  | { kind: 'newSet'; handCardIds: string[] }
  | { kind: 'newSequence'; handCardIds: string[] }
  | { kind: 'append'; targetMeldId: string }

export interface TopTouchSuccess {
  success: true
  hand: CardModel[]
  discardPile: CardModel[]
  melds: Meld[]
}

export interface TopTouchFailureResult {
  success: false
  error: string
  penaltyTeamId: TeamId
  discardPile: CardModel[]
}

export type TopTouchResult = TopTouchSuccess | TopTouchFailureResult

/**
 * Validates + executes a Top Touch attempt (section 4, Phase 1).
 *
 * On success: the top card is placed per `plan`, and the REST of the
 * discard pile is drawn into the acting player's hand.
 *
 * On failure: all discard pile cards are returned to the discard pile
 * (i.e. nothing changes there), the opposing team is awarded +150 points,
 * and the caller must forfeit the rest of this player's turn (no Phase 2/3).
 */
export function performTopTouch(params: {
  hand: CardModel[]
  discardPile: CardModel[]
  team: Team
  opposingTeamId: TeamId
  plan: TopTouchPlan
}): TopTouchResult {
  const { hand, discardPile, team, opposingTeamId, plan } = params
  if (discardPile.length === 0) {
    return {
      success: false,
      error: 'Discard pile is empty.',
      penaltyTeamId: opposingTeamId,
      discardPile,
    }
  }
  const topCard = discardPile[discardPile.length - 1]
  const restOfPile = discardPile.slice(0, -1)

  if (plan.kind === 'append') {
    const meld = team.melds.find((m) => m.id === plan.targetMeldId)
    if (!meld) {
      return {
        success: false,
        error: 'Target meld not found on your team.',
        penaltyTeamId: opposingTeamId,
        discardPile,
      }
    }
    // Top Touch is a single atomic action, so if placing the top card would
    // trigger a Slide, default to the top edge automatically rather than
    // pausing for a UI prompt mid-pickup.
    const appendCtx: AppendContext = { team, handSize: hand.length + 1 }
    const result = appendToMeld(meld, topCard, 'top', appendCtx)
    if (!result.ok) {
      return {
        success: false,
        error: result.error,
        penaltyTeamId: opposingTeamId,
        discardPile,
      }
    }
    const melds = team.melds.map((m) => (m.id === meld.id ? result.meld : m))
    return {
      success: true,
      hand: [...hand, ...restOfPile],
      discardPile: [],
      melds,
    }
  }

  // newSet / newSequence: combine selected hand cards + the top card.
  const selected = hand.filter((c) => plan.handCardIds.includes(c.id))
  if (selected.length !== plan.handCardIds.length) {
    return {
      success: false,
      error: 'Selected cards are not all in hand.',
      penaltyTeamId: opposingTeamId,
      discardPile,
    }
  }
  const candidateCards = [...selected, topCard]
  const buildResult = plan.kind === 'newSet' ? buildSet(candidateCards, team.id) : buildSequence(candidateCards, team.id)
  if (!buildResult.ok) {
    return {
      success: false,
      error: buildResult.error,
      penaltyTeamId: opposingTeamId,
      discardPile,
    }
  }

  const remainingHand = hand.filter((c) => !plan.handCardIds.includes(c.id))
  return {
    success: true,
    hand: [...remainingHand, ...restOfPile],
    discardPile: [],
    melds: [...team.melds, buildResult.meld],
  }
}

// ---------------------------------------------------------------------------
// Unified meld action (single "Meld" button - see item 3/5/8)
// ---------------------------------------------------------------------------

export interface TopTouchSelection {
  /** The full discard pile, oldest-first / most-recent (top) last - same shape as `GameState['discardPile'].cards`. */
  discardPile: CardModel[]
  /**
   * Ids of the discard-pile cards the player has selected as meld candidates.
   * Must include the top/most-recent card's id (you cannot pick up the pile
   * unless that card is part of the unlocking meld). Other pile cards may be
   * included individually — selection does not need to be a contiguous
   * top-down run. Unselected pile cards still join the hand on success.
   */
  selectedDiscardIds: string[]
}

export interface MeldActionParams {
  hand: CardModel[]
  team: Team
  /** Hand cards the player has selected. */
  selectedHandCardIds: string[]
  /** An existing meld group the player has targeted to append to, or null to create a new meld. */
  targetMeldId: string | null
  /**
   * Present when this action is the "propose a meld with the top of the
   * discard pile" step of a two-phase Top Touch (see item 5). The selected
   * discard cards are combined with `selectedHandCardIds` as extra
   * candidate cards; omit/null for a normal in-hand-only meld action.
   */
  topTouch?: TopTouchSelection | null
  /** Only meaningful for a single-card append to a Sequence; see the Slide mechanic. */
  slideEdge?: 'top' | 'bottom'
}

export type MeldActionResult =
  | { ok: true; kind: 'new-meld'; hand: CardModel[]; meld: Meld; usedDiscardCards: CardModel[] }
  | { ok: true; kind: 'append'; hand: CardModel[]; meld: Meld; usedDiscardCards: CardModel[] }
  | { ok: false; error: string; needsSlideChoice?: { displacedWildCardId: string } }

/**
 * Top Touch invariant (humans and bots): picking up the discard pile requires
 * that the unlocking meld/append includes the current top discard card.
 */
export function topDiscardMustBePlayed(
  discardPile: CardModel[],
  selectedDiscardIds: string[],
): { ok: true; topCard: CardModel } | { ok: false; error: string } {
  if (discardPile.length === 0) {
    return { ok: false, error: 'Discard pile is empty.' }
  }
  if (selectedDiscardIds.length === 0) {
    return { ok: false, error: 'The top discard card must be included in the meld.' }
  }
  const topCard = discardPile[discardPile.length - 1]
  if (!selectedDiscardIds.includes(topCard.id)) {
    return { ok: false, error: 'The top discard card must be included in the meld.' }
  }
  return { ok: true, topCard }
}

/**
 * Resolves a Top Touch selection into the ordered list of discard cards it
 * refers to. The top card must be included; other selected cards may be any
 * subset of the pile (including non-contiguous). Unknown ids are rejected.
 */
function resolveTopTouchCards(selection: TopTouchSelection): { ok: true; cards: CardModel[] } | { ok: false; error: string } {
  const { discardPile, selectedDiscardIds } = selection
  const topCheck = topDiscardMustBePlayed(discardPile, selectedDiscardIds)
  if (!topCheck.ok) return topCheck

  const selectedSet = new Set(selectedDiscardIds)
  if (selectedSet.size !== selectedDiscardIds.length) {
    return { ok: false, error: 'Discard selection contains duplicate cards.' }
  }
  const cards = discardPile.filter((c) => selectedSet.has(c.id))
  if (cards.length !== selectedSet.size) {
    return { ok: false, error: 'Selected discard cards are not all in the pile.' }
  }

  return { ok: true, cards }
}

/**
 * The single entry point behind the unified "Meld" button (item 3) and the
 * "Meld with Top Card" step of the two-phase Top Touch flow (item 5).
 *
 * - If `targetMeldId` is set, every candidate card (selected hand cards,
 *   plus any selected Top Touch discard cards) is appended to that meld in
 *   turn. This also transparently covers the wild-swap case (item 8):
 *   appending a natural card that matches a Sequence's wild-occupied slot
 *   triggers the existing Slide mechanic, which naturalizes that slot and
 *   relocates the wild to an edge - the wild remains in the meld and can
 *   then be repositioned via Move Wild (item 7, Sets only).
 * - If `targetMeldId` is null, the candidate cards must form a legal new Set
 *   or Sequence on their own; the type is auto-detected (Set is tried
 *   first, then Sequence) rather than pre-declared by the user. There is no
 *   separate minimum-card-count gate here beyond what `buildSet` /
 *   `buildSequence` themselves require (3+) - the only real constraint is
 *   "the combined candidate set forms a legal meld or legal append".
 */
export function attemptMeldAction(params: MeldActionParams): MeldActionResult {
  const { hand, team, selectedHandCardIds, targetMeldId, topTouch = null, slideEdge } = params

  const selected = hand.filter((c) => selectedHandCardIds.includes(c.id))
  if (selected.length !== selectedHandCardIds.length) {
    return { ok: false, error: 'Selected cards are not all in hand.' }
  }

  let topTouchCards: CardModel[] = []
  if (topTouch) {
    const resolved = resolveTopTouchCards(topTouch)
    if (!resolved.ok) return { ok: false, error: resolved.error }
    topTouchCards = resolved.cards
  }

  const candidateCards = [...selected, ...topTouchCards]
  if (candidateCards.length === 0) {
    return { ok: false, error: 'Select at least one card to meld.' }
  }
  const remainingHand = hand.filter((c) => !selectedHandCardIds.includes(c.id))

  if (targetMeldId) {
    const meld = team.melds.find((m) => m.id === targetMeldId)
    if (!meld) return { ok: false, error: 'Target meld not found on your team.' }

    // A single hand-only append (the common case) preserves the original
    // slide-choice prompt UX; combining multiple cards or any Top Touch
    // discard cards auto-resolves any Slide to the top edge rather than
    // pausing for a mid-pickup UI prompt (mirrors the prior Top Touch
    // behavior).
    const autoResolveSlide = topTouchCards.length > 0 || candidateCards.length > 1
    const effectiveSlideEdge = slideEdge ?? (autoResolveSlide ? 'top' : undefined)

    let working = meld
    // Limpa exception uses hand size before each append (1 = last card).
    let handSize = hand.length
    // Append in any order so 8 then 9 (or 9 then 8) can both land on a canasta.
    const pending = [...candidateCards]
    while (pending.length > 0) {
      let progressed = false
      let lastError = 'Those cards cannot all be added to this meld.'
      for (let i = 0; i < pending.length; i += 1) {
        const card = pending[i]
        const result = appendToMeld(working, card, effectiveSlideEdge, { team, handSize })
        if (result.ok) {
          working = result.meld
          if (selectedHandCardIds.includes(card.id)) handSize -= 1
          pending.splice(i, 1)
          progressed = true
          break
        }
        if (result.needsSlideChoice && !autoResolveSlide) {
          return { ok: false, error: result.error, needsSlideChoice: result.needsSlideChoice }
        }
        lastError = result.error
      }
      if (!progressed) return { ok: false, error: lastError }
    }
    return { ok: true, kind: 'append', hand: remainingHand, meld: working, usedDiscardCards: topTouchCards }
  }

  const setResult = buildSet(candidateCards, team.id)
  if (setResult.ok) {
    return { ok: true, kind: 'new-meld', hand: remainingHand, meld: setResult.meld, usedDiscardCards: topTouchCards }
  }
  const seqResult = buildSequence(candidateCards, team.id)
  if (seqResult.ok) {
    return { ok: true, kind: 'new-meld', hand: remainingHand, meld: seqResult.meld, usedDiscardCards: topTouchCards }
  }
  return { ok: false, error: 'Not a legal Set or Sequence with those cards.' }
}

// ---------------------------------------------------------------------------
// Phase 2: Action (create/append melds from hand, no discard pile involved)
// ---------------------------------------------------------------------------

export function createMeldFromHand(
  hand: CardModel[],
  cardIds: string[],
  kind: 'set' | 'sequence',
  teamId: TeamId,
): { ok: true; hand: CardModel[]; meld: Meld } | { ok: false; error: string } {
  const selected = hand.filter((c) => cardIds.includes(c.id))
  if (selected.length !== cardIds.length) return { ok: false, error: 'Selected cards are not all in hand.' }
  const result = kind === 'set' ? buildSet(selected, teamId) : buildSequence(selected, teamId)
  if (!result.ok) return { ok: false, error: result.error }
  const remainingHand = hand.filter((c) => !cardIds.includes(c.id))
  return { ok: true, hand: remainingHand, meld: result.meld }
}

export function appendCardFromHand(
  hand: CardModel[],
  cardId: string,
  meld: Meld,
  slideEdge?: 'top' | 'bottom',
  team?: Team,
):
  | { ok: true; hand: CardModel[]; meld: Meld }
  | { ok: false; error: string; needsSlideChoice?: { displacedWildCardId: string } } {
  const card = hand.find((c) => c.id === cardId)
  if (!card) return { ok: false, error: 'Card not in hand.' }
  const ctx: AppendContext | undefined = team ? { team, handSize: hand.length } : undefined
  const result = appendToMeld(meld, card, slideEdge, ctx)
  if (!result.ok) return { ok: false, error: result.error, needsSlideChoice: result.needsSlideChoice }
  const remainingHand = hand.filter((c) => c.id !== cardId)
  return { ok: true, hand: remainingHand, meld: result.meld }
}

// ---------------------------------------------------------------------------
// Phase 3: Discard
// ---------------------------------------------------------------------------

export function performDiscard(
  hand: CardModel[],
  cardId: string,
  discardPile: CardModel[],
): { hand: CardModel[]; discardPile: CardModel[]; handSizeBeforeDiscard: number; discardedCard: CardModel } | null {
  const card = hand.find((c) => c.id === cardId)
  if (!card) return null
  return {
    hand: hand.filter((c) => c.id !== cardId),
    discardPile: [...discardPile, card],
    handSizeBeforeDiscard: hand.length,
    discardedCard: card,
  }
}

// ---------------------------------------------------------------------------
// Stock depletion / sudden death (section 7)
// ---------------------------------------------------------------------------

export function isStockDepleted(stock: CardModel[]): boolean {
  return stock.length === 0
}
