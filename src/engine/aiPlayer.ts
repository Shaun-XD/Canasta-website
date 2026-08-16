import type { CardModel, Meld, Rank, Suit, Team, TeamId } from '../types/game'
import {
  appendToMeld,
  buildSequence,
  buildSet,
  canAppendToMeld,
  cardWouldBeWildFill,
  isCompletedLimpa,
  limpaWildAppendAllowed,
  meldUsesAceHigh,
  type AppendContext,
} from './meldValidation'
import { attemptMeldAction } from './turnEngine'
import { cardPointValue, RANK_BY_ORDER, RANK_ORDER, sequenceRankOrder } from './cardValues'

/**
 * Greedy plus-sum heuristic for mock/enemy bots.
 *
 * Information: own hand + public table melds + discard pile only (never
 * peeks other players' hands).
 *
 * Hand floor: never empty to 0 unless claiming Pozzetto or going for Show.
 * After Pozzetto is claimed, keep ≥1 card (so ≥2 before the mandatory discard).
 *
 * Wilds (Jokers / 2s): conserved unless essential — canasta finish, gap /
 * 2-natural set openers, or a dry high-probability meld (needed cards not
 * mostly locked on enemy piles). Never spoil a Limpa except the ≥400 /
 * last-card / only-legal-wild exception.
 *
 * Meld policy: append onto existing piles before opening new ones. Grow
 * toward canastas rather than many 3-card seeds. 7-8-9 are sequence
 * connectors — almost never open them as sets.
 */

/** Copies of each natural rank in a 2-deck Canasta shoe (4 suits × 2). */
const COPIES_PER_RANK = 8

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
  /**
   * Heavy penalty for spending a wild casually. Essential uses (gap fill,
   * 2-natural set opener, canasta completion) still clear this bar.
   */
  wildSpend: -220,
  /** Bonus for Top Touch unlocking the rest of the discard pile. */
  pileRemainderCard: 12,
  /** Extra Top Touch incentive when the immediate meld itself is strong. */
  topTouchUnlock: 50,
  /**
   * Legacy flat feed weight — kept for burn-opportunity penalties when a card
   * that could Slide/feed is wasted opening a new meld. Remainder pile
   * scoring uses {@link scoreVitalRemainder} tiers instead.
   */
  pileFeedExisting: 140,
  /** Extra when that feed is a Slide (natural replaces a wild fill). */
  pileFeedSlide: 90,
  /** Prefer Sliding a natural into a wild slot over a plain edge append. */
  slideNaturalize: 160,
  /**
   * Vitality tiers for buried discard cards (remainder after Top Touch).
   * Only critical/important should justify a redundant top or a wild unlock.
   */
  vitalCritical: 340,
  vitalImportant: 170,
  /** Mere edge-extend / short-meld feed — intentionally small. */
  vitalUseful: 28,
  /**
   * Extra surcharge (on top of wildSpend) when the unlocking meld burns a
   * wild. Cleared only when remainder vitality is high enough.
   */
  topTouchWildSurcharge: -200,
  /** Minimum vital score to allow burning a wild in the unlock meld. */
  topTouchWildVitalMin: 300,
  /**
   * If remainder has no important/critical card, the unlock meld alone must
   * score at least this (no remainder bonuses) — blocks scooping for junk
   * tops just to grab ordinary connectors.
   */
  topTouchMinUnlockWithoutVital: 180,
  /**
   * Cost relief when discarding a rank whose canasta is already impossible
   * from public board counts (e.g. enemy locked 4+ of 8 aces). Still loses to
   * feedOpponent if that discard would complete their meld.
   */
  hopelessRankDiscardRelief: 55,
  /** Penalty for discarding a card that was part of a near-meld (2-of-kind / 2-run). */
  breakNearMeld: 45,
  /** Discarding a card that opponents can use immediately (public melds). */
  feedOpponent: 480,
  /**
   * Softer feed cost only when the rank is already hopeless for us and we
   * still hold 2+ copies. Direct feeds of live ranks stay at feedOpponent.
   */
  feedOpponentSoft: 70,
  /** Discarding a card that would feed our own/teammate public melds. */
  feedTeammate: 70,
  /** Near-future feed for opponents (one rank off a sequence edge). */
  feedOpponentNear: 90,
  /** Base cost bump so wilds are almost never discarded. */
  discardWild: 400,
  /**
   * Bonus when spending a wild on a dry, high-completion-odds meld (not a
   * canasta finish — that already gets canastaComplete).
   */
  wildHighOddsExtend: 80,
  /**
   * Penalty when a new set would consume a card that already forms a legal
   * 3+ same-suit sequence in hand. Applied in scoring as a backup to the
   * hard skip when opening new sets.
   */
  setStealsSequence: -400,
  /**
   * Penalty for opening a 3-card set. Kept modest so a 2-natural + wild
   * opener still scores positive; the hard gate blocks extra 3-card seeds
   * when the table already has short piles to grow.
   */
  shortNewMeld: -70,
  /** Prefer sequences over equal-length sets (beats Ace/8 point-value ties). */
  sequenceOverSet: 40,
  /** Prefer feeding a 7/8/9 onto a sequence rather than a competing set. */
  connectorOnSequence: 120,
  /** Extra discard cost for 7/8/9 (sequence glue). */
  connectorDiscard: 35,
  /** Extra discard cost when a same-suit neighbor of a connector is in hand. */
  connectorNeighborDiscard: 40,
  /**
   * Extra canasta-progress on appends as a meld approaches 7
   * (4→5, 5→6, 6→7 on top of the base canastaProgress).
   */
  canastaGrowNear: 55,
} as const

/**
 * Public-table context for bot decisions. Hands of other seats are never
 * included — only melds/discard that every player can see.
 */
export interface AiPlayContext {
  teamId: TeamId
  ownMelds: Meld[]
  opponentMelds: Meld[]
  /** Public discard pile (for board card counts). */
  discardPile: CardModel[]
  /** Team already claimed the 11-card Pozzetto reserve. */
  pozzettoClaimed: boolean
  /**
   * Reserve activated + canasta bonus ≥300 — bot may empty hand for Show.
   * When false after Pozzetto, bot keeps ≥1 card (foul to empty otherwise).
   */
  mayEmptyForShow: boolean
  /**
   * Own-hand size before the planned append (Limpa wild exception needs === 1).
   * Planners update this as they simulate.
   */
  handSize?: number
}

export function defaultAiContext(teamId: TeamId, ownMelds: Meld[] = []): AiPlayContext {
  return {
    teamId,
    ownMelds,
    opponentMelds: [],
    discardPile: [],
    pozzettoClaimed: false,
    mayEmptyForShow: false,
  }
}

/** 7-8-9 are sequence glue; they should almost never open a set. */
export const CONNECTOR_RANKS: readonly Rank[] = ['7', '8', '9']

export function isConnectorRank(rank: Rank): boolean {
  return rank === '7' || rank === '8' || rank === '9'
}

/** Allow a 7/8/9 set only when the canasta is in hand, or when going out. */
export function mayOpenConnectorSet(naturalCount: number, ctx: AiPlayContext): boolean {
  return naturalCount >= 5 || ctx.mayEmptyForShow
}

/** Minimal Team stub for Limpa-protection checks from public melds. */
function teamStubFromCtx(ctx: AiPlayContext): Team {
  return {
    id: ctx.teamId,
    name: ctx.teamId,
    playerIds: [],
    melds: ctx.ownMelds,
    score: 0,
    hasGoneOut: false,
    pozzetto: {
      claimed: ctx.pozzettoClaimed,
      claimedByPlayerId: null,
      activated: ctx.mayEmptyForShow,
    },
  }
}

function appendCtxFromAi(ctx: AiPlayContext, handSize: number): AppendContext {
  return { team: teamStubFromCtx(ctx), handSize }
}

/**
 * True when the selected discard cards (always including the top) can all
 * be appended onto `meld` in some order — including sequential extensions
 * such as 8 then 9 onto 5-6-7, which fail a naive per-card `canAppend` check
 * against the pre-append meld.
 */
function canAppendDiscardSelection(
  meld: Meld,
  allMelds: Meld[],
  discardPile: CardModel[],
  selectedDiscardIds: string[],
  ctx: AiPlayContext,
): boolean {
  const result = attemptMeldAction({
    hand: [],
    team: { ...teamStubFromCtx(ctx), melds: allMelds },
    selectedHandCardIds: [],
    targetMeldId: meld.id,
    topTouch: { discardPile, selectedDiscardIds },
  })
  return result.ok
}

/** Count visible copies of `rank` on public melds + discard (not private hands). */
function countVisibleRank(
  rank: Rank,
  ownMelds: Meld[],
  opponentMelds: Meld[],
  discardPile: CardModel[],
): number {
  let n = 0
  for (const meld of [...ownMelds, ...opponentMelds]) {
    for (const slot of meld.slots) {
      if (slot.card.rank === rank) n += 1
    }
  }
  for (const card of discardPile) {
    if (card.rank === rank) n += 1
  }
  return n
}

/**
 * How many copies of a set's rank sit on *enemy* melds (blocks completion).
 */
function countEnemyRankOnMelds(rank: Rank, opponentMelds: Meld[]): number {
  let n = 0
  for (const meld of opponentMelds) {
    for (const slot of meld.slots) {
      if (slot.card.rank === rank) n += 1
    }
  }
  return n
}

/**
 * True when a wild append is justified by board odds: meld is close (5–6
 * cards), still needs 1–2 naturals, and those naturals are not mostly locked
 * on enemy piles (so they may still be in stock / teammate hand).
 */
export function isHighProbabilityWildExtend(meld: Meld, ctx: AiPlayContext): boolean {
  const len = meld.slots.length
  if (len < 5 || len >= 7) return false
  if (meld.wildCount >= 1) return false
  if (isCompletedLimpa(meld)) return false

  const need = 7 - len // 1 or 2
  if (need > 2) return false

  if (meld.type === 'set' && meld.rank) {
    const enemyHas = countEnemyRankOnMelds(meld.rank, ctx.opponentMelds)
    const visible = countVisibleRank(meld.rank, ctx.ownMelds, ctx.opponentMelds, ctx.discardPile)
    const unknownLeft = Math.max(0, COPIES_PER_RANK - visible)
    // Good pile: enough unknown copies for the cards we still need, and
    // enemy hasn't vacuumed most of the rank onto their melds.
    if (unknownLeft < need) return false
    if (enemyHas >= COPIES_PER_RANK / 2) return false
    return true
  }

  if (meld.type === 'sequence' && meld.suit) {
    // Prefer sequences that still have open natural edges and aren't Ace-capped
    // both ways. Count how many same-suit ranks that could extend are already
    // on enemy sequences of that suit.
    const aceHigh = meldUsesAceHigh(meld)
    const orders = meld.slots.map((s) => sequenceRankOrder(s.slotRank, aceHigh))
    const min = Math.min(...orders)
    const max = Math.max(...orders)
    const edgeCandidates: Rank[] = []
    for (const edge of [max + 1, min - 1]) {
      const r = RANK_BY_ORDER[edge]
      if (r) edgeCandidates.push(r)
    }
    if (edgeCandidates.length === 0) return false

    let enemyEdgeLocks = 0
    for (const rank of edgeCandidates) {
      for (const om of ctx.opponentMelds) {
        if (om.type !== 'sequence' || om.suit !== meld.suit) continue
        if (om.slots.some((s) => s.card.rank === rank && s.card.suit === meld.suit)) {
          enemyEdgeLocks += 1
        }
      }
    }
    // If both natural edges are sitting on enemy piles, odds are poor.
    return enemyEdgeLocks < edgeCandidates.length
  }

  return false
}

/**
 * Cards that must remain in hand after the action phase.
 * - Show path: 0
 * - Pozzetto already claimed: 2 (one to discard, one to keep)
 * - Pozzetto unclaimed: 0 (emptying claims the reserve)
 */
export function actionRetainFloor(ctx: AiPlayContext): number {
  if (ctx.mayEmptyForShow) return 0
  if (ctx.pozzettoClaimed) return 2
  return 0
}

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

function inferMeldKind(cards: CardModel[]): 'set' | 'sequence' {
  const naturals = cards.filter((c) => !isWild(c))
  if (naturals.length === 0) return 'set'
  const rank = naturals[0].rank
  return naturals.every((c) => c.rank === rank) ? 'set' : 'sequence'
}

/** Score for laying `cards` as a brand-new meld (Set or Sequence). */
export function scoreNewMeld(
  cards: CardModel[],
  opts?: { kind?: 'set' | 'sequence'; ctx?: AiPlayContext },
): number {
  const kind = opts?.kind ?? inferMeldKind(cards)
  let score = cards.length * AI_WEIGHTS.cardLaid + pointsOf(cards) * AI_WEIGHTS.pointValue
  const wilds = countWilds(cards)
  if (wilds > 0) score += wilds * AI_WEIGHTS.wildSpend
  if (cards.length >= 7) score += AI_WEIGHTS.canastaComplete
  else if (cards.length >= 5) score += (cards.length - 4) * AI_WEIGHTS.canastaProgress
  if (kind === 'sequence') score += AI_WEIGHTS.sequenceOverSet
  if (kind === 'set' && cards.length === 3) score += AI_WEIGHTS.shortNewMeld
  return score
}

/** True when `card` naturalizes a wild-filled slot (Slide), not just an open end. */
export function isSlideNaturalization(meld: Meld, card: CardModel): boolean {
  if (meld.type !== 'sequence') return false
  if (!card.suit || card.suit !== meld.suit) return false
  if (card.rank === 'JOKER') return false
  return meld.slots.some((s) => s.isWildFill && s.slotRank === card.rank)
}

/**
 * Whether spending a wild on this append is essential (not a casual extend).
 * Allowed: canasta finish (6→7), Limpa exception, or dry high-odds extend.
 */
export function isEssentialWildAppend(
  card: CardModel,
  meld: Meld,
  ctx: AiPlayContext = defaultAiContext('team-a'),
): boolean {
  if (!isWild(card)) return true

  // Never spoil a Limpa unless the ≥400 / last-card / only-legal exception.
  if (isCompletedLimpa(meld) && cardWouldBeWildFill(meld, card)) {
    const handSize = ctx.handSize ?? 0
    return limpaWildAppendAllowed(meld, card, appendCtxFromAi(ctx, handSize))
  }

  if (meld.slots.length >= 6) return true // canasta / limpa finish
  if (isHighProbabilityWildExtend(meld, ctx)) return true
  return false
}

/** Score for appending one card onto an existing meld. */
export function scoreAppend(
  card: CardModel,
  meld: Meld,
  ctx: AiPlayContext = defaultAiContext('team-a'),
): number {
  if (isWild(card) && !isEssentialWildAppend(card, meld, ctx)) return -Infinity
  let score = AI_WEIGHTS.cardLaid + cardPointValue(card) * AI_WEIGHTS.pointValue
  if (isWild(card)) score += AI_WEIGHTS.wildSpend
  const nextLen = meld.slots.length + 1
  if (nextLen >= 7 && meld.slots.length < 7) score += AI_WEIGHTS.canastaComplete
  else if (nextLen >= 5) score += AI_WEIGHTS.canastaProgress
  if (nextLen >= 5 && nextLen <= 7) score += AI_WEIGHTS.canastaGrowNear
  if (isWild(card) && isHighProbabilityWildExtend(meld, ctx) && meld.slots.length < 6) {
    score += AI_WEIGHTS.wildHighOddsExtend
  }
  // Prefer feeding the longest / closest-to-canasta meld when choosing.
  score += meld.slots.length * 3
  // Prefer piles with more unknown completion supply (board-aware).
  if (meld.type === 'set' && meld.rank) {
    const visible = countVisibleRank(meld.rank, ctx.ownMelds, ctx.opponentMelds, ctx.discardPile)
    score += Math.max(0, COPIES_PER_RANK - visible) * 2
  }
  // Sliding a natural into a wild slot frees the wild — strongly preferred
  // over opening a fresh set with that natural (e.g. 7♠ into 6-★-8-9-10).
  if (isSlideNaturalization(meld, card)) score += AI_WEIGHTS.slideNaturalize
  // 7/8/9: sequence beats set when both are legal feeds.
  if (!isWild(card) && isConnectorRank(card.rank)) {
    if (meld.type === 'sequence') {
      score += AI_WEIGHTS.connectorOnSequence
    } else if (meld.type === 'set') {
      const aCtx = appendCtxFromAi(ctx, ctx.handSize ?? 0)
      const seqAlt = ctx.ownMelds.some(
        (m) => m.id !== meld.id && m.type === 'sequence' && canAppendToMeld(m, card, aCtx),
      )
      if (seqAlt) score -= AI_WEIGHTS.connectorOnSequence
    }
  }
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

/** How important a buried remainder card is for Top Touch decisions. */
export type VitalTier = 'none' | 'useful' | 'important' | 'critical'

const VITAL_RANK: Record<VitalTier, number> = {
  none: 0,
  useful: 1,
  important: 2,
  critical: 3,
}

function maxVitalTier(a: VitalTier, b: VitalTier): VitalTier {
  return VITAL_RANK[a] >= VITAL_RANK[b] ? a : b
}

/**
 * Classify a single remainder card against public team melds.
 *
 * - critical: finishes a canasta (6→7), or Slides a natural into a wild slot
 *   on a near-canasta (≥5) meld
 * - important: extends a 5-card meld toward canasta, or Slides on a shorter meld
 * - useful: any other legal append (short melds / ordinary connectors)
 * - none: dead in hand for now
 *
 * Ordinary connectors must NOT look as valuable as a true canasta-key card.
 */
export function classifyRemainderVitality(card: CardModel, melds: Meld[]): {
  tier: VitalTier
  score: number
} {
  let tier: VitalTier = 'none'
  let score = 0

  for (const meld of melds) {
    if (!canAppendToMeld(meld, card)) continue
    const len = meld.slots.length
    const slides = isSlideNaturalization(meld, card)
    const finishesCanasta = len >= 6 && len < 7

    let cardTier: VitalTier = 'useful'
    let cardScore: number = AI_WEIGHTS.vitalUseful

    if (finishesCanasta) {
      cardTier = 'critical'
      cardScore = AI_WEIGHTS.vitalCritical + AI_WEIGHTS.canastaComplete * 0.25
    } else if (slides && len >= 5) {
      cardTier = 'critical'
      cardScore = AI_WEIGHTS.vitalCritical
    } else if (slides) {
      cardTier = 'important'
      cardScore = AI_WEIGHTS.vitalImportant + AI_WEIGHTS.pileFeedSlide * 0.5
    } else if (len >= 5) {
      cardTier = 'important'
      cardScore = AI_WEIGHTS.vitalImportant
    }

    if (VITAL_RANK[cardTier] > VITAL_RANK[tier] || cardScore > score) {
      tier = maxVitalTier(tier, cardTier)
      score = Math.max(score, cardScore)
    }
  }

  return { tier, score }
}

export interface VitalRemainderScore {
  score: number
  maxTier: VitalTier
  criticalCount: number
  importantCount: number
}

/**
 * Score buried pile cards after a legal Top Touch unlock. Caps stacking so a
 * pile full of ordinary connectors cannot outvote stock / wild conservation.
 */
export function scoreVitalRemainder(cards: CardModel[], melds: Meld[]): VitalRemainderScore {
  let score = 0
  let maxTier: VitalTier = 'none'
  let criticalCount = 0
  let importantCount = 0
  let usefulCount = 0

  for (const card of cards) {
    const { tier, score: cardScore } = classifyRemainderVitality(card, melds)
    maxTier = maxVitalTier(maxTier, tier)
    if (tier === 'critical') {
      criticalCount += 1
      score += cardScore
    } else if (tier === 'important') {
      importantCount += 1
      // Diminishing returns on multiple "almost" cards.
      score += importantCount === 1 ? cardScore : cardScore * 0.45
    } else if (tier === 'useful') {
      usefulCount += 1
      // At most ~2 ordinary connectors count; the rest are noise.
      if (usefulCount <= 2) score += cardScore
    }
  }

  return { score, maxTier, criticalCount, importantCount }
}

/** True when remainder vitality is high enough to burn a wild on the unlock. */
export function vitalJustifiesWildUnlock(vital: VitalRemainderScore, wildsInUnlock: number): boolean {
  if (wildsInUnlock <= 0) return true
  if (vital.criticalCount >= 1) return true
  return vital.score >= AI_WEIGHTS.topTouchWildVitalMin
}

/**
 * Intrinsic unlock value (no remainder bonuses). Used to decide whether a
 * Top Touch is justified when the pile has no important/critical cards.
 */
function unlockIntrinsicScore(
  meldCards: CardModel[],
  kind: 'set' | 'sequence' | 'append',
  targetMeld?: Meld | null,
): number {
  if (kind === 'append' && targetMeld && meldCards.length > 0) {
    // Use the strongest single append (usually the top card).
    let best = 0
    for (const card of meldCards) {
      const s = scoreAppend(card, targetMeld)
      if (Number.isFinite(s) && s > best) best = s
    }
    return best
  }
  return scoreNewMeld(meldCards)
}

/**
 * Net Top Touch score after vitality gates. Returns null when the plan should
 * be rejected (ordinary connectors only + weak/redundant unlock, or wild burn
 * without true vital payoff).
 */
export function scoreTopTouchPlan(opts: {
  meldCards: CardModel[]
  remainderPile: CardModel[]
  kind: 'set' | 'sequence' | 'append'
  melds: Meld[]
  targetMeld?: Meld | null
  burnPenalty?: number
  ctx?: AiPlayContext
}): number | null {
  const wildsInUnlock = countWilds(opts.meldCards)
  const vital = scoreVitalRemainder(opts.remainderPile, opts.melds)
  if (!vitalJustifiesWildUnlock(vital, wildsInUnlock)) return null

  if (opts.kind === 'set' && isConnectorRankSet(opts.meldCards)) {
    if (!allowConnectorSetUnlock(opts.meldCards, vital, opts.ctx)) return null
  }

  const intrinsic = unlockIntrinsicScore(opts.meldCards, opts.kind, opts.targetMeld)
  const hasRealVital = vital.maxTier === 'important' || vital.maxTier === 'critical'

  // Ordinary "useful" connectors must not justify manufacturing a new set/
  // sequence just to scoop the pile. Append unlocks (top plays onto an
  // existing meld) are always legitimate when the append itself scores.
  // Constructed unlocks need a stronger intrinsic bar when the pile has no
  // important/critical card.
  if (!hasRealVital) {
    if (vital.maxTier === 'useful' && opts.kind !== 'append') return null
    if (opts.kind === 'append') {
      if (!Number.isFinite(intrinsic) || intrinsic <= 0) return null
    } else if (intrinsic < AI_WEIGHTS.topTouchMinUnlockWithoutVital) {
      return null
    }
  }

  const base = scoreTopTouchUnlock({
    meldCards: opts.meldCards,
    remainderPile: opts.remainderPile,
    kind: opts.kind,
  })
  // Burn penalty only for constructed new melds — append unlocks ARE the feed.
  const burn = opts.kind === 'append' ? 0 : (opts.burnPenalty ?? 0)
  let score = base + vital.score - burn
  // Append unlocks need the real append heuristic (Slide / canasta), not just
  // flat cardLaid from scoreTopTouchUnlock.
  if (opts.kind === 'append' && opts.targetMeld) {
    score += Math.max(0, intrinsic - AI_WEIGHTS.cardLaid)
  }
  if (wildsInUnlock > 0) {
    score += wildsInUnlock * AI_WEIGHTS.topTouchWildSurcharge
  }
  return score
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
      : scoreNewMeld(opts.meldCards, { kind: opts.kind })
  const remainder =
    opts.remainderPile.length * AI_WEIGHTS.pileRemainderCard +
    pointsOf(opts.remainderPile) * AI_WEIGHTS.pointValue * 0.25
  return meldScore + remainder + AI_WEIGHTS.topTouchUnlock
}

/**
 * Finds legal new Sets/Sequences in `hand`, repeatedly picking the highest
 * plus-sum candidate that is still strategically sound.
 *
 * Hold-backs (do not auto-dump):
 * - Cards that already append onto a team meld
 * - Same-suit hand runs that sit 1–2 ranks off an existing team sequence
 *   (e.g. table 6-7-8♠, hand 10-J-Q♠ — wait for 9/joker to join toward canasta)
 * - Sets whose canasta is impossible from public board counts (enemy locked
 *   too many copies of the rank)
 * - 7/8/9 sets unless 5+ naturals are in hand or the team is going out
 * - Extra 3-card openers when the table already has 2+ short (<5) piles
 *
 * Among brand-new melds, Sequences beat Sets on equal plus-sum scores.
 */
export function planAiMelds(
  hand: CardModel[],
  teamId: TeamId,
  existingMelds: Meld[] = [],
  ctx: AiPlayContext = defaultAiContext(teamId, existingMelds),
): { plans: AiMeldPlan[]; remainingHand: CardModel[] } {
  const plans: AiMeldPlan[] = []
  let remaining = [...hand]
  const blockedSetRanks = ranksWithExistingSet(existingMelds)
  // Grows as we open melds this pass so later cards can be reserved to feed them.
  let tableMelds = [...existingMelds]
  const heldAside: CardModel[] = []
  const floor = actionRetainFloor(ctx)

  for (let guard = 0; guard < 10; guard += 1) {
    const bridgeIds = bridgeReservedCardIds(remaining, tableMelds)
    const playable: CardModel[] = []
    for (const card of remaining) {
      // Hold naturals that can feed table melds; never hold wilds for casual append.
      const feeds = tableMelds.some((m) => {
        const aCtx = appendCtxFromAi(ctx, remaining.length)
        return (
          canAppendToMeld(m, card, aCtx) &&
          (!isWild(card) || isEssentialWildAppend(card, m, { ...ctx, handSize: remaining.length }))
        )
      })
      if (feeds || bridgeIds.has(card.id)) heldAside.push(card)
      else playable.push(card)
    }
    remaining = playable

    const best = findBestNewMeld(remaining, teamId, blockedSetRanks, {
      ...ctx,
      ownMelds: tableMelds,
    })
    if (!best || best.score <= 0) break
    if (remaining.length - best.plan.cardIds.length < floor) break

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

  return { plans, remainingHand: [...remaining, ...heldAside] }
}

/**
 * Gap (in ranks) between two disjoint same-suit runs. Null if they overlap
 * or are not comparable.
 */
function rankGapBetweenRuns(
  aMin: number,
  aMax: number,
  bMin: number,
  bMax: number,
): number | null {
  if (aMin > bMax) return aMin - bMax - 1
  if (bMin > aMax) return bMin - aMax - 1
  return null
}

/**
 * Hand cards that should stay unmelded because they form a same-suit block
 * sitting just across a small gap from an existing team sequence — waiting
 * for the bridge (natural or wild) is how you build a canasta/limpa.
 */
export function bridgeReservedCardIds(hand: CardModel[], existingMelds: Meld[]): Set<string> {
  const reserved = new Set<string>()
  const sequences = existingMelds.filter(
    (m) => m.type === 'sequence' && m.suit && !m.isCanasta,
  )
  if (sequences.length === 0) return reserved

  const suits = new Set(
    hand.filter((c) => c.rank !== 'JOKER' && c.suit).map((c) => c.suit as Suit),
  )

  for (const suit of suits) {
    const suited = sortByRank(hand.filter((c) => c.suit === suit && c.rank !== 'JOKER'))
    if (suited.length < 2) continue

    for (const meld of sequences) {
      if (meld.suit !== suit) continue
      const aceHigh = meldUsesAceHigh(meld)
      const meldOrders = meld.slots.map((s) => sequenceRankOrder(s.slotRank, aceHigh))
      const mMin = Math.min(...meldOrders)
      const mMax = Math.max(...meldOrders)

      // Contiguous hand blocks of length ≥2.
      for (let i = 0; i < suited.length; ) {
        let j = i
        while (
          j + 1 < suited.length &&
          sequenceRankOrder(suited[j + 1].rank, aceHigh) ===
            sequenceRankOrder(suited[j].rank, aceHigh) + 1
        ) {
          j += 1
        }
        const block = suited.slice(i, j + 1)
        if (block.length >= 2) {
          const gMin = sequenceRankOrder(block[0].rank, aceHigh)
          const gMax = sequenceRankOrder(block[block.length - 1].rank, aceHigh)
          const gap = rankGapBetweenRuns(mMin, mMax, gMin, gMax)
          if (gap !== null && gap >= 1 && gap <= 2) {
            const mergedLen = meld.slots.length + block.length + gap
            const worthWaiting =
              (gap === 1 && meld.slots.length >= 3 && block.length >= 2) ||
              mergedLen >= 7 ||
              (gap <= 2 && meld.slots.length + block.length >= 6)
            if (worthWaiting) {
              for (const card of block) reserved.add(card.id)
            }
          }
        }
        i = j + 1
      }
    }
  }

  return reserved
}

/**
 * Optimistic max size of a NEW set of `rank` if we open with `handCount`
 * naturals now: hand + all unknown copies + at most one wild.
 * Enemy-melded copies are treated as gone forever.
 */
export function maxPossibleNewSetSize(
  rank: Rank,
  handCount: number,
  ctx: AiPlayContext,
): number {
  if (rank === 'JOKER') return handCount
  const boardAndDiscard = countVisibleRank(rank, ctx.ownMelds, ctx.opponentMelds, ctx.discardPile)
  // countVisibleRank does not include private hand — handCount is separate.
  const unknown = Math.max(0, COPIES_PER_RANK - boardAndDiscard - handCount)
  const maxNaturals = handCount + unknown
  const alreadyHasWildOnOwnSet = ctx.ownMelds.some(
    (m) => m.type === 'set' && m.rank === rank && m.wildCount >= 1,
  )
  const wildSlot = alreadyHasWildOnOwnSet ? 0 : 1
  return maxNaturals + wildSlot
}

/** True when opening a set of this rank cannot reach canasta (≥7) from public counts. */
export function isHopelessNewSetRank(
  rank: Rank,
  handCount: number,
  ctx: AiPlayContext,
): boolean {
  if (handCount >= 7) return false
  return maxPossibleNewSetSize(rank, handCount, ctx) < 7
}

function ranksWithExistingSet(melds: Meld[]): Set<Rank> {
  const ranks = new Set<Rank>()
  for (const meld of melds) {
    if (meld.type === 'set' && meld.rank) ranks.add(meld.rank)
  }
  return ranks
}

function countShortInProgress(melds: Meld[]): number {
  return melds.filter((m) => m.slots.length < 5).length
}

function isConnectorSequenceSeed(cards: CardModel[], kind: 'set' | 'sequence'): boolean {
  if (kind !== 'sequence') return false
  const naturals = cards.filter((c) => !isWild(c))
  return naturals.length >= 2 && naturals.every((c) => isConnectorRank(c.rank))
}

function shouldSkipShortOpener(
  cards: CardModel[],
  kind: 'set' | 'sequence',
  ctx: AiPlayContext,
): boolean {
  if (ctx.mayEmptyForShow) return false
  if (cards.length !== 3) return false
  if (isConnectorSequenceSeed(cards, kind)) return false
  return countShortInProgress(ctx.ownMelds) >= 2
}

/** Cards that already form a legal 3+ same-suit sequence in `hand`. */
function sequenceCommittedCardIds(hand: CardModel[], teamId: TeamId): Set<string> {
  const committed = new Set<string>()
  const suits = new Set(
    hand.filter((c) => c.rank !== 'JOKER' && c.suit).map((c) => c.suit as Suit),
  )
  for (const suit of suits) {
    const suited = sortByRank(hand.filter((c) => c.suit === suit && c.rank !== 'JOKER'))
    for (let i = 0; i < suited.length; i += 1) {
      for (let j = i + 2; j < suited.length; j += 1) {
        const group = suited.slice(i, j + 1)
        if (!buildSequence(group, teamId).ok) continue
        for (const card of group) committed.add(card.id)
      }
    }
  }
  return committed
}

function isConnectorRankSet(cards: CardModel[]): boolean {
  const naturals = cards.filter((c) => !isWild(c))
  if (naturals.length === 0) return false
  const rank = naturals[0].rank
  return isConnectorRank(rank) && naturals.every((c) => c.rank === rank)
}

function allowConnectorSetUnlock(
  meldCards: CardModel[],
  vital: VitalRemainderScore,
  ctx?: AiPlayContext,
): boolean {
  const naturals = meldCards.filter((c) => !isWild(c))
  if (mayOpenConnectorSet(naturals.length, ctx ?? defaultAiContext('team-a'))) return true
  return vital.maxTier === 'important' || vital.maxTier === 'critical'
}

function findBestNewMeld(
  hand: CardModel[],
  teamId: TeamId,
  blockedSetRanks: Set<Rank> = new Set(),
  ctx: AiPlayContext = defaultAiContext(teamId),
): { plan: AiMeldPlan; score: number } | null {
  let best: { plan: AiMeldPlan; score: number } | null = null

  const consider = (group: CardModel[], kind: 'set' | 'sequence') => {
    const attempt = kind === 'set' ? buildSet(group, teamId) : buildSequence(group, teamId)
    if (!attempt.ok) return
    if (kind === 'set') {
      const natural = group.find((c) => !isWild(c))
      if (natural && isHopelessNewSetRank(natural.rank, group.filter((c) => !isWild(c)).length, ctx)) {
        return
      }
      if (
        natural &&
        isConnectorRank(natural.rank) &&
        !mayOpenConnectorSet(group.filter((c) => !isWild(c)).length, ctx)
      ) {
        return
      }
    }
    if (shouldSkipShortOpener(group, kind, ctx)) return
    const score = scoreNewMeld(group, { kind, ctx })
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
    // Off-suit 2s + Jokers only — same-suit 2s try as naturals first via engine.
    const wildPool = hand.filter(
      (c) => c.rank === 'JOKER' || (c.rank === '2' && c.suit !== suit),
    )

    for (let i = 0; i < suited.length; i += 1) {
      for (let j = i + 2; j < suited.length; j += 1) {
        consider(suited.slice(i, j + 1), 'sequence')
      }
      // Wilds only when naturals alone are illegal (gap / need a 3rd card).
      for (let j = i + 1; j < suited.length; j += 1) {
        const naturals = suited.slice(i, j + 1)
        if (naturals.length < 2) continue
        if (buildSequence(naturals, teamId).ok) continue // no need to burn a wild
        const wild =
          wildPool.find((c) => c.rank === 'JOKER') ??
          wildPool.find((c) => c.rank === '2' && c.suit !== suit)
        if (!wild) continue
        const withWild = [...naturals, wild]
        if (!buildSequence(withWild, teamId).ok) continue
        consider(withWild, 'sequence')
      }
    }
  }

  // Sets — only when a rank isn't already on the table (append instead).
  // Exclude cards already committed to a legal same-suit 3+ run in hand.
  const committed = sequenceCommittedCardIds(hand, teamId)
  const naturalRanks = new Set(hand.filter((c) => !isWild(c)).map((c) => c.rank))
  for (const rank of naturalRanks) {
    if (blockedSetRanks.has(rank)) continue
    const naturals = hand.filter((c) => c.rank === rank && !committed.has(c.id))
    const wilds = hand.filter(isWild)
    if (naturals.length >= 3) consider(naturals, 'set')
    // Wild only when exactly 2 naturals — essential to open the set.
    if (naturals.length === 2 && wilds.length >= 1) consider([...naturals, wilds[0]], 'set')
  }

  return best
}

/**
 * Append every card that legally fits, preferring higher plus-sum appends
 * first (canasta progress, points). Re-scans after each append.
 */
export function planAiAppends(
  hand: CardModel[],
  melds: Meld[],
  ctx: AiPlayContext = defaultAiContext('team-a', melds),
): { plans: AiAppendPlan[]; remainingHand: CardModel[] } {
  const plans: AiAppendPlan[] = []
  let remaining = [...hand]
  // Local copy of meld lengths so canasta-progress scoring stays accurate as we append.
  const meldState = melds.map((m) => ({ ...m, slots: [...m.slots] }))
  const floor = actionRetainFloor(ctx)

  let progressed = true
  while (progressed) {
    progressed = false
    let best: { plan: AiAppendPlan; score: number; meldIndex: number } | null = null

    for (let mi = 0; mi < meldState.length; mi += 1) {
      const meld = meldState[mi]
      for (const card of remaining) {
        const playCtx: AiPlayContext = {
          ...ctx,
          ownMelds: meldState,
          handSize: remaining.length,
        }
        const aCtx = appendCtxFromAi(playCtx, remaining.length)
        if (!canAppendToMeld(meld, card, aCtx)) continue
        if (isWild(card) && !isEssentialWildAppend(card, meld, playCtx)) continue
        if (remaining.length - 1 < floor) continue
        const score = scoreAppend(card, meld, playCtx)
        if (!Number.isFinite(score) || score <= 0) continue
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
    const applied = appendToMeld(
      meldState[best.meldIndex],
      card,
      'top',
      appendCtxFromAi({ ...ctx, ownMelds: meldState, handSize: remaining.length + 1 }, remaining.length + 1),
    )
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
 * True when a Top Touch plan includes the pile's top card in the unlocking
 * meld selection. Bots (and humans) may never scoop the pile without this.
 */
export function aiTopTouchPlaysTopCard(
  discardPile: CardModel[],
  selectedDiscardIds: string[],
): boolean {
  if (discardPile.length === 0 || selectedDiscardIds.length === 0) return false
  const top = discardPile[discardPile.length - 1]
  return selectedDiscardIds.includes(top.id)
}

/**
 * Draw vs Top Touch: Top Touch when the unlocking play (+ tiered vital
 * remainder) beats drawing from stock.
 *
 * Invariant: every Top Touch plan MUST include the current top discard card
 * in `selectedDiscardIds`. Deeper cards may join that meld or arrive as
 * remainder — but the top card is always played.
 *
 * Vitality (see {@link classifyRemainderVitality}): ordinary short-meld
 * connectors are cheap; canasta finishes / near-canasta Slides are critical
 * and may justify a redundant top or even burning a wild to unlock.
 */
export function planAiDraw(
  hand: CardModel[],
  melds: Meld[],
  discardPile: CardModel[],
  teamId: TeamId,
  ctx: AiPlayContext = defaultAiContext(teamId, melds),
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
  const top = discardPile[discardPile.length - 1]

  const consider = (plan: AiDrawPlan) => {
    if (plan.score <= 0) return
    // Hard gate: never consider a pile pickup that skips the top card.
    if (plan.source === 'top-touch' && !aiTopTouchPlaysTopCard(discardPile, plan.selectedDiscardIds)) {
      return
    }
    if (!bestRef.current || plan.score > bestRef.current.score) bestRef.current = plan
  }

  const tryPlan = (partial: {
    handCardIds: string[]
    selectedDiscardIds: string[]
    targetMeldId: string | null
    kind: 'set' | 'sequence' | 'append'
    meldCards: CardModel[]
    remainderPile: CardModel[]
    targetMeld?: Meld | null
  }) => {
    const burnPenalty = feedOpportunityPenalty(partial.meldCards, melds)
    const score = scoreTopTouchPlan({
      meldCards: partial.meldCards,
      remainderPile: partial.remainderPile,
      kind: partial.kind,
      melds,
      targetMeld: partial.targetMeld ?? null,
      burnPenalty,
      ctx,
    })
    if (score === null || score <= 0) return
    consider({
      source: 'top-touch',
      handCardIds: partial.handCardIds,
      selectedDiscardIds: partial.selectedDiscardIds,
      targetMeldId: partial.targetMeldId,
      kind: partial.kind,
      score,
    })
  }

  // --- Unlock with top alone (append / Slide onto an existing meld) ---
  {
    const remainderPile = discardPile.slice(0, -1)
    for (const meld of melds) {
      if (!canAppendToMeld(meld, top)) continue
      tryPlan({
        handCardIds: [],
        selectedDiscardIds: [top.id],
        targetMeldId: meld.id,
        kind: 'append',
        meldCards: [top],
        remainderPile,
        targetMeld: meld,
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

    // Both cards append to the same existing meld (including sequential
    // extensions that only become legal after the first card lands).
    for (const meld of melds) {
      if (!canAppendDiscardSelection(meld, melds, discardPile, selectedDiscardIds, ctx)) continue
      tryPlan({
        handCardIds: [],
        selectedDiscardIds,
        targetMeldId: meld.id,
        kind: 'append',
        meldCards: [top, deep],
        remainderPile,
        targetMeld: meld,
      })
    }

    const handCombos = enumerateHandCombos(hand, 3)
    for (const handCards of handCombos) {
      const group = [...selectedDiscard, ...handCards]
      if (group.length < 3) continue
      if (buildSet(group, teamId).ok) {
        tryPlan({
          handCardIds: handCards.map((c) => c.id),
          selectedDiscardIds,
          targetMeldId: null,
          kind: 'set',
          meldCards: group,
          remainderPile,
        })
      }
      if (buildSequence(group, teamId).ok) {
        tryPlan({
          handCardIds: handCards.map((c) => c.id),
          selectedDiscardIds,
          targetMeldId: null,
          kind: 'sequence',
          meldCards: group,
          remainderPile,
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

    for (const meld of melds) {
      if (!canAppendDiscardSelection(meld, melds, discardPile, selectedDiscardIds, ctx)) continue
      tryPlan({
        handCardIds: [],
        selectedDiscardIds,
        targetMeldId: meld.id,
        kind: 'append',
        meldCards: selectedDiscard,
        remainderPile,
        targetMeld: meld,
      })
    }

    const handCombos = enumerateHandCombos(hand, 4)
    for (const handCards of handCombos) {
      const group = [...selectedDiscard, ...handCards]
      if (group.length < 3) continue
      if (buildSet(group, teamId).ok) {
        tryPlan({
          handCardIds: handCards.map((c) => c.id),
          selectedDiscardIds,
          targetMeldId: null,
          kind: 'set',
          meldCards: group,
          remainderPile,
        })
      }
      if (buildSequence(group, teamId).ok) {
        tryPlan({
          handCardIds: handCards.map((c) => c.id),
          selectedDiscardIds,
          targetMeldId: null,
          kind: 'sequence',
          meldCards: group,
          remainderPile,
        })
      }
    }
  }

  // --- 3+ discard cards including top, not necessarily contiguous ---
  // Covers "all from the pile" sets (three 4s with junk in between) that the
  // pair loop (top + one deep) and contiguous-run loop would miss.
  for (const extras of enumerateDiscardExtras(discardPile.slice(0, -1), 2, 4)) {
    const selectedDiscard = [...extras, top]
    const selectedDiscardIds = selectedDiscard.map((c) => c.id)
    const used = new Set(selectedDiscardIds)
    const remainderPile = discardPile.filter((c) => !used.has(c.id))

    for (const meld of melds) {
      if (!canAppendDiscardSelection(meld, melds, discardPile, selectedDiscardIds, ctx)) continue
      tryPlan({
        handCardIds: [],
        selectedDiscardIds,
        targetMeldId: meld.id,
        kind: 'append',
        meldCards: selectedDiscard,
        remainderPile,
        targetMeld: meld,
      })
    }

    if (selectedDiscard.length < 3) continue
    if (buildSet(selectedDiscard, teamId).ok) {
      tryPlan({
        handCardIds: [],
        selectedDiscardIds,
        targetMeldId: null,
        kind: 'set',
        meldCards: selectedDiscard,
        remainderPile,
      })
    }
    if (buildSequence(selectedDiscard, teamId).ok) {
      tryPlan({
        handCardIds: [],
        selectedDiscardIds,
        targetMeldId: null,
        kind: 'sequence',
        meldCards: selectedDiscard,
        remainderPile,
      })
    }
  }

  const best = bestRef.current
  if (!best || best.score <= 0) return stockPlan
  if (best.source === 'top-touch' && !aiTopTouchPlaysTopCard(discardPile, best.selectedDiscardIds)) {
    return stockPlan
  }
  return best
}

/**
 * Subsets of buried discard cards (oldest-first input) of size minSize..maxSize.
 * Prefers cards nearest the top so a long pile does not explode combinatorially.
 */
function enumerateDiscardExtras(
  othersOldestFirst: CardModel[],
  minSize: number,
  maxSize: number,
  window = 8,
): CardModel[][] {
  const pool = othersOldestFirst.slice(Math.max(0, othersOldestFirst.length - window))
  const out: CardModel[][] = []
  const n = pool.length
  const limit = Math.min(maxSize, n)
  const rec = (start: number, acc: CardModel[]) => {
    if (acc.length >= minSize && acc.length <= limit) out.push([...acc])
    if (acc.length === limit) return
    for (let i = start; i < n; i += 1) {
      acc.push(pool[i])
      rec(i + 1, acc)
      acc.pop()
    }
  }
  rec(0, [])
  return out
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

/** True when `card` can legally append onto any meld in `melds`. */
export function cardFeedsAnyMeld(card: CardModel, melds: Meld[]): boolean {
  return melds.some((m) => canAppendToMeld(m, card))
}

/**
 * Near-future opponent need: same-suit rank sitting one step beyond a
 * sequence edge (would become playable after they extend), or matching a
 * set's rank. Uses public melds only.
 */
export function cardNearFutureFeeds(card: CardModel, melds: Meld[]): boolean {
  if (isWild(card) || !card.suit) return false
  for (const meld of melds) {
    if (meld.type === 'set' && meld.rank === card.rank) return true
    if (meld.type !== 'sequence' || meld.suit !== card.suit) continue
    const aceHigh = meldUsesAceHigh(meld)
    const orders = meld.slots.map((s) => sequenceRankOrder(s.slotRank, aceHigh))
    const min = Math.min(...orders)
    const max = Math.max(...orders)
    const order = sequenceRankOrder(card.rank, aceHigh)
    if (order === max + 2 || order === min - 2) return true
  }
  return false
}

/**
 * Discard the lowest-cost card under a weighted sum:
 * point value + near-meld breakage + feeding opponents (avoid) + feeding
 * own/teammate melds (avoid) + wild premium.
 *
 * Never peeks private hands — opponent/teammate needs come from public melds.
 */
/**
 * How harshly to penalize discarding `card` when it feeds public opponent
 * melds. Softens when the rank is hopeless for us, we retain 2+ copies, and
 * their set is still ≤4 (not near canasta).
 */
export function opponentFeedDiscardPenalty(
  card: CardModel,
  hand: CardModel[],
  ctx: AiPlayContext,
): number {
  if (!cardFeedsAnyMeld(card, ctx.opponentMelds)) {
    return cardNearFutureFeeds(card, ctx.opponentMelds) ? AI_WEIGHTS.feedOpponentNear : 0
  }
  const handCopies = hand.filter((c) => c.rank === card.rank && !isWild(c)).length
  const hopeless = isHopelessNewSetRank(card.rank, handCopies, ctx)
  if (hopeless && handCopies >= 2) return AI_WEIGHTS.feedOpponentSoft
  return AI_WEIGHTS.feedOpponent
}

export function pickAiDiscard(
  hand: CardModel[],
  ctx: AiPlayContext = defaultAiContext('team-a'),
): CardModel | null {
  if (hand.length === 0) return null

  const nearMeldIds = new Set(cardsInNearMelds(hand))
  const bridgeIds = bridgeReservedCardIds(hand, ctx.ownMelds)
  const nonWild = hand.filter((c) => !isWild(c))
  const pool = nonWild.length > 0 ? nonWild : hand

  let best: CardModel | null = null
  let bestCost = Infinity
  for (const card of pool) {
    const handCopies = hand.filter((c) => c.rank === card.rank && !isWild(c)).length
    const hopeless =
      !isWild(card) && isHopelessNewSetRank(card.rank, handCopies, ctx)

    let cost = cardPointValue(card)
    // Preserve real near-melds, but not clusters of a hopeless rank (those are
    // discard fodder, not a future canasta).
    if (nearMeldIds.has(card.id) && !hopeless) cost += AI_WEIGHTS.breakNearMeld
    if (bridgeIds.has(card.id)) cost += AI_WEIGHTS.breakNearMeld
    if (isWild(card)) cost += AI_WEIGHTS.discardWild
    cost += opponentFeedDiscardPenalty(card, hand, ctx)
    if (cardFeedsAnyMeld(card, ctx.ownMelds)) cost += AI_WEIGHTS.feedTeammate

    if (!isWild(card) && isConnectorRank(card.rank)) {
      cost += AI_WEIGHTS.connectorDiscard
      const hasNeighbor = hand.some(
        (h) =>
          h.id !== card.id &&
          h.suit === card.suit &&
          h.rank !== 'JOKER' &&
          Math.abs(rankOrder(h.rank) - rankOrder(card.rank)) === 1,
      )
      if (hasNeighbor) cost += AI_WEIGHTS.connectorNeighborDiscard
    }

    if (hopeless) {
      cost -= AI_WEIGHTS.hopelessRankDiscardRelief
    }

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
  ctx: AiPlayContext = defaultAiContext(teamId, melds),
): AiTurnPlan {
  const draw = planAiDraw(hand, melds, discardPile, teamId, ctx)

  let workingHand = [...hand]
  let workingMelds = [...melds]
  const playCtx: AiPlayContext = { ...ctx, teamId, ownMelds: workingMelds }

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
  const firstAppends = planAiAppends(workingHand, workingMelds, { ...playCtx, ownMelds: workingMelds })
  workingHand = firstAppends.remainingHand
  const meldPlans = planAiMelds(workingHand, teamId, workingMelds, { ...playCtx, ownMelds: workingMelds })
  workingHand = meldPlans.remainingHand
  const secondAppends = planAiAppends(workingHand, workingMelds, { ...playCtx, ownMelds: workingMelds })
  workingHand = secondAppends.remainingHand
  const discard = pickAiDiscard(workingHand, { ...playCtx, ownMelds: workingMelds })

  return {
    draw,
    newMelds: meldPlans.plans,
    appends: [...firstAppends.plans, ...secondAppends.plans],
    discardCardId: discard?.id ?? null,
  }
}

