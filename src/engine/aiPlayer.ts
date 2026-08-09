import type { CardModel, Meld, TeamId } from '../types/game'
import { buildSequence, buildSet, canAppendToMeld } from './meldValidation'
import { cardPointValue } from './cardValues'

/**
 * Heuristic AI planner for mock/placeholder players.
 *
 * Strategy (greedy "always meld if positive"):
 * 1. Prefer laying any legal new Set or Sequence from hand (including with
 *    one wild), scoring candidates by cards laid + point value.
 * 2. Append every card that can legally join an existing team meld.
 * 3. When deciding draw vs Top Touch, pick Top Touch only if the top discard
 *    card immediately enables a new meld or append (positive-sum pickup).
 *
 * This is intentionally NOT minimax or RL — for a 4-player imperfect-info
 * partnership game those are heavy, slow to train, and overkill for mock
 * opponents. A scored greedy heuristic gives "always meld when you can"
 * behavior with the real rules engine as the legality oracle.
 */

export interface AiMeldPlan {
  cardIds: string[]
  kind: 'set' | 'sequence'
}

export interface AiAppendPlan {
  meldId: string
  cardId: string
}

export interface AiDrawPlan {
  /** 'stock' | 'top-touch' */
  source: 'stock' | 'top-touch'
  /** Hand card ids to combine with the top discard when source is top-touch. */
  handCardIds: string[]
  /** Optional existing meld to append the top discard (+ hand cards) onto. */
  targetMeldId: string | null
  kind: 'set' | 'sequence' | 'append'
}

function scoreMeldCards(cards: CardModel[]): number {
  // Prefer laying more cards and higher point values (get them out of hand).
  return cards.length * 100 + cards.reduce((sum, c) => sum + cardPointValue(c), 0)
}

/**
 * Finds every legal new Set/Sequence in `hand` and returns the best non-
 * overlapping sequence of lays (greedy by score). Always melds when possible.
 */
export function planAiMelds(hand: CardModel[], teamId: TeamId): { plans: AiMeldPlan[]; remainingHand: CardModel[] } {
  const plans: AiMeldPlan[] = []
  let remaining = [...hand]

  // Repeat until no more legal new melds can be formed from what's left.
  for (let guard = 0; guard < 8; guard += 1) {
    let best: { plan: AiMeldPlan; score: number } | null = null

    // --- Sets: same natural rank, 3+, optional single wild ---
    const naturalRanks = new Set(
      remaining.filter((c) => c.rank !== 'JOKER' && c.rank !== '2').map((c) => c.rank),
    )
    for (const rank of naturalRanks) {
      const naturals = remaining.filter((c) => c.rank === rank)
      const wilds = remaining.filter((c) => c.rank === 'JOKER' || c.rank === '2')
      const candidates: CardModel[][] = []
      if (naturals.length >= 3) candidates.push(naturals)
      if (naturals.length >= 2 && wilds.length >= 1) {
        candidates.push([...naturals, wilds[0]])
      }
      for (const group of candidates) {
        const attempt = buildSet(group, teamId)
        if (!attempt.ok) continue
        const score = scoreMeldCards(group)
        if (!best || score > best.score) {
          best = { plan: { cardIds: group.map((c) => c.id), kind: 'set' }, score }
        }
      }
    }

    // --- Sequences: same-suit runs of 3+, optional one wild fill/extension ---
    const suits = new Set(
      remaining.filter((c) => c.rank !== 'JOKER').map((c) => c.suit).filter(Boolean),
    )
    for (const suit of suits) {
      const suited = remaining.filter((c) => c.suit === suit && c.rank !== 'JOKER')
      const jokers = remaining.filter((c) => c.rank === 'JOKER')
      // Try contiguous natural windows of length 3+, and windows of 2+ with a wild.
      const byRank = [...suited].sort((a, b) => {
        const ra = a.rank === '2' ? 2 : a.rank === 'A' ? 1 : a.rank === 'J' ? 11 : a.rank === 'Q' ? 12 : a.rank === 'K' ? 13 : Number(a.rank)
        const rb = b.rank === '2' ? 2 : b.rank === 'A' ? 1 : b.rank === 'J' ? 11 : b.rank === 'Q' ? 12 : b.rank === 'K' ? 13 : Number(b.rank)
        return ra - rb
      })

      for (let i = 0; i < byRank.length; i += 1) {
        for (let j = i + 2; j < byRank.length; j += 1) {
          const group = byRank.slice(i, j + 1)
          const attempt = buildSequence(group, teamId)
          if (attempt.ok) {
            const score = scoreMeldCards(group)
            if (!best || score > best.score) {
              best = { plan: { cardIds: group.map((c) => c.id), kind: 'sequence' }, score }
            }
          }
        }
        // 2 naturals + 1 wild
        for (let j = i + 1; j < byRank.length; j += 1) {
          if (jokers.length === 0 && !remaining.some((c) => c.rank === '2' && c.suit !== suit)) {
            // Still try with an off-suit/extra 2 as wild, or same-suit 2 used as wild via engine.
          }
          const naturals = byRank.slice(i, j + 1)
          if (naturals.length < 2) continue
          const wild =
            jokers[0] ??
            remaining.find(
              (c) =>
                (c.rank === '2' || c.rank === 'JOKER') &&
                !naturals.some((n) => n.id === c.id),
            )
          if (!wild) continue
          const group = [...naturals, wild]
          const attempt = buildSequence(group, teamId)
          if (attempt.ok) {
            const score = scoreMeldCards(group)
            if (!best || score > best.score) {
              best = { plan: { cardIds: group.map((c) => c.id), kind: 'sequence' }, score }
            }
          }
        }
      }
    }

    if (!best) break
    plans.push(best.plan)
    remaining = remaining.filter((c) => !best!.plan.cardIds.includes(c.id))
  }

  return { plans, remainingHand: remaining }
}

export function planAiAppends(hand: CardModel[], melds: Meld[]): { plans: AiAppendPlan[]; remainingHand: CardModel[] } {
  const plans: AiAppendPlan[] = []
  let remaining = [...hand]

  // Keep appending while anything still fits (multiple cards onto different melds).
  let progressed = true
  while (progressed) {
    progressed = false
    for (const meld of melds) {
      const cardIndex = remaining.findIndex((c) => canAppendToMeld(meld, c))
      if (cardIndex < 0) continue
      const card = remaining[cardIndex]
      plans.push({ meldId: meld.id, cardId: card.id })
      remaining = remaining.filter((c) => c.id !== card.id)
      progressed = true
    }
  }

  return { plans, remainingHand: remaining }
}

/**
 * Decide whether to draw from stock or Top Touch the discard pile.
 * Top Touch only when the top card immediately enables a legal meld/append
 * with cards currently in hand (positive-sum pickup).
 */
export function planAiDraw(
  hand: CardModel[],
  melds: Meld[],
  discardPile: CardModel[],
  teamId: TeamId,
): AiDrawPlan {
  const top = discardPile.length > 0 ? discardPile[discardPile.length - 1] : null
  if (!top) return { source: 'stock', handCardIds: [], targetMeldId: null, kind: 'set' }

  // Append top card alone onto an existing meld?
  for (const meld of melds) {
    if (canAppendToMeld(meld, top)) {
      return {
        source: 'top-touch',
        handCardIds: [],
        targetMeldId: meld.id,
        kind: 'append',
      }
    }
  }

  // Top + 1..n hand cards form a new set/sequence?
  let best: AiDrawPlan | null = null
  let bestScore = -1

  // Try top + each pair/triple from hand for sets
  const handNaturalsSameRank = hand.filter((c) => c.rank === top.rank && c.rank !== 'JOKER' && c.rank !== '2')
  if (top.rank !== 'JOKER' && top.rank !== '2') {
    const pool = [...handNaturalsSameRank]
    if (pool.length >= 2) {
      const group = [top, ...pool.slice(0, Math.min(pool.length, 3))]
      const attempt = buildSet(group, teamId)
      if (attempt.ok) {
        const score = scoreMeldCards(group) + 50 // bonus for unlocking the pile
        if (score > bestScore) {
          bestScore = score
          best = {
            source: 'top-touch',
            handCardIds: group.filter((c) => c.id !== top.id).map((c) => c.id),
            targetMeldId: null,
            kind: 'set',
          }
        }
      }
    }
    // top + 1 natural + 1 wild
    if (pool.length >= 1) {
      const wild = hand.find((c) => c.rank === 'JOKER' || c.rank === '2')
      if (wild) {
        const group = [top, pool[0], wild]
        const attempt = buildSet(group, teamId)
        if (attempt.ok) {
          const score = scoreMeldCards(group) + 50
          if (score > bestScore) {
            bestScore = score
            best = {
              source: 'top-touch',
              handCardIds: [pool[0].id, wild.id],
              targetMeldId: null,
              kind: 'set',
            }
          }
        }
      }
    }
  }

  // Sequences with top
  if (top.rank !== 'JOKER' && top.suit) {
    const suited = hand.filter((c) => c.suit === top.suit && c.rank !== 'JOKER')
    const wilds = hand.filter((c) => c.rank === 'JOKER' || (c.rank === '2' && c.id !== top.id))
    for (let mask = 1; mask < 1 << Math.min(suited.length, 5); mask += 1) {
      const subset: CardModel[] = []
      for (let i = 0; i < Math.min(suited.length, 5); i += 1) {
        if (mask & (1 << i)) subset.push(suited[i])
      }
      const groups = [[top, ...subset]]
      if (wilds[0]) groups.push([top, ...subset, wilds[0]])
      for (const group of groups) {
        if (group.length < 3) continue
        const attempt = buildSequence(group, teamId)
        if (!attempt.ok) continue
        const score = scoreMeldCards(group) + 50
        if (score > bestScore) {
          bestScore = score
          best = {
            source: 'top-touch',
            handCardIds: group.filter((c) => c.id !== top.id).map((c) => c.id),
            targetMeldId: null,
            kind: 'sequence',
          }
        }
      }
    }
  }

  // top + hand card append? (canAppend only takes one card - if top alone
  // doesn't append, sometimes top+hand isn't an "append" but a new meld —
  // already covered above.)

  if (best) return best
  return { source: 'stock', handCardIds: [], targetMeldId: null, kind: 'set' }
}

/** Picks a discard: prefers a non-wild, low-point card so wilds/high cards stay for melding. */
export function pickAiDiscard(hand: CardModel[]): CardModel | null {
  if (hand.length === 0) return null
  const nonWild = hand.filter((c) => c.rank !== 'JOKER' && c.rank !== '2')
  const pool = nonWild.length > 0 ? nonWild : hand
  return pool.reduce((best, c) => (cardPointValue(c) < cardPointValue(best) ? c : best))
}
