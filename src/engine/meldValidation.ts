import type { CardModel, Meld, MeldSlot, Rank, Suit, TeamId } from '../types/game'
import {
  ACE_HIGH_ORDER,
  ACE_LOW_ORDER,
  RANK_BY_ORDER,
  RANK_ORDER,
  cardPointValue,
  sequenceRankOrder,
} from './cardValues'

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

type SequenceBuildAttempt = { ok: true; slots: MeldSlot[]; wildCount: number } | { ok: false; error: string }

/**
 * Attempts to build the naturals-plus-wild-pool layout for a Sequence, given
 * a fixed decision about how a same-suit 2 (if any) is being interpreted:
 * `naturalTwo` is placed into its own literal '2' slot as a natural, while
 * `extraTwos` (any other same-suit 2s beyond the one claiming the slot) join
 * `wildPoolBase` as wild cards. Passing `naturalTwo: null` treats every
 * same-suit 2 as a wild instead (they'll be found in `extraTwos`).
 *
 * This is the shared core of the old single-pass `buildSequence` logic,
 * factored out so the caller can try both interpretations of an ambiguous
 * same-suit 2 and keep whichever one is legal.
 */
function attemptSequenceBuild(
  naturalsByOrderBase: Map<number, CardModel>,
  naturalTwo: CardModel | null,
  extraTwos: CardModel[],
  wildPoolBase: CardModel[],
  suit: Suit,
): SequenceBuildAttempt {
  const naturalsByOrder = new Map(naturalsByOrderBase)
  const wildPool = [...wildPoolBase, ...extraTwos]
  if (naturalTwo) {
    naturalsByOrder.set(RANK_ORDER['2'], naturalTwo)
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
    // extending upward (the next-higher rank, including Ace-high after K)
    // and fall back to extending downward if the run is already capped at A
    // (no wraparound).
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
  // Ace is either low (A-2-3…) or high (…Q-K-A), never both in one run.
  if (minOrder <= ACE_LOW_ORDER && maxOrder >= ACE_HIGH_ORDER) {
    return { ok: false, error: 'Sequences cannot wrap around Ace (no K-A-2).' }
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

  return { ok: true, slots, wildCount }
}

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

  // Ace may be high (…Q K A) or low (A 2 3…). Try high first (default),
  // then low, so Q-K-A and A-2-3 are both legal and K-A-2 never wraps.
  const hasAce = others.some((c) => c.rank === 'A')
  const aceModes: boolean[] = hasAce ? [true, false] : [true]

  const sameSuitTwos = twos.filter((two) => two.suit === suit)
  const offSuitTwos = twos.filter((two) => two.suit !== suit)
  const wildPoolBase: CardModel[] = [...jokers, ...offSuitTwos]

  let chosen: SequenceBuildAttempt | null = null
  for (const aceHigh of aceModes) {
    const naturalsByOrderBase = new Map<number, CardModel>()
    let duplicate = false
    for (const card of others) {
      const order = sequenceRankOrder(card.rank, aceHigh)
      if (naturalsByOrderBase.has(order)) {
        duplicate = true
        break
      }
      naturalsByOrderBase.set(order, card)
    }
    if (duplicate) continue

    // A same-suit 2 is ambiguous: natural-in-slot vs wild. Prefer natural.
    const attemptWithNaturalTwo =
      sameSuitTwos.length > 0
        ? attemptSequenceBuild(naturalsByOrderBase, sameSuitTwos[0], sameSuitTwos.slice(1), wildPoolBase, suit)
        : attemptSequenceBuild(naturalsByOrderBase, null, [], wildPoolBase, suit)

    let attempt = attemptWithNaturalTwo
    if (!attempt.ok && sameSuitTwos.length > 0) {
      const attemptAllWild = attemptSequenceBuild(naturalsByOrderBase, null, sameSuitTwos, wildPoolBase, suit)
      if (attemptAllWild.ok) attempt = attemptAllWild
    }
    if (attempt.ok) {
      chosen = attempt
      break
    }
    if (!chosen) chosen = attempt
  }

  if (!chosen || !chosen.ok) {
    return chosen ?? { ok: false, error: 'Not a legal sequence with those cards.' }
  }

  const { slots, wildCount } = chosen

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

/**
 * Whether this sequence treats Ace as high (after King). Ace at the high end
 * of the ordered slots ⇒ high; Ace at the low end ⇒ low (A-2-3…). Melds
 * without an Ace default to high so K can still grow to A.
 */
export function meldUsesAceHigh(meld: Meld): boolean {
  const aceIdx = meld.slots.findIndex((s) => s.slotRank === 'A')
  if (aceIdx < 0) return true
  return aceIdx === meld.slots.length - 1
}

function minMaxOrder(meld: Meld): { min: number; max: number } {
  const aceHigh = meldUsesAceHigh(meld)
  const orders = meld.slots.map((s) => sequenceRankOrder(s.slotRank, aceHigh))
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
    const aceHigh = meldUsesAceHigh(meld)
    // Ace can extend a K-high run (high) or a 2-low run (low).
    if (card.rank === 'A') {
      if (max === RANK_ORDER.K || min === RANK_ORDER['2']) return true
      const aceSlot = meld.slots.findIndex((s) => s.slotRank === 'A')
      if (aceSlot >= 0 && meld.slots[aceSlot].isWildFill) return true
      return false
    }
    const order = sequenceRankOrder(card.rank, aceHigh)
    if (order === max + 1 || order === min - 1) return true
    // Slide trigger: natural card matches a rank currently filled by a wild.
    const slotIndex = meld.slots.findIndex((s) => sequenceRankOrder(s.slotRank, aceHigh) === order)
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
    const aceHigh = meldUsesAceHigh(meld)
    let order: number | null = null
    if (card.rank === 'A') {
      if (max === RANK_ORDER.K) order = ACE_HIGH_ORDER
      else if (min === RANK_ORDER['2']) order = ACE_LOW_ORDER
    } else {
      order = sequenceRankOrder(card.rank, aceHigh)
    }

    if (order !== null && (order === max + 1 || order === min - 1)) {
      const isWildFill = isWildFillForSlot(card, card.rank, suit)
      const slot: MeldSlot = { card, slotRank: card.rank, isWildFill }
      const slots = order === max + 1 ? [...meld.slots, slot] : [slot, ...meld.slots]
      const next: Meld = { ...meld, slots }
      recomputeMeldFlags(next)
      return { ok: true, meld: next }
    }
    // Slide trigger: this natural fills a rank currently occupied by a wild.
    const slideOrder = order ?? sequenceRankOrder(card.rank, aceHigh)
    const slotIndex = meld.slots.findIndex((s) => sequenceRankOrder(s.slotRank, aceHigh) === slideOrder)
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
// Move Wild — Sets (cosmetic edge toggle) + Sequences (relocate / reinterpret)
// ---------------------------------------------------------------------------

export type WildMoveInfo =
  | { kind: 'set'; edge: 'front' | 'back'; nextLabel: string }
  | { kind: 'sequence'; nextLabel: string }

/**
 * Reports whether `meld` has a movable wild (or a same-suit natural 2 that
 * can be reinterpreted as a wild) and what the next Move Wild action would
 * do. Used by the UI to show/hide the control and label it.
 *
 * Sequences: a same-suit 2 sitting as a natural in the '2' slot (e.g. 2-3-4)
 * can be pulled out and placed as a wild on an open end (e.g. 3-4-5[wild]),
 * which is exactly what lets a player then append a 6. Existing isWildFill
 * wilds can likewise be cycled between the open ends (and back to a natural
 * 2 slot when the wild card is a same-suit 2 and that slot is adjacent).
 */
export function getWildMoveInfo(meld: Meld): WildMoveInfo | null {
  if (meld.type === 'set') {
    const edge = wildEdgeInSet(meld)
    if (!edge) return null
    return {
      kind: 'set',
      edge,
      nextLabel: edge === 'front' ? 'Move wild to back' : 'Move wild to front',
    }
  }
  if (meld.type === 'sequence') {
    const plan = planSequenceWildMove(meld)
    if (!plan) return null
    return { kind: 'sequence', nextLabel: plan.nextLabel }
  }
  return null
}

/**
 * Reports whether `meld` currently has exactly 1 wild card sitting at an
 * edge (first or last) slot, and if so which edge. Sets only — kept for
 * existing callers/tests; prefer {@link getWildMoveInfo} for new UI.
 */
export function wildEdgeInSet(meld: Meld): 'front' | 'back' | null {
  if (meld.type !== 'set' || meld.wildCount !== 1) return null
  const idx = meld.slots.findIndex((s) => s.isWildFill)
  if (idx === 0) return 'front'
  if (idx === meld.slots.length - 1) return 'back'
  return null
}

/**
 * Moves / reinterprets a wild within a meld:
 * - Set: toggle wild between front and back (cosmetic).
 * - Sequence: cycle a wild (or a natural same-suit 2) between legal open-end
 *   placements so the player can free an end for appending (e.g. 2-3-4 →
 *   3-4-5[2 as wild] → append 6).
 */
export function moveWildInMeld(meld: Meld): MeldResult {
  if (meld.type === 'set') return moveWildEdgeInSet(meld)
  if (meld.type === 'sequence') return moveWildInSequence(meld)
  return { ok: false, error: 'Move Wild is not available for this meld.' }
}

/**
 * Moves a Set's single wild card from whichever edge it currently occupies
 * to the opposite edge (front<->back toggle).
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

type SequenceWildPlacement = {
  card: CardModel
  slots: MeldSlot[]
  nextLabel: string
  /** Stable key so we can detect the "current" placement when cycling. */
  key: string
}

function planSequenceWildMove(meld: Meld): SequenceWildPlacement | null {
  if (meld.type !== 'sequence' || !meld.suit) return null

  // Prefer an existing wild fill; otherwise a same-suit natural 2 in its own slot.
  let sourceIdx = meld.slots.findIndex((s) => s.isWildFill)
  if (sourceIdx < 0) {
    sourceIdx = meld.slots.findIndex(
      (s) => s.card.rank === '2' && s.card.suit === meld.suit && s.slotRank === '2' && !s.isWildFill,
    )
  }
  if (sourceIdx < 0) return null

  const card = meld.slots[sourceIdx].card
  const remaining = meld.slots.filter((_, i) => i !== sourceIdx)
  if (remaining.length < 2) return null

  // Infer Ace-high/low from the remaining run (Ace may have been the moved wild).
  const aceHigh =
    remaining.some((s) => s.slotRank === 'A')
      ? remaining.findIndex((s) => s.slotRank === 'A') === remaining.length - 1
      : meldUsesAceHigh(meld)

  // Remaining naturals must already form a contiguous run (no gaps).
  for (let i = 1; i < remaining.length; i += 1) {
    const prev = sequenceRankOrder(remaining[i - 1].slotRank, aceHigh)
    const curr = sequenceRankOrder(remaining[i].slotRank, aceHigh)
    if (curr !== prev + 1) return null
  }

  const min = sequenceRankOrder(remaining[0].slotRank, aceHigh)
  const max = sequenceRankOrder(remaining[remaining.length - 1].slotRank, aceHigh)
  const suit = meld.suit

  type Option = { key: string; nextLabel: string; build: () => MeldSlot[] }
  const options: Option[] = []

  // Restore as natural 2 when the card is a same-suit 2 and slot 2 is adjacent.
  if (card.rank === '2' && card.suit === suit) {
    const twoOrder = RANK_ORDER['2']
    if (twoOrder === min - 1) {
      options.push({
        key: 'natural:2:bottom',
        nextLabel: 'Move 2 to natural low end',
        build: () => [
          { card, slotRank: '2', isWildFill: false },
          ...remaining.map((s) => ({ ...s, isWildFill: isWildFillForSlot(s.card, s.slotRank, suit) })),
        ],
      })
    }
    if (twoOrder === max + 1) {
      options.push({
        key: 'natural:2:top',
        nextLabel: 'Move 2 to natural high end',
        build: () => [
          ...remaining.map((s) => ({ ...s, isWildFill: isWildFillForSlot(s.card, s.slotRank, suit) })),
          { card, slotRank: '2', isWildFill: false },
        ],
      })
    }
  }

  const topRank = RANK_BY_ORDER[max + 1]
  if (topRank) {
    options.push({
      key: `wild:${topRank}:top`,
      nextLabel: `Move wild to ${topRank} (high end)`,
      build: () => [
        ...remaining.map((s) => ({ ...s, isWildFill: false })),
        { card, slotRank: topRank, isWildFill: true },
      ],
    })
  }

  const bottomRank = RANK_BY_ORDER[min - 1]
  if (bottomRank) {
    // Avoid duplicating the natural-2 option when bottomRank is 2 and card is same-suit 2.
    const isDuplicateNaturalTwo = card.rank === '2' && card.suit === suit && bottomRank === '2'
    if (!isDuplicateNaturalTwo) {
      options.push({
        key: `wild:${bottomRank}:bottom`,
        nextLabel: `Move wild to ${bottomRank} (low end)`,
        build: () => [
          { card, slotRank: bottomRank, isWildFill: true },
          ...remaining.map((s) => ({ ...s, isWildFill: false })),
        ],
      })
    }
  }

  if (options.length === 0) return null

  // Detect current placement key.
  const current = meld.slots[sourceIdx]
  let currentKey: string
  if (!current.isWildFill && current.slotRank === '2') {
    currentKey = sourceIdx === 0 ? 'natural:2:bottom' : 'natural:2:top'
  } else if (sourceIdx === 0) {
    currentKey = `wild:${current.slotRank}:bottom`
  } else {
    currentKey = `wild:${current.slotRank}:top`
  }

  const currentOptIdx = options.findIndex((o) => o.key === currentKey)
  const nextOpt = options[(currentOptIdx + 1) % options.length]
  // If we only found the current placement, there's nowhere else to go.
  if (options.length === 1 && currentOptIdx === 0) return null

  return {
    card,
    slots: nextOpt.build(),
    nextLabel: nextOpt.nextLabel,
    key: nextOpt.key,
  }
}

function moveWildInSequence(meld: Meld): MeldResult {
  const plan = planSequenceWildMove(meld)
  if (!plan) {
    return {
      ok: false,
      error:
        'No legal wild move on this sequence (need a wild, or a same-suit 2 that can relocate to an open end).',
    }
  }
  const next: Meld = { ...meld, slots: plan.slots }
  recomputeMeldFlags(next)
  // Still exactly one wild after a wild relocation; natural-2 restore has wildCount 0.
  if (next.slots.filter((s) => s.isWildFill).length > 1) {
    return { ok: false, error: 'A meld may contain at most 1 wild card.' }
  }
  if (next.slots.length < 3) {
    return { ok: false, error: 'A sequence needs at least 3 cards.' }
  }
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
