/**
 * Core Canasta ("Rajasthani Canasta") data model.
 *
 * This models the full authoritative ruleset: 108-card deck (2 decks + 4
 * jokers), 4 players in 2 fixed partnerships, 13-card hands, an 11-card
 * "Pozzetto" reserve stack per team, Set/Sequence melds with wild-card
 * limits, Canasta/Limpa classification & bonuses, the Slide mechanic, the
 * 3-phase turn state machine, Top Touch pickup validation, Show/Open Show
 * going-out conditions, sudden-death stock depletion, and round scoring.
 *
 * The rules engine that operates on these types lives in `src/engine/` and
 * is intentionally decoupled from Zustand/React so it can be unit tested in
 * isolation (see `src/engine/*.test.ts`).
 *
 * Two open questions remain unresolved by the source ruleset and are marked
 * with `TODO(rules)` at their point of use:
 *   1. The default match target score (implemented as 2100, configurable).
 *   2. Whether the -500/-100 tournament-style penalties (wrong meld
 *      detection, unclaimed Pozzetto, etc.) apply as specified, since they
 *      are noted as carried over from an earlier tournament ruleset.
 */

export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades'

export type Rank =
  | 'A'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | '10'
  | 'J'
  | 'Q'
  | 'K'
  | 'JOKER'

/**
 * A single physical card. `id` is a stable unique identifier used for React
 * keys, drag/drop, and selection tracking - it is NOT game state.
 */
export interface CardModel {
  id: string
  suit: Suit | null // null for jokers, which have no suit
  rank: Rank
}

export type PlayerId = string
export type TeamId = 'team-a' | 'team-b'

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected'

export interface Player {
  id: PlayerId
  name: string
  teamId: TeamId | null
  seat: number // 0-3, clockwise seating position
  isReady: boolean
  isLocal: boolean
  isMock: boolean // true for placeholder/AI-ish players used to demo the UI solo
  connectionStatus: ConnectionStatus
  avatarColor: string
}

// ---------------------------------------------------------------------------
// Melds
// ---------------------------------------------------------------------------

export type MeldType = 'set' | 'sequence'

/**
 * Classification of a completed (7+ card) meld. Melds below 7 cards are
 * always `'in-progress'` - they contribute only their raw card point total
 * to the team's score, no bonus.
 */
export type MeldClassification =
  | 'in-progress'
  | 'mixed-canasta'
  | 'limpa'
  | 'mixed-canasta-2s'
  | 'limpa-2s'

/**
 * One physical position within a meld. For a Set, `slotRank` always equals
 * the meld's rank. For a Sequence, slots are ordered low-to-high and
 * `slotRank` is the rank that position represents in the run (which may
 * differ from `card.rank` when a wild card is filling that slot).
 */
export interface MeldSlot {
  card: CardModel
  slotRank: Rank
  /**
   * True if `card` is acting as a wild substitute for `slotRank` rather than
   * as its own natural rank+suit. A 2 placed in its own matching-suit '2'
   * slot of a Sequence, or a 2 that is one of the natural members of a
   * rank-2 Set/"2s meld", is NOT a wild fill.
   */
  isWildFill: boolean
}

export interface Meld {
  id: string
  type: MeldType
  ownerTeamId: TeamId
  /** Set rank (including '2' for a "2s meld"); null for sequences. */
  rank: Rank | null
  /** Sequence suit; null for sets. */
  suit: Suit | null
  /** Ordered slots; low-to-high rank order for sequences. */
  slots: MeldSlot[]
  /** Count of cards currently acting as wild substitutes (max 1, enforced). */
  wildCount: number
  /**
   * Permanently flips false (never true again) once any Limpa-disqualifying
   * event occurs (see engine/meldValidation.ts). Gates whether a meld with
   * zero current wild cards may be classified as a Limpa once it reaches 7
   * cards.
   */
  canBecomeLimpa: boolean
  classification: MeldClassification
  isCanasta: boolean // slots.length >= 7
}

export function meldCardCount(meld: Meld): number {
  return meld.slots.length
}

export function meldCards(meld: Meld): CardModel[] {
  return meld.slots.map((s) => s.card)
}

// ---------------------------------------------------------------------------
// Pozzetto (reserve stack)
// ---------------------------------------------------------------------------

export interface PozzettoState {
  /** True once the 11-card stack has been moved into a player's hand. */
  claimed: boolean
  claimedByPlayerId: PlayerId | null
  /**
   * True once the team has discarded at least 1 card from the
   * reserve-augmented hand. Together with `claimed`, this means the
   * Pozzetto is "finished"/activated for Show eligibility; the declaring
   * player must still empty their hand to complete Show.
   */
  activated: boolean
}

export interface Team {
  id: TeamId
  name: string
  playerIds: PlayerId[]
  melds: Meld[]
  score: number
  hasGoneOut: boolean
  pozzetto: PozzettoState
}

/** A player's hand of cards currently held (not yet melded or discarded). */
export type Hand = CardModel[]

export interface DiscardPile {
  cards: CardModel[]
}

export type TurnPhase = 'draw' | 'action' | 'discard'

export interface TurnState {
  activePlayerId: PlayerId
  phase: TurnPhase
  turnNumber: number
  /** True once the player has drawn from stock or taken the discard pile this turn. */
  hasDrawnThisTurn: boolean
  /** Epoch ms timestamp of when this turn started, used to drive the per-player turn timer countdown. */
  startedAt: number
  /** True while the turn timer is paused for everyone at the table (item: pause button). */
  isPaused: boolean
  /** Epoch ms timestamp of when the timer was paused; null while not paused. */
  pausedAt: number | null
}

export type RoomStatus = 'lobby' | 'in-progress' | 'round-end' | 'game-end'

/** Lobby-level state: who has joined, teams, readiness, room lifecycle. */
export interface RoomState {
  roomId: string
  status: RoomStatus
  players: Player[]
  teams: Team[]
  hostPlayerId: PlayerId | null
  /**
   * Configurable match target score, set by the host at room-creation time.
   * TODO(rules): 2100 is used as the default. The source ruleset does not
   * specify a final target score - confirm this default with the product
   * owner and adjust if needed.
   */
  matchTargetScore: number
  /**
   * Lobby capacity: 2 (1v1) or 4 (2v2). Set at create / by host in lobby.
   * Join rejects when the lobby is already at this size.
   */
  maxPlayers: 2 | 4
  /**
   * Per-player turn timer, in seconds, configured by the host at
   * room-creation time (or adjusted in the lobby before the game starts).
   * Applies uniformly to every player's turn for the session.
   * `0` means no timer (no countdown, no auto skip-turn).
   */
  turnTimerSeconds: number
}

export type MaxPlayers = 2 | 4

export function normalizeMaxPlayers(value: number | undefined | null): MaxPlayers {
  return value === 2 ? 2 : 4
}

/** Players per team for the given lobby size (1 for 1v1, 2 for 2v2). */
export function seatsPerTeam(maxPlayers: MaxPlayers): number {
  return maxPlayers === 2 ? 1 : 2
}

/** A pending "choose which edge the displaced wild slides to" UI prompt. */
export interface PendingSlide {
  teamId: TeamId
  meldId: string
  displacedWildCardId: string
}

/** Outcome of a failed Top Touch attempt, surfaced to the UI briefly. */
export interface TopTouchFailure {
  playerId: PlayerId
  teamId: TeamId
  penaltyPoints: number
}

export type RoundEndingType = 'show' | 'sudden-death'

export interface TeamRoundScore {
  teamId: TeamId
  meldPoints: number
  canastaBonuses: number
  opponentHandPenalty: number
  showBonus: number
  zeroCanastaPenalty: number
  unclaimedPozzettoPenalty: number
  wrongMeldPenalty: number
  /** Illegal empty-hand after Pozzetto (not Show): typically -150 per foul. */
  emptyHandFoulPenalty: number
  total: number
}

export interface RoundScoreResult {
  round: number
  endingType: RoundEndingType
  showingTeamId: TeamId | null
  teams: Record<TeamId, TeamRoundScore>
}

/**
 * Records the most recent batch of cards a player acquired into their hand
 * (drawn from stock, or picked up via a successful Top Touch / Pozzetto
 * claim), so the UI can show a temporary "new card" glow highlight (see
 * `AnimatedCard`). `at` is an epoch-ms timestamp; consumers should treat the
 * highlight as expired after ~2s.
 */
export interface AcquiredCardsEvent {
  playerId: PlayerId
  cardIds: string[]
  at: number
}

/** Full game-table state once a round is underway. */
export interface GameState {
  roomId: string
  stock: CardModel[]
  discardPile: DiscardPile
  hands: Record<PlayerId, Hand>
  /** The 11-card reserve per team, present until claimed (see PozzettoState.claimed). */
  pozzettoStacks: Record<TeamId, CardModel[]>
  turn: TurnState
  round: number
  roundScoresHistory: RoundScoreResult[]
  lastRoundScores: RoundScoreResult | null
  pendingSlide: PendingSlide | null
  lastTopTouchFailure: TopTouchFailure | null
  gameOverTeamId: TeamId | null
  /** Most recent card(s) added to a player's hand; drives the "new card" glow highlight. */
  lastAcquired: AcquiredCardsEvent | null
  /**
   * Accumulated empty-hand foul penalties this round (negative), applied at
   * round end. Illegal empty after Pozzetto without Show eligibility.
   */
  emptyHandFoulByTeam: Record<TeamId, number>
}

export const SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades']

export const RANKS: Rank[] = [
  'A',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K',
]

export const SUIT_SYMBOLS: Record<Suit, string> = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
}

export const RED_SUITS: Suit[] = ['hearts', 'diamonds']

export const DEFAULT_TARGET_SCORE = 2100
export const DEFAULT_TURN_TIMER_SECONDS = 60

/** `0` = no timer; otherwise clamp to ≥10 seconds. */
export function normalizeTurnTimerSeconds(seconds: number | undefined | null): number {
  if (seconds === 0) return 0
  if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 10) {
    return Math.round(seconds)
  }
  return DEFAULT_TURN_TIMER_SECONDS
}
