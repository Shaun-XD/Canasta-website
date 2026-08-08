/**
 * Core Canasta data model.
 *
 * IMPORTANT: The exact Canasta ruleset (deck composition beyond the basic
 * 52 + jokers, meld/canasta requirements, going-out conditions, wild card
 * handling, and scoring tables) has NOT been finalized by the product owner
 * yet. Everywhere the real rules matter, this file (and the mock store that
 * consumes it) leaves a `TODO(rules)` comment. Do not treat any validation
 * or scoring logic built on top of these types as final - it is placeholder
 * behavior only, meant to make the UI interactive/demoable.
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
 *
 * TODO(rules): confirm whether this project uses 1 or 2 standard decks
 * (traditional Canasta uses 2 decks + 4 jokers = 108 cards). The mock deck
 * builder in `src/lib/deck.ts` currently assumes 2 decks + 4 jokers as a
 * reasonable placeholder.
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

export interface Team {
  id: TeamId
  name: string
  playerIds: PlayerId[]
  /**
   * Melds this team has laid down on the table, keyed by rank.
   * TODO(rules): a real engine will also need per-meld metadata such as
   * "is this a natural/mixed canasta", wild-card counts, and whether it is
   * closed/frozen etc. For now a meld is just "a pile of cards of one rank".
   */
  melds: Record<string, Meld>
  /**
   * TODO(rules): red-three bonus/penalty cards, once finalized.
   */
  redThrees: CardModel[]
  score: number
  hasGoneOut: boolean
}

export interface Meld {
  rank: Rank
  cards: CardModel[]
  /**
   * TODO(rules): a real engine determines canasta status (7+ cards, natural
   * vs mixed, closed vs open) from finalized rules. The mock store just
   * flags `isCanasta` once a meld reaches 7 cards as a placeholder visual cue.
   */
  isCanasta: boolean
}

/** A player's hand of cards currently held (not yet melded or discarded). */
export type Hand = CardModel[]

/**
 * The "foot" is the second stack of cards dealt to each player in Canasta,
 * picked up only after the first hand (the "head") is fully melded/emptied.
 * TODO(rules): exact foot size and pick-up trigger conditions pending.
 */
export type Foot = CardModel[]

export interface DiscardPile {
  cards: CardModel[]
  /**
   * TODO(rules): "frozen" discard piles (e.g. after a wild card is
   * discarded) affect who may pick up the pile. Not implemented yet.
   */
  isFrozen: boolean
}

export type TurnPhase = 'draw' | 'meld' | 'discard'

export interface TurnState {
  activePlayerId: PlayerId
  phase: TurnPhase
  turnNumber: number
}

export type RoomStatus = 'lobby' | 'in-progress' | 'round-end' | 'game-end'

/** Lobby-level state: who has joined, teams, readiness, room lifecycle. */
export interface RoomState {
  roomId: string
  status: RoomStatus
  players: Player[]
  teams: Team[]
  hostPlayerId: PlayerId | null
}

/** Full game-table state once a round is underway. */
export interface GameState {
  roomId: string
  stock: CardModel[]
  discardPile: DiscardPile
  hands: Record<PlayerId, Hand>
  feet: Record<PlayerId, Foot>
  hasPickedUpFoot: Record<PlayerId, boolean>
  turn: TurnState
  round: number
  /**
   * TODO(rules): score breakdown per team is a placeholder shape until the
   * real scoring formula (melded card points, canasta bonuses, going-out
   * bonus, red three bonus/penalty, cards left in hand penalty) is defined.
   */
  lastRoundScores: Record<TeamId, number> | null
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
