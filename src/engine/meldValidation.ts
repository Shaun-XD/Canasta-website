import type { CardModel, Meld, MeldSlot, Rank, Suit, TeamId } from '../types/game'
import { RANK_BY_ORDER, RANK_ORDER, cardPointValue } from './cardValues'

let meldIdCounter = 0
function nextMeldId(): string {
  meldIdCounter += 1
  return `meld-${meldIdCounter}-${Math.random().toString(36).slice(2, 8)}`
}

export type MeldResult = { ok: true; meld: Meld } | { ok: false; error: string }

export type AppendResult =
  | { ok: true; meld: Meld }
  | { ok: false; error: string; needsSlideChoice?: { displacedWildCardId: string } }

/**
 * A 2 is "natural" within a Sequence only when it sits in its own rightful
 * '2' slot AND matches the sequence's suit. Everywhere else - a mismatched
 * suit, or filling any other rank's slot - it is a wild substitute. Jokers
 * are always wild.
 */
function isWildFillForSlot(card: CardModel, slotRank: Rank, sequenceSuit: Suit): boolean {
  if (card.rank === 'JOKER') return true
  if (card.rank === '2') {
    return !(slotRank === '2' && card.suit === sequenceSuit)
  }
  return false
}

// ---------------------------------------------------------------------------
// Building a brand-new Set
// ---------------------------------------------------------------------------

export function buildSet(cards: CardModel[], ownerTeamId: TeamId): MeldResult {
  if (cards.length < 3) return { ok: false, error: 'A set needs at least 3 cards.' }

  const jokers = cards.filter((c) => c.rank === 'JOKER')
  const twos = cards.filter((c) => c.rank === '2')
  const others = cards.filter((c) => c.rank !== 'JOKER' && c.rank !== '2')

  let rank: Rank
  let wildCount: number
  let naturalCount: number

  if (others.length > 0) {
    rank = others[0].rank
    if (!others.every((c) => c.rank === rank)) {
      return { ok: false, error: 'All natural cards in a set must share the same rank.' }
    }
    wildCount = jokers.length + twos.length
    naturalCount = others.length
  } else if (twos.length > 0) {
    // A "2s meld": the 2s themselves are the natural members; only Jokers are wild.
    rank = '2'
    wildCount = jokers.length
    naturalCount = twos.length
  } else {
    return {
      ok: false,
      error:
        'Cannot form a meld from wild cards alone - no natural rank established (illegal opening meld).',
    }
  }

  if (wildCount > 1) {
    return { ok: false, error: 'A meld may contain at most 1 wild card.' }
  }
  if (naturalCount === 0) {
    return { ok: false, error: 'A meld needs at least one natural card.' }
  }

  const slots: MeldSlot[] = cards.map((card) => ({
    card,
    slotRank: rank,
    isWildFill: rank === '2' ? card.rank === 'JOKER' : card.rank === 'JOKER' || card.rank === '2',
  }))

  const meld: Meld = {
    id: nextMeldId(),
    type: 'set',
    ownerTeamId,
    rank,
    suit: null,
    slots,
    wildCount,
    canBecomeLimpa: true,
    classification: 'in-progress',
    isCanasta: false,
  }

  recomputeMeldFlags(meld)
  return { ok: true, meld }
}

// ---------------------------------------------------------------------------
// Building a brand-new Sequence
// ---------------------------------------------------------------------------

export function buildSequence(cards: CardModel[], ownerTeamId: TeamId): MeldResult {
  if (cards.length < 3) return { ok: false, error: 'A sequence needs at least 3 cards.' }

  const jokers = cards.filter((c) => c.rank === 'JOKER')
  const others = cards.filter((c) => c.rank !== 'JOKER' && c.rank !== '2')
  const twos = cards.filter((c) => c.rank === '2')

  let suit: Suit
  if (others.length > 0) {
    suit = others[0].suit as Suit
    if (!others.every((c) => c.suit === suit)) {
      return { ok: false, error: 'A sequence must be a single suit.' }
    }
  } else if (twos.length > 0) {
    suit = twos[0].suit as Suit
  } else {
    return {
      ok: false,
      error: 'Cannot form a sequence from wild cards alone - no suit established (illegal opening meld).',
    }
  }

  // Determine which cards are "true naturals" at their own rank/suit slot.
  // A 2 is only natural if it matches the sequence suit AND no other 2 has
  // already claimed the '2' slot - any additional/mismatched 2s fall back
  // to the wild pool (per section 3's "double duty" note, extra 2s from the
  // second deck can still serve as plain wild fillers elsewhere).
  const naturalsByOrder = new Map<number, CardModel>()
  const wildPool: CardModel[] = [...jokers]

  for (const card of others) {
    const order = RANK_ORDER[card.rank]
    if (naturalsByOrder.has(order)) {
      return { ok: false, error: 'Duplicate rank in sequence - only one card may occupy each slot.' }
    }
    naturalsByOrder.set(order, card)
  }

  let placedNaturalTwo = false
  for (const two of twos) {
    const twoOrder = RANK_ORDER['2']
    if (!placedNaturalTwo && two.suit === suit && !naturalsByOrder.has(twoOrder)) {
      naturalsByOrder.set(twoOrder, two)
      placedNaturalTwo = true
    } else {
      wildPool.push(two)
    }
  }

  const naturalOrders = [...naturalsByOrder.keys()].sort((a, b) => a - b)

  if (wildPool.length > 1) {
    return { ok: false, error: 'A meld may contain at most 1 wild card.' }
  }

  // Naturals must already be contiguous, with at most one 1-rank internal
  // gap that the single wild (if any) fills. If there is NO internal gap but
  // a single wild is present, the wild isn't wasted - it extends the run at
  // whichever open end still has a valid next rank (e.g. 4,5 + Joker -> the
  // Joker takes the "6" slot rather than being rejected outright). This
  // applies at creation time too (not just when appending to an existing
  // meld), since a Top Touch / Lay Sequence combining hand cards with the
  // top discard is effectively "creating" a meld from cards that may
  // already be a valid open-ended run plus one wild.
  const minNatural = naturalOrders[0]
  const maxNatural = naturalOrders[naturalOrders.length - 1]
  const missing: number[] = []
  for (let o = minNatural; o <= maxNatural; o += 1) {
    if (!naturalOrders.includes(o)) missing.push(o)
  }

  if (missing.length > 1) {
    return { ok: false, error: 'Naturals leave more than one gap - only 1 wild card is allowed.' }
  }
  if (missing.length === 1 && wildPool.length === 0) {
    return { ok: false, error: 'A gap exists in the sequence with no wild card to fill it.' }
  }

  let minOrder = minNatural
  let maxOrder = maxNatural
  let wildOrder: number | null = missing.length === 1 ? missing[0] : null

  if (missing.length === 0 && wildPool.length === 1) {
    // No internal gap: the wild must extend an open end instead. Prefer
    // extending upward (the next-higher rank) and fall back to extending
    // downward if the run is already capped at K (no wraparound).
    if (RANK_BY_ORDER[maxNatural + 1] !== undefined) {
      wildOrder = maxNatural + 1
      maxOrder = wildOrder
    } else if (RANK_BY_ORDER[minNatural - 1] !== undefined) {
      wildOrder = minNatural - 1
      minOrder = wildOrder
    } else {
      return {
        ok: false,
        error: 'No gap to fill - remove the extra wild card or use it to extend an end.',
      }
    }
  }

  const span = maxOrder - minOrder + 1
  if (span < 3) {
    return { ok: false, error: 'A sequence needs at least 3 consecutive ranks.' }
  }
  if (RANK_BY_ORDER[minOrder] === undefined || RANK_BY_ORDER[maxOrder] === undefined) {
    return { ok: false, error: 'Invalid rank range.' }
  }

  const slots: MeldSlot[] = []
  for (let order = minOrder; order <= maxOrder; order += 1) {
    const slotRank = RANK_BY_ORDER[order]
    if (order === wildOrder) {
      const wild = wildPool[0]
      slots.push({ card: wild, slotRank, isWildFill: true })
    } else {
      const natural = naturalsByOrder.get(order)!
      slots.push({ card: natural, slotRank, isWildFill: isWildFillForSlot(natural, slotRank, suit) })
    }
  }

  const wildCount = slots.filter((s) => s.isWildFill).length
  if (wildCount > 1) {
    return { ok: false, error: 'A meld may contain at most 1 wild card.' }
  }

  const meld: Meld = {
    id: nextMeldId(),
    type: 'sequence',
    ownerTeamId,
    rank: null,
    suit,
    slots,
    wildCount,
    canBecomeLimpa: true,
    classification: 'in-progress',
    isCanasta: false,
  }

  recomputeMeldFlags(meld)
  return { ok: true, meld }
}

// ---------------------------------------------------------------------------
// Appending a single card to an existing meld (Phase 2 action)
// ---------------------------------------------------------------------------

export function canAppendToSet(meld: Meld, card: CardModel): boolean {
  if (meld.type !== 'set') return false
  if (meld.rank === '2') {
    if (card.rank === '2') return true
    if (card.rank === 'JOKER') return meld.wildCount < 1
    return false
  }
  if (card.rank === meld.rank) return true
  if ((card.rank === 'JOKER' || card.rank === '2') && meld.wildCount < 1) return true
  return false
}

export function appendToSet(meld: Meld, card: CardModel): AppendResult {
  if (!canAppendToSet(meld, card)) {
    return { ok: false, error: 'That card cannot be added to this set.' }
  }
  const isWildFill = meld.rank === '2' ? card.rank === 'JOKER' : card.rank === 'JOKER' || card.rank === '2'
  const next: Meld = {
    ...meld,
    slots: [...meld.slots, { card, slotRank: meld.rank as Rank, isWildFill }],
  }
  recomputeMeldFlags(next)
  return { ok: true, meld: next }
}

function minMaxOrder(meld: Meld): { min: number; max: number } {
  const orders = meld.slots.map((s) => RANK_ORDER[s.slotRank])
  return { min: Math.min(...orders), max: Math.max(...orders) }
}

/**
 * Determine what would happen if `card` were appended to a Sequence, without
 * mutating anything. Used both by `appendToSequence` and by UI-facing
 * "can I play this card" checks.
 */
export function canAppendToSequence(meld: Meld, card: CardModel): boolean {
  if (meld.type !== 'sequence') return false
  const suit = meld.suit as Suit
  const { min, max } = minMaxOrder(meld)

  if (card.rank !== 'JOKER' && card.rank !== '2' && card.suit === suit) {
    const order = RANK_ORDER[card.rank]
    if (order === max + 1 || order === min - 1) return true
    // Slide trigger: natural card matches a rank currently filled by a wild.
    const slotIndex = meld.slots.findIndex((s) => RANK_ORDER[s.slotRank] === order)
    if (slotIndex >= 0 && meld.slots[slotIndex].isWildFill) return true
    return false
  }

  if (card.rank === '2' && card.suit === suit) {
    // A same-suit 2 can fill its own natural slot (edge extension, or slide
    // if a wild currently occupies the '2' slot).
    const order = RANK_ORDER['2']
    if (order === max + 1 || order === min - 1) return true
    const slotIndex = meld.slots.findIndex((s) => s.slotRank === '2')
    if (slotIndex >= 0 && meld.slots[slotIndex].isWildFill) return true
  }

  if (card.rank === 'JOKER' || card.rank === '2') {
    // Generic wild extension at either edge, subject to the 1-wild limit.
    if (meld.wildCount < 1) return true
  }

  return false
}

/**
 * Appends `card` to a Sequence. When the card is a natural that fills a
 * rank slot currently occupied by a wild (the Slide trigger, section 3), the
 * caller must supply `slideEdge` ('top' | 'bottom') to say where the
 * displaced wild should relocate to. If omitted in that situation, this
 * returns `needsSlideChoice` so the UI can prompt for an edge and retry with
 * the same card and the chosen edge - the whole transform (natural placed +
 * wild relocated) then happens atomically in a single call.
 */
export function appendToSequence(
  meld: Meld,
  card: CardModel,
  slideEdge?: 'top' | 'bottom',
): AppendResult {
  if (meld.type !== 'sequence') return { ok: false, error: 'Not a sequence.' }
  if (!canAppendToSequence(meld, card)) {
    return { ok: false, error: 'That card cannot be added to this sequence.' }
  }
  const suit = meld.suit as Suit
  const { min, max } = minMaxOrder(meld)

  const isNaturalCandidate = card.suit === suit && card.rank !== 'JOKER'
  if (isNaturalCandidate) {
    const order = RANK_ORDER[card.rank]
    if (order === max + 1 || order === min - 1) {
      const isWildFill = isWildFillForSlot(card, card.rank, suit)
      const slot: MeldSlot = { card, slotRank: card.rank, isWildFill }
      const slots = order === max + 1 ? [...meld.slots, slot] : [slot, ...meld.slots]
      const next: Meld = { ...meld, slots }
      recomputeMeldFlags(next)
      return { ok: true, meld: next }
    }
    // Slide trigger: this natural fills a rank currently occupied by a wild.
    const slotIndex = meld.slots.findIndex((s) => RANK_ORDER[s.slotRank] === order)
    if (slotIndex >= 0 && meld.slots[slotIndex].isWildFill) {
      const displacedWild = meld.slots[slotIndex].card
      if (!slideEdge) {
        return {
          ok: false,
          error: 'Choose which edge the displaced wild card slides to.',
          needsSlideChoice: { displacedWildCardId: displacedWild.id },
        }
      }
      const naturalized = [...meld.slots]
      naturalized[slotIndex] = { card, slotRank: card.rank, isWildFill: false }

      const newOrder = slideEdge === 'top' ? max + 1 : min - 1
      const newSlotRank = RANK_BY_ORDER[newOrder]
      if (!newSlotRank) {
        return { ok: false, error: 'Cannot slide past the end of the rank range.' }
      }
      const wildSlot: MeldSlot = { card: displacedWild, slotRank: newSlotRank, isWildFill: true }
      const slots = slideEdge === 'top' ? [...naturalized, wildSlot] : [wildSlot, ...naturalized]
      const next: Meld = { ...meld, slots }
      recomputeMeldFlags(next)
      return { ok: true, meld: next }
    }
  }

  // Generic wild extension (Joker, or an off-suit/duplicate 2 used purely as wild).
  if (meld.wildCount < 1) {
    const orderTop = max + 1
    const orderBottom = min - 1
    const slotRank = RANK_BY_ORDER[orderTop] ?? RANK_BY_ORDER[orderBottom]
    if (slotRank) {
      // Both edges are legal for a fresh wild extension (nothing is being
      // displaced); default to the top edge unless the caller specifies
      // otherwise via slideEdge.
      const useBottom = slideEdge === 'bottom' && RANK_BY_ORDER[orderBottom] !== undefined
      const order = useBottom ? orderBottom : orderTop
      const finalSlotRank = RANK_BY_ORDER[order]
      if (finalSlotRank) {
        const slot: MeldSlot = { card, slotRank: finalSlotRank, isWildFill: true }
        const slots = order === orderTop ? [...meld.slots, slot] : [slot, ...meld.slots]
        const next: Meld = { ...meld, slots }
        recomputeMeldFlags(next)
        return { ok: true, meld: next }
      }
    }
  }

  return { ok: false, error: 'That card cannot be added to this sequence.' }
}

export function canAppendToMeld(meld: Meld, card: CardModel): boolean {
  return meld.type === 'set' ? canAppendToSet(meld, card) : canAppendToSequence(meld, card)
}

export function appendToMeld(meld: Meld, card: CardModel, slideEdge?: 'top' | 'bottom'): AppendResult {
  return meld.type === 'set' ? appendToSet(meld, card) : appendToSequence(meld, card, slideEdge)
}

// ---------------------------------------------------------------------------
// Move Wild (display-order-only repositioning within a Set - see item 7)
// ---------------------------------------------------------------------------

/**
 * Reports whether `meld` currently has exactly 1 wild card sitting at an
 * edge (first or last) slot, and if so which edge. Purely a UI helper for
 * deciding whether to show a "Move Wild" control - does not mutate.
 *
 * Only Sets are supported: a Set's slot order has no rules significance (all
 * slots share the same `slotRank`), so reordering is purely cosmetic. A
 * Sequence's slot order IS rules-significant (low-to-high rank), so its
 * wild's position is already fully determined by the Slide mechanic above
 * and must not be freely reordered.
 */
export function wildEdgeInSet(meld: Meld): 'front' | 'back' | null {
  if (meld.type !== 'set' || meld.wildCount !== 1) return null
  const idx = meld.slots.findIndex((s) => s.isWildFill)
  if (idx === 0) return 'front'
  if (idx === meld.slots.length - 1) return 'back'
  return null
}

/**
 * Moves a Set's single wild card from whichever edge it currently occupies
 * to the opposite edge (front<->back toggle). Purely a display/ordering
 * change - does not affect legality, wild count, or classification, so no
 * other meldValidation logic needs to run beyond recomputing flags (which
 * are order-independent for a Set anyway, but recomputed for consistency).
 */
export function moveWildEdgeInSet(meld: Meld): MeldResult {
  if (meld.type !== 'set') {
    return { ok: false, error: 'Move Wild is only available for Sets.' }
  }
  const edge = wildEdgeInSet(meld)
  if (!edge) {
    return { ok: false, error: 'This meld has no single wild card sitting at an edge to move.' }
  }
  const idx = edge === 'front' ? 0 : meld.slots.length - 1
  const slots = [...meld.slots]
  const [wild] = slots.splice(idx, 1)
  if (edge === 'front') {
    slots.push(wild)
  } else {
    slots.unshift(wild)
  }
  const next: Meld = { ...meld, slots }
  recomputeMeldFlags(next)
  return { ok: true, meld: next }
}

// ---------------------------------------------------------------------------
// Flags & classification
// ---------------------------------------------------------------------------

/** Recomputes `wildCount`, `isCanasta`, `canBecomeLimpa`, and `classification` in place. */
export function recomputeMeldFlags(meld: Meld): void {
  meld.wildCount = meld.slots.filter((s) => s.isWildFill).length
  meld.isCanasta = meld.slots.length >= 7

  // canBecomeLimpa is monotonic: once false, it never becomes true again.
  if (meld.canBecomeLimpa) {
    const hasJokerWild = meld.slots.some((s) => s.isWildFill && s.card.rank === 'JOKER')
    const hasMismatchedTwoWild =
      meld.type === 'sequence' &&
      meld.slots.some((s) => s.isWildFill && s.card.rank === '2' && s.card.suit !== meld.suit)
    const hasNineAndTwo =
      meld.slots.some((s) => s.slotRank === '9') && meld.slots.some((s) => s.slotRank === '2')
    const alreadyConfirmedLimpa = meld.classification === 'limpa' || meld.classification === 'limpa-2s'

    if (hasJokerWild || hasMismatchedTwoWild || (hasNineAndTwo && !alreadyConfirmedLimpa)) {
      meld.canBecomeLimpa = false
    }
  }

  if (!meld.isCanasta) {
    meld.classification = 'in-progress'
    return
  }

  const isTwosMeld = meld.rank === '2'
  if (isTwosMeld) {
    meld.classification = meld.wildCount > 0 ? 'mixed-canasta-2s' : 'limpa-2s'
    return
  }

  if (meld.wildCount > 0) {
    meld.classification = 'mixed-canasta'
  } else {
    // A wild-free 7+ meld is a Limpa only if it never tripped a
    // Limpa-disqualifying flag (see comment on `canBecomeLimpa` in
    // types/game.ts). If disqualified, it still counts as a completed
    // Canasta-sized meld but only earns the (lesser) Mixed bonus - the
    // ruleset does not specify a third bucket for this edge case, so this
    // is a deliberate judgment call.
    meld.classification = meld.canBecomeLimpa ? 'limpa' : 'mixed-canasta'
  }
}

export const CANASTA_BONUS: Record<MeldClassificationBonusKey, number> = {
  'mixed-canasta': 100,
  limpa: 200,
  'mixed-canasta-2s': 200,
  'limpa-2s': 500,
}

type MeldClassificationBonusKey = 'mixed-canasta' | 'limpa' | 'mixed-canasta-2s' | 'limpa-2s'

export function meldBonus(meld: Meld): number {
  if (meld.classification === 'in-progress') return 0
  return CANASTA_BONUS[meld.classification]
}

/** Total raw card point value of all cards currently in a meld. */
export function meldRawPoints(meld: Meld): number {
  return meld.slots.reduce((sum, s) => sum + cardPointValue(s.card), 0)
}
