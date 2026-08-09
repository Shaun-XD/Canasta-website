import type { CardModel, Meld, Rank, Suit, TeamId } from '../types/game'
import { appendToMeld, buildSequence, buildSet, canAppendToMeld } from './meldValidation'
import { cardPointValue, RANK_ORDER } from './cardValues'

/**
 * Greedy plus-sum heuristic for mock/enemy bots.
 *
 * Priority: feed existing melds (edge append or Slide a natural into a
 * wild-filled slot) before opening new melds. Top Touch whenever the top
 * card unlocks a legal play AND/OR the rest of the pile contains cards that
 * feed table melds (those arrive in hand after a successful Top Touch).
 */

/** Tunable weights for the plus-sum score. Exported for tests / future tuning UI. */
export const AI_WEIGHTS = {
  /** Per card laid from hand into a new meld or append. */
  cardLaid: 100,
  /** Per point-value removed from hand (or secured in a meld). */
  pointValue: 1,
  /** Bonus for completing/extending toward a 7-card canasta. */
  canastaProgress: 40,
  /** Flat bonus once a meld reaches canasta length (≥7). */
  canastaComplete: 200,
  /** Penalty for spending a wild when a natural-only alternative exists. */
  wildSpend: -35,
  /** Bonus for Top Touch unlocking the rest of the discard pile. */
  pileRemainderCard: 25,
  /** Extra Top Touch incentive when the immediate meld itself is strong. */
  topTouchUnlock: 50,
  /** Remainder card that can immediately append/slide onto a table meld. */
  pileFeedExisting: 140,
  /** Extra when that feed is a Slide (natural replaces a wild fill). */
  pileFeedSlide: 90,
  /** Prefer Sliding a natural into a wild slot over a plain edge append. */
  slideNaturalize: 160,
  /** Penalty for discarding a card that was part of a near-meld (2-of-kind / 2-run). */
  breakNearMeld: 45,
} as const

export interface AiMeldPlan {
  cardIds: string[]
  kind: 'set' | 'sequence'
}

export interface AiAppendPlan {
  meldId: string
  cardId: string
}

export interface AiDrawPlan {
  source: 'stock' | 'top-touch'
  /** Hand cards combined with the discard selection for the unlocking meld. */
  handCardIds: string[]
  /**
   * Discard ids included in the unlocking meld (must include the top card).
   * May be a non-contiguous subset; unselected pile cards still join the hand.
   */
  selectedDiscardIds: string[]
  targetMeldId: string | null
  kind: 'set' | 'sequence' | 'append'
  /** Plus-sum score that beat drawing from stock (0 for stock). */
  score: number
}

export interface AiTurnPlan {
  draw: AiDrawPlan
  newMelds: AiMeldPlan[]
  appends: AiAppendPlan[]
  discardCardId: string | null
}

function rankOrder(rank: Rank): number {
  return RANK_ORDER[rank] ?? -1
}

function sortByRank(cards: CardModel[]): CardModel[] {
  return [...cards].sort((a, b) => rankOrder(a.rank) - rankOrder(b.rank))
}

function isWild(card: CardModel): boolean {
  return card.rank === 'JOKER' || card.rank === '2'
}

function countWilds(cards: CardModel[]): number {
  return cards.filter(isWild).length
}

function pointsOf(cards: CardModel[]): number {
  return cards.reduce((sum, c) => sum + cardPointValue(c), 0)
}

/** Score for laying `cards` as a brand-new meld (Set or Sequence). */
export function scoreNewMeld(cards: CardModel[]): number {
  let score = cards.length * AI_WEIGHTS.cardLaid + pointsOf(cards) * AI_WEIGHTS.pointValue
  const wilds = countWilds(cards)
  if (wilds > 0) score += wilds * AI_WEIGHTS.wildSpend
  if (cards.length >= 7) score += AI_WEIGHTS.canastaComplete
  else if (cards.length >= 5) score += (cards.length - 4) * AI_WEIGHTS.canastaProgress
  return score
}

/** True when `card` naturalizes a wild-filled slot (Slide), not just an open end. */
export function isSlideNaturalization(meld: Meld, card: CardModel): boolean {
  if (meld.type !== 'sequence') return false
  if (!card.suit || card.suit !== meld.suit) return false
  if (card.rank === 'JOKER') return false
  return meld.slots.some((s) => s.isWildFill && s.slotRank === card.rank)
}

/** Score for appending one card onto an existing meld. */
export function scoreAppend(card: CardModel, meld: Meld): number {
  let score = AI_WEIGHTS.cardLaid + cardPointValue(card) * AI_WEIGHTS.pointValue
  if (isWild(card)) score += AI_WEIGHTS.wildSpend
  const nextLen = meld.slots.length + 1
  if (nextLen >= 7 && meld.slots.length < 7) score += AI_WEIGHTS.canastaComplete
  else if (nextLen >= 5) score += AI_WEIGHTS.canastaProgress
  // Prefer feeding the longest / closest-to-canasta meld when choosing.
  score += meld.slots.length * 3
  // Sliding a natural into a wild slot frees the wild — strongly preferred
  // over opening a fresh set with that natural (e.g. 7♠ into 6-★-8-9-10).
  if (isSlideNaturalization(meld, card)) score += AI_WEIGHTS.slideNaturalize
  return score
}

/** Best feed score for a single card onto any existing team meld (0 if none). */
function bestExistingFeedScore(card: CardModel, melds: Meld[]): number {
  let best = 0
  for (const meld of melds) {
    if (!canAppendToMeld(meld, card)) continue
    let score = AI_WEIGHTS.pileFeedExisting
    if (isSlideNaturalization(meld, card)) {
      score += AI_WEIGHTS.pileFeedSlide + AI_WEIGHTS.slideNaturalize
    }
    if (score > best) best = score
  }
  return best
}

/** Bonus for pile cards that will feed existing melds once Top Touch succeeds. */
function scorePileFeedPotential(cards: CardModel[], melds: Meld[]): number {
  return cards.reduce((sum, card) => sum + bestExistingFeedScore(card, melds), 0)
}

/**
 * Penalty for burning cards that could feed table melds into a brand-new
 * unlocking set/sequence (e.g. using 7♠ to open a set of 7s when it can Slide
 * into 6-★-8-9-10♠). Those cards should arrive in hand / unlock via append.
 */
function feedOpportunityPenalty(cards: CardModel[], melds: Meld[]): number {
  return cards.reduce((sum, card) => sum + bestExistingFeedScore(card, melds), 0)
}

/**
 * Score a successful Top Touch: the unlocking meld/append plus the value of
 * receiving the remainder of the discard pile into hand (positive-sum).
 */
export function scoreTopTouchUnlock(opts: {
  meldCards: CardModel[]
  remainderPile: CardModel[]
  kind: 'set' | 'sequence' | 'append'
}): number {
  const meldScore =
    opts.kind === 'append'
      ? opts.meldCards.reduce((s, c) => s + AI_WEIGHTS.cardLaid + cardPointValue(c) * AI_WEIGHTS.pointValue, 0)
      : scoreNewMeld(opts.meldCards)
  const remainder =
    opts.remainderPile.length * AI_WEIGHTS.pileRemainderCard +
    pointsOf(opts.remainderPile) * AI_WEIGHTS.pointValue * 0.25
  return meldScore + remainder + AI_WEIGHTS.topTouchUnlock
}

/**
 * Finds legal new Sets/Sequences in `hand`, repeatedly picking the highest
 * plus-sum candidate until none remain (always meld when positive).
 *
 * Append-first policy: any hand card that can legally join an existing (or
 * already-planned-this-pass) team meld is held back for `planAiAppends`
 * instead of being spent on a new meld. Example: with a spade run of
 * 10-J-Q-K-A on the table, a 9♠ stays available to append rather than
 * opening a fresh set of 9s.
 *
 * Among brand-new melds, Sequences beat Sets on equal plus-sum scores.
 */
export function planAiMelds(
  hand: CardModel[],
  teamId: TeamId,
  existingMelds: Meld[] = [],
): { plans: AiMeldPlan[]; remainingHand: CardModel[] } {
  const plans: AiMeldPlan[] = []
  let remaining = [...hand]
  const blockedSetRanks = ranksWithExistingSet(existingMelds)
  // Grows as we open melds this pass so later cards can be reserved to feed them.
  let tableMelds = [...existingMelds]
  const heldForAppend: CardModel[] = []

  for (let guard = 0; guard < 10; guard += 1) {
    const playable: CardModel[] = []
    for (const card of remaining) {
      if (tableMelds.some((m) => canAppendToMeld(m, card))) {
        heldForAppend.push(card)
      } else {
        playable.push(card)
      }
    }
    remaining = playable

    const best = findBestNewMeld(remaining, teamId, blockedSetRanks)
    if (!best || best.score <= 0) break

    const used = remaining.filter((c) => best.plan.cardIds.includes(c.id))
    if (best.plan.kind === 'set') {
      const sample = used.find((c) => !isWild(c))
      if (sample) blockedSetRanks.add(sample.rank)
    }
    plans.push(best.plan)
    remaining = remaining.filter((c) => !best.plan.cardIds.includes(c.id))

    const built =
      best.plan.kind === 'set' ? buildSet(used, teamId) : buildSequence(used, teamId)
    if (built.ok) tableMelds = [...tableMelds, built.meld]
  }

  return { plans, remainingHand: [...remaining, ...heldForAppend] }
}

function ranksWithExistingSet(melds: Meld[]): Set<Rank> {
  const ranks = new Set<Rank>()
  for (const meld of melds) {
    if (meld.type === 'set' && meld.rank) ranks.add(meld.rank)
  }
  return ranks
}

function findBestNewMeld(
  hand: CardModel[],
  teamId: TeamId,
  blockedSetRanks: Set<Rank> = new Set(),
): { plan: AiMeldPlan; score: number } | null {
  let best: { plan: AiMeldPlan; score: number } | null = null

  const consider = (group: CardModel[], kind: 'set' | 'sequence') => {
    const attempt = kind === 'set' ? buildSet(group, teamId) : buildSequence(group, teamId)
    if (!attempt.ok) return
    const score = scoreNewMeld(group)
    if (score <= 0) return
    const prev = best
    const bestWilds = prev
      ? countWilds(hand.filter((c) => prev.plan.cardIds.includes(c.id)))
      : 0
    const prefer =
      !prev ||
      score > prev.score ||
      // On a tie, Sequences beat Sets; then conserve wilds.
      (score === prev.score && kind === 'sequence' && prev.plan.kind === 'set') ||
      (score === prev.score && kind === prev.plan.kind && countWilds(group) < bestWilds)
    if (prefer) best = { plan: { cardIds: group.map((c) => c.id), kind }, score }
  }

  // Sequences first (same candidates still compete by score; ties prefer sequence).
  const suits = new Set(
    hand.filter((c) => c.rank !== 'JOKER' && c.suit).map((c) => c.suit as Suit),
  )
  for (const suit of suits) {
    const suited = sortByRank(hand.filter((c) => c.suit === suit && c.rank !== 'JOKER'))
    const wildPool = hand.filter(
      (c) => c.rank === 'JOKER' || (c.rank === '2' && c.suit !== suit) || c.rank === '2',
    )

    for (let i = 0; i < suited.length; i += 1) {
      for (let j = i + 2; j < suited.length; j += 1) {
        consider(suited.slice(i, j + 1), 'sequence')
      }
      for (let j = i + 1; j < suited.length; j += 1) {
        const naturals = suited.slice(i, j + 1)
        if (naturals.length < 2) continue
        const wild =
          wildPool.find((c) => c.rank === 'JOKER') ??
          wildPool.find((c) => c.rank === '2' && c.suit !== suit) ??
          wildPool.find((c) => !naturals.some((n) => n.id === c.id))
        if (!wild) continue
        if (naturals.some((n) => n.id === wild.id)) continue
        consider([...naturals, wild], 'sequence')
      }
    }
  }

  // Sets — only when a rank isn't already on the table (append instead).
  const naturalRanks = new Set(hand.filter((c) => !isWild(c)).map((c) => c.rank))
  for (const rank of naturalRanks) {
    if (blockedSetRanks.has(rank)) continue
    const naturals = hand.filter((c) => c.rank === rank)
    const wilds = hand.filter(isWild)
    if (naturals.length >= 3) consider(naturals, 'set')
    if (naturals.length === 2 && wilds.length >= 1) consider([...naturals, wilds[0]], 'set')
    if (naturals.length >= 6 && wilds.length >= 1) consider([...naturals, wilds[0]], 'set')
  }

  return best
}

/**
 * Append every card that legally fits, preferring higher plus-sum appends
 * first (canasta progress, points). Re-scans after each append.
 */
export function planAiAppends(hand: CardModel[], melds: Meld[]): { plans: AiAppendPlan[]; remainingHand: CardModel[] } {
  const plans: AiAppendPlan[] = []
  let remaining = [...hand]
  // Local copy of meld lengths so canasta-progress scoring stays accurate as we append.
  const meldState = melds.map((m) => ({ ...m, slots: [...m.slots] }))

  let progressed = true
  while (progressed) {
    progressed = false
    let best: { plan: AiAppendPlan; score: number; meldIndex: number } | null = null

    for (let mi = 0; mi < meldState.length; mi += 1) {
      const meld = meldState[mi]
      for (const card of remaining) {
        if (!canAppendToMeld(meld, card)) continue
        const score = scoreAppend(card, meld)
        if (!best || score > best.score) {
          best = { plan: { meldId: meld.id, cardId: card.id }, score, meldIndex: mi }
        }
      }
    }

    if (!best || best.score <= 0) break
    plans.push(best.plan)
    const card = remaining.find((c) => c.id === best!.plan.cardId)!
    remaining = remaining.filter((c) => c.id !== card.id)
    // Apply for-real (auto-Slide) so subsequent append scoring stays accurate.
    const applied = appendToMeld(meldState[best.meldIndex], card, 'top')
    if (applied.ok) {
      meldState[best.meldIndex] = applied.meld
    } else {
      meldState[best.meldIndex] = {
        ...meldState[best.meldIndex],
        slots: [
          ...meldState[best.meldIndex].slots,
          { card, slotRank: card.rank, isWildFill: isWild(card) },
        ],
      }
    }
    progressed = true
  }

  return { plans, remainingHand: remaining }
}

/**
 * Draw vs Top Touch: Top Touch when the unlocking play (+ pile remainder that
 * feeds existing melds) beats drawing from stock. Scans the whole pile for
 * cards that can append/slide onto table melds once received.
 */
export function planAiDraw(
  hand: CardModel[],
  melds: Meld[],
  discardPile: CardModel[],
  teamId: TeamId,
): AiDrawPlan {
  const stockPlan: AiDrawPlan = {
    source: 'stock',
    handCardIds: [],
    selectedDiscardIds: [],
    targetMeldId: null,
    kind: 'set',
    score: 0,
  }
  if (discardPile.length === 0) return stockPlan

  const bestRef: { current: AiDrawPlan | null } = { current: null }

  const consider = (plan: AiDrawPlan) => {
    if (plan.score <= 0) return
    if (!bestRef.current || plan.score > bestRef.current.score) bestRef.current = plan
  }

  const top = discardPile[discardPile.length - 1]

  // --- Unlock with top alone (append / Slide onto an existing meld) ---
  // Full append score — never lose to "open a new set with this natural".
  {
    const remainderPile = discardPile.slice(0, -1)
    const feedBonus = scorePileFeedPotential(remainderPile, melds)
    for (const meld of melds) {
      if (!canAppendToMeld(meld, top)) continue
      const score =
        scoreTopTouchUnlock({
          meldCards: [top],
          remainderPile,
          kind: 'append',
        }) +
        scoreAppend(top, meld) +
        feedBonus
      consider({
        source: 'top-touch',
        handCardIds: [],
        selectedDiscardIds: [top.id],
        targetMeldId: meld.id,
        kind: 'append',
        score,
      })
    }
  }

  // --- Unlock with top + any deeper discard card that shares a legal meld ---
  // (non-contiguous OK). Prefer when the deep card Slides into a table meld
  // together with top, or forms a set/sequence with hand help.
  for (let i = 0; i < discardPile.length - 1; i += 1) {
    const deep = discardPile[i]
    const selectedDiscard = [deep, top]
    const selectedDiscardIds = selectedDiscard.map((c) => c.id)
    const remainderPile = discardPile.filter((c) => c.id !== deep.id && c.id !== top.id)
    const feedBonus = scorePileFeedPotential(remainderPile, melds)

    // Both cards append to the same existing meld (rare but strong).
    for (const meld of melds) {
      if (!canAppendToMeld(meld, top) || !canAppendToMeld(meld, deep)) continue
      const score =
        scoreTopTouchUnlock({
          meldCards: [top, deep],
          remainderPile,
          kind: 'append',
        }) +
        scoreAppend(top, meld) +
        scoreAppend(deep, meld) +
        feedBonus
      consider({
        source: 'top-touch',
        handCardIds: [],
        selectedDiscardIds,
        targetMeldId: meld.id,
        kind: 'append',
        score,
      })
    }

    const handCombos = enumerateHandCombos(hand, 3)
    for (const handCards of handCombos) {
      const group = [...selectedDiscard, ...handCards]
      if (group.length < 3) continue
      const burnPenalty = feedOpportunityPenalty(group, melds)
      const setAttempt = buildSet(group, teamId)
      if (setAttempt.ok) {
        consider({
          source: 'top-touch',
          handCardIds: handCards.map((c) => c.id),
          selectedDiscardIds,
          targetMeldId: null,
          kind: 'set',
          score:
            scoreTopTouchUnlock({ meldCards: group, remainderPile, kind: 'set' }) +
            feedBonus -
            burnPenalty,
        })
      }
      const seqAttempt = buildSequence(group, teamId)
      if (seqAttempt.ok) {
        consider({
          source: 'top-touch',
          handCardIds: handCards.map((c) => c.id),
          selectedDiscardIds,
          targetMeldId: null,
          kind: 'sequence',
          score:
            scoreTopTouchUnlock({ meldCards: group, remainderPile, kind: 'sequence' }) +
            feedBonus -
            burnPenalty,
        })
      }
    }
  }

  // --- Contiguous top-runs + hand (legacy path for multi-card natural runs) ---
  const maxRun = Math.min(6, discardPile.length)
  for (let run = 1; run <= maxRun; run += 1) {
    const selectedDiscard = discardPile.slice(discardPile.length - run)
    const selectedDiscardIds = selectedDiscard.map((c) => c.id)
    const remainderPile = discardPile.slice(0, discardPile.length - run)
    const feedBonus = scorePileFeedPotential(remainderPile, melds)

    const handCombos = enumerateHandCombos(hand, 4)
    for (const handCards of handCombos) {
      const group = [...selectedDiscard, ...handCards]
      if (group.length < 3) continue
      const burnPenalty = feedOpportunityPenalty(group, melds)

      const setAttempt = buildSet(group, teamId)
      if (setAttempt.ok) {
        consider({
          source: 'top-touch',
          handCardIds: handCards.map((c) => c.id),
          selectedDiscardIds,
          targetMeldId: null,
          kind: 'set',
          score:
            scoreTopTouchUnlock({ meldCards: group, remainderPile, kind: 'set' }) +
            feedBonus -
            burnPenalty,
        })
      }
      const seqAttempt = buildSequence(group, teamId)
      if (seqAttempt.ok) {
        consider({
          source: 'top-touch',
          handCardIds: handCards.map((c) => c.id),
          selectedDiscardIds,
          targetMeldId: null,
          kind: 'sequence',
          score:
            scoreTopTouchUnlock({ meldCards: group, remainderPile, kind: 'sequence' }) +
            feedBonus -
            burnPenalty,
        })
      }
    }
  }

  const best = bestRef.current
  return best && best.score > 0 ? best : stockPlan
}

/** Hand subsets of size 0..maxSize (capped) for Top Touch combo search. */
function enumerateHandCombos(hand: CardModel[], maxSize: number): CardModel[][] {
  const n = Math.min(hand.length, 6)
  const cards = hand.slice(0, n)
  const out: CardModel[][] = [[]]
  const limit = Math.min(maxSize, cards.length)
  // Iterative combinations by index to avoid huge power sets.
  type Indexed = { idxs: number[]; cards: CardModel[] }
  let frontier: Indexed[] = [{ idxs: [], cards: [] }]
  for (let size = 1; size <= limit; size += 1) {
    const next: Indexed[] = []
    for (const prev of frontier) {
      const start = prev.idxs.length === 0 ? 0 : prev.idxs[prev.idxs.length - 1] + 1
      for (let i = start; i < cards.length; i += 1) {
        next.push({ idxs: [...prev.idxs, i], cards: [...prev.cards, cards[i]] })
      }
    }
    for (const item of next) out.push(item.cards)
    frontier = next
    if (frontier.length > 80) break // safety cap
  }
  return out
}

/**
 * Discard the lowest plus-sum-loss card: prefer low point value, never a wild
 * if a natural exists, and avoid breaking a near-meld (pair / 2-card suit run).
 */
export function pickAiDiscard(hand: CardModel[]): CardModel | null {
  if (hand.length === 0) return null

  const nearMeldIds = new Set(cardsInNearMelds(hand))
  const nonWild = hand.filter((c) => !isWild(c))
  const pool = nonWild.length > 0 ? nonWild : hand

  let best: CardModel | null = null
  let bestCost = Infinity
  for (const card of pool) {
    let cost = cardPointValue(card)
    if (nearMeldIds.has(card.id)) cost += AI_WEIGHTS.breakNearMeld
    if (isWild(card)) cost += 80
    if (cost < bestCost) {
      bestCost = cost
      best = card
    }
  }
  return best
}

/** Cards that participate in a 2-of-kind or 2-card same-suit adjacent run. */
function cardsInNearMelds(hand: CardModel[]): string[] {
  const ids: string[] = []
  const byRank = new Map<Rank, CardModel[]>()
  for (const card of hand) {
    if (isWild(card)) continue
    const list = byRank.get(card.rank) ?? []
    list.push(card)
    byRank.set(card.rank, list)
  }
  for (const group of byRank.values()) {
    if (group.length >= 2) ids.push(...group.map((c) => c.id))
  }

  const bySuit = new Map<Suit, CardModel[]>()
  for (const card of hand) {
    if (card.rank === 'JOKER' || !card.suit) continue
    const list = bySuit.get(card.suit) ?? []
    list.push(card)
    bySuit.set(card.suit, list)
  }
  for (const suited of bySuit.values()) {
    const sorted = sortByRank(suited)
    for (let i = 0; i < sorted.length - 1; i += 1) {
      if (rankOrder(sorted[i + 1].rank) === rankOrder(sorted[i].rank) + 1) {
        ids.push(sorted[i].id, sorted[i + 1].id)
      }
    }
  }
  return ids
}

/**
 * Full-turn plan from the pre-draw seat state. Melds/appends are planned on
 * the post-draw hand assuming Top Touch remainder joins the hand when chosen.
 *
 * Note: the store still applies draw → melds → appends → discard step-by-step;
 * this helper is the single place that encodes plus-sum priority for tests
 * and for callers that want the whole intent up front.
 */
export function planAiTurn(
  hand: CardModel[],
  melds: Meld[],
  discardPile: CardModel[],
  teamId: TeamId,
): AiTurnPlan {
  const draw = planAiDraw(hand, melds, discardPile, teamId)

  let workingHand = [...hand]
  let workingMelds = [...melds]

  if (draw.source === 'top-touch') {
    const selectedDiscard = discardPile.filter((c) => draw.selectedDiscardIds.includes(c.id))
    const remainder = discardPile.filter((c) => !draw.selectedDiscardIds.includes(c.id))
    // Cards used in the unlocking meld leave the hand; remainder joins.
    workingHand = workingHand.filter((c) => !draw.handCardIds.includes(c.id))
    workingHand = [...workingHand, ...remainder]

    if (draw.kind === 'append' && draw.targetMeldId) {
      const top = selectedDiscard[selectedDiscard.length - 1]
      workingMelds = workingMelds.map((m) =>
        m.id === draw.targetMeldId
          ? {
              ...m,
              slots: [...m.slots, { card: top, slotRank: top.rank, isWildFill: isWild(top) }],
            }
          : m,
      )
    }
    // New meld from top-touch is not added to workingMelds here in full
    // fidelity (engine builds it at apply-time); subsequent planAiMelds still
    // finds further lays from the enriched hand.
  }

  // Prefer feeding existing sets/sequences before opening new melds so we
  // never plan a second Queens set when one is already on the table.
  const firstAppends = planAiAppends(workingHand, workingMelds)
  workingHand = firstAppends.remainingHand
  const meldPlans = planAiMelds(workingHand, teamId, workingMelds)
  workingHand = meldPlans.remainingHand
  const secondAppends = planAiAppends(workingHand, workingMelds)
  workingHand = secondAppends.remainingHand
  const discard = pickAiDiscard(workingHand)

  return {
    draw,
    newMelds: meldPlans.plans,
    appends: [...firstAppends.plans, ...secondAppends.plans],
    discardCardId: discard?.id ?? null,
  }
}

