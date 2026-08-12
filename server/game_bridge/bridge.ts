/**
 * JSON-RPC game bridge over stdin/stdout.
 * FastAPI talks to this process; we reuse the real TypeScript rules engine.
 *
 * Protocol: one JSON request per line → one JSON response per line.
 * Request:  { "id": 1, "method": "create_room", "params": { ... } }
 * Response: { "id": 1, "ok": true, "result": { ... } } | { "id": 1, "ok": false, "error": "..." }
 */

import * as readline from 'node:readline'
import { buildShuffledDeck, dealHands, sortHand } from '../../src/lib/deck.ts'
import { initialPozzettoState, shouldClaimPozzettoOnDiscard, shouldClaimPozzettoOnMeldEmpty } from '../../src/engine/pozzetto.ts'
import { performDrawFromStock, performDiscard, attemptMeldAction, getNextPlayerId } from '../../src/engine/turnEngine.ts'
import { moveWildInMeld } from '../../src/engine/meldValidation.ts'
import { evaluateShowEligibility } from '../../src/engine/showEligibility.ts'
import { EMPTY_HAND_FOUL_PENALTY, isIllegalEmptyHand } from '../../src/engine/emptyHandFoul.ts'
import { scoreRound } from '../../src/engine/scoring.ts'
import type {
  CardModel,
  GameState,
  Player,
  PlayerId,
  RoomState,
  Team,
  TeamId,
} from '../../src/types/game.ts'
import { DEFAULT_TARGET_SCORE, normalizeTurnTimerSeconds, normalizeMaxPlayers, seatsPerTeam } from '../../src/types/game.ts'

const HAND_SIZE = 13
const POZZETTO_SIZE = 11
const AVATAR_COLORS = ['#ef4444', '#3b82f6', '#eab308', '#22c55e', '#a855f7', '#ec4899']

interface Session {
  room: RoomState
  game: GameState | null
}

const sessions = new Map<string, Session>()

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

function makeRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 5; i += 1) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

function makeTeams(players: Player[]): Team[] {
  const teamIds: TeamId[] = ['team-a', 'team-b']
  return teamIds.map((id) => ({
    id,
    name: id === 'team-a' ? 'Team Red' : 'Team Blue',
    playerIds: players.filter((p) => p.teamId === id).map((p) => p.id),
    melds: [],
    score: 0,
    hasGoneOut: false,
    pozzetto: initialPozzettoState(),
  }))
}

function rebuildTeamPlayerIds(room: RoomState): RoomState {
  const teams = room.teams.map((t) => ({
    ...t,
    playerIds: room.players.filter((p) => p.teamId === t.id).map((p) => p.id),
  }))
  return { ...room, teams }
}

function withTeam(room: RoomState, teamId: TeamId, updater: (team: Team) => Team): RoomState {
  return { ...room, teams: room.teams.map((t) => (t.id === teamId ? updater(t) : t)) }
}

function findTeamForPlayer(room: RoomState, playerId: PlayerId): Team | undefined {
  return room.teams.find((t) => t.playerIds.includes(playerId))
}

function dealNewRound(room: RoomState, round = 1): GameState {
  const playerIds = room.players
    .slice()
    .sort((a, b) => a.seat - b.seat)
    .map((p) => p.id)
  const deck = buildShuffledDeck()
  const { hands, remaining } = dealHands(deck, playerIds, HAND_SIZE)
  const { hands: pozzettoByTeamRaw, remaining: stockAfterPozzetto } = dealHands(
    remaining,
    ['team-a', 'team-b'],
    POZZETTO_SIZE,
  )
  const sortedHands: Record<string, CardModel[]> = {}
  for (const id of playerIds) sortedHands[id] = sortHand(hands[id])
  const stock = [...stockAfterPozzetto]
  const firstDiscard = stock.shift()
  return {
    roomId: room.roomId,
    stock,
    discardPile: { cards: firstDiscard ? [firstDiscard] : [] },
    hands: sortedHands,
    pozzettoStacks: {
      'team-a': pozzettoByTeamRaw['team-a'],
      'team-b': pozzettoByTeamRaw['team-b'],
    },
    turn: {
      activePlayerId: playerIds[0],
      phase: 'draw',
      turnNumber: 1,
      hasDrawnThisTurn: false,
      startedAt: Date.now(),
      isPaused: false,
      pausedAt: null,
    },
    round,
    roundScoresHistory: [],
    lastRoundScores: null,
    pendingSlide: null,
    lastTopTouchFailure: null,
    gameOverTeamId: null,
    lastAcquired: null,
  }
}

function advanceTurn(game: GameState, room: RoomState, fromPlayerId: PlayerId): GameState['turn'] {
  const playerIds = room.players
    .slice()
    .sort((a, b) => a.seat - b.seat)
    .map((p) => p.id)
  const nextPlayerId = getNextPlayerId(playerIds, fromPlayerId)
  return {
    activePlayerId: nextPlayerId,
    phase: 'draw',
    turnNumber: game.turn.turnNumber + 1,
    hasDrawnThisTurn: false,
    startedAt: Date.now(),
    isPaused: false,
    pausedAt: null,
  }
}

function tryClaimPozzetto(
  game: GameState,
  team: Team,
  playerId: PlayerId,
  hand: CardModel[],
  trigger: 'discard' | 'meld-empty',
  handSizeBeforeAction: number,
): { hand: CardModel[]; pozzettoStacks: GameState['pozzettoStacks']; pozzetto: Team['pozzetto'] } {
  const shouldClaim =
    trigger === 'discard'
      ? shouldClaimPozzettoOnDiscard(handSizeBeforeAction, team.pozzetto.claimed)
      : shouldClaimPozzettoOnMeldEmpty(handSizeBeforeAction, team.pozzetto.claimed)
  if (!shouldClaim) {
    return { hand, pozzettoStacks: game.pozzettoStacks, pozzetto: team.pozzetto }
  }
  const reserve = game.pozzettoStacks[team.id] ?? []
  return {
    hand: sortHand([...hand, ...reserve]),
    pozzettoStacks: { ...game.pozzettoStacks, [team.id]: [] },
    pozzetto: { claimed: true, claimedByPlayerId: playerId, activated: team.pozzetto.activated },
  }
}

function pozzettoAfterDiscard(
  claimPozzetto: Team['pozzetto'],
  wasClaimedBeforeDiscard: boolean,
): Team['pozzetto'] {
  return {
    ...claimPozzetto,
    activated: wasClaimedBeforeDiscard ? true : claimPozzetto.activated,
  }
}

function endRoundWithScore(
  room: RoomState,
  game: GameState,
  endingType: 'show' | 'sudden-death',
  showingTeamId: TeamId | null,
): { room: RoomState; game: GameState } {
  const [teamA, teamB] = room.teams as [Team, Team]
  const handsByTeam: Record<TeamId, CardModel[]> = {
    'team-a': teamA.playerIds.flatMap((pid) => game.hands[pid] ?? []),
    'team-b': teamB.playerIds.flatMap((pid) => game.hands[pid] ?? []),
  }
  const result = scoreRound(game.round, endingType, [teamA, teamB], handsByTeam, showingTeamId)
  const teams = room.teams.map((t) => ({
    ...t,
    score: t.score + result.teams[t.id].total,
    hasGoneOut: endingType === 'show' && t.id === showingTeamId,
  }))
  const gameOverTeamId = teams.find((t) => t.score >= room.matchTargetScore)?.id ?? null
  return {
    room: { ...room, teams, status: gameOverTeamId ? 'game-end' : 'round-end' },
    game: {
      ...game,
      lastRoundScores: result,
      roundScoresHistory: [...game.roundScoresHistory, result],
      gameOverTeamId,
    },
  }
}

function tryAutoShowEnd(
  room: RoomState,
  game: GameState,
  team: Team,
  playerId: PlayerId,
): { ended: true; room: RoomState; game: GameState } | { ended: false } {
  const handSize = game.hands[playerId]?.length ?? 0
  const elig = evaluateShowEligibility(team, handSize)
  if (!elig.eligible) return { ended: false }
  const nextRoom = withTeam(room, team.id, (t) => ({
    ...t,
    pozzetto: { ...t.pozzetto, activated: true },
  }))
  return { ended: true, ...endRoundWithScore(nextRoom, game, 'show', team.id) }
}

function requireSession(roomId: string): Session {
  const session = sessions.get(roomId.toUpperCase())
  if (!session) throw new Error('Room not found.')
  return session
}

function requirePlayer(session: Session, playerId: string): Player {
  const player = session.room.players.find((p) => p.id === playerId)
  if (!player) throw new Error('Player not in room.')
  return player
}

// ===== RPC methods =====

function create_room(params: {
  playerName: string
  targetScore?: number
  turnTimerSeconds?: number
  maxPlayers?: number
}): { roomId: string; playerId: string; room: RoomState; game: null } {
  let roomId = makeRoomCode()
  while (sessions.has(roomId)) roomId = makeRoomCode()

  const playerId = randomId('p')
  const player: Player = {
    id: playerId,
    name: (params.playerName || 'Player').slice(0, 24),
    teamId: 'team-a',
    seat: 0,
    isReady: false,
    isLocal: false,
    isMock: false,
    connectionStatus: 'connected',
    avatarColor: AVATAR_COLORS[0],
  }
  const room: RoomState = {
    roomId,
    status: 'lobby',
    players: [player],
    teams: makeTeams([player]),
    hostPlayerId: playerId,
    matchTargetScore:
      params.targetScore && params.targetScore > 0 ? Math.round(params.targetScore) : DEFAULT_TARGET_SCORE,
    turnTimerSeconds: normalizeTurnTimerSeconds(params.turnTimerSeconds),
    maxPlayers: normalizeMaxPlayers(params.maxPlayers),
  }
  sessions.set(roomId, { room, game: null })
  return { roomId, playerId, room, game: null }
}

function join_room(params: { roomId: string; playerName: string }): {
  roomId: string
  playerId: string
  room: RoomState
  game: GameState | null
} {
  const session = requireSession(params.roomId)
  if (session.room.status !== 'lobby') throw new Error('Game already started.')
  const maxPlayers = normalizeMaxPlayers(session.room.maxPlayers)
  if (session.room.players.length >= maxPlayers) {
    throw new Error(
      `This lobby is set to ${maxPlayers} players and is full.`,
    )
  }

  const playerId = randomId('p')
  const usedSeats = new Set(session.room.players.map((p) => p.seat))
  let seat = 0
  while (usedSeats.has(seat) && seat < maxPlayers) seat += 1

  const perTeam = seatsPerTeam(maxPlayers)
  const teamACount = session.room.players.filter((p) => p.teamId === 'team-a').length
  const teamId: TeamId = teamACount < perTeam ? 'team-a' : 'team-b'

  const player: Player = {
    id: playerId,
    name: (params.playerName || 'Player').slice(0, 24),
    teamId,
    seat,
    isReady: false,
    isLocal: false,
    isMock: false,
    connectionStatus: 'connected',
    avatarColor: AVATAR_COLORS[session.room.players.length % AVATAR_COLORS.length],
  }
  session.room = rebuildTeamPlayerIds({
    ...session.room,
    players: [...session.room.players, player],
  })
  return { roomId: session.room.roomId, playerId, room: session.room, game: session.game }
}

function rejoin_room(params: { roomId: string; playerId: string }): {
  roomId: string
  playerId: string
  room: RoomState
  game: GameState | null
} {
  const session = requireSession(params.roomId)
  const player = requirePlayer(session, params.playerId)
  session.room = {
    ...session.room,
    players: session.room.players.map((p) =>
      p.id === player.id ? { ...p, connectionStatus: 'connected' } : p,
    ),
  }
  return { roomId: session.room.roomId, playerId: player.id, room: session.room, game: session.game }
}

function set_connection(params: {
  roomId: string
  playerId: string
  status: 'connected' | 'disconnected'
}): { room: RoomState; game: GameState | null } {
  const session = requireSession(params.roomId)
  requirePlayer(session, params.playerId)
  session.room = {
    ...session.room,
    players: session.room.players.map((p) =>
      p.id === params.playerId ? { ...p, connectionStatus: params.status } : p,
    ),
  }
  return { room: session.room, game: session.game }
}

function set_team(params: { roomId: string; playerId: string; teamId: TeamId }): {
  room: RoomState
  game: GameState | null
} {
  const session = requireSession(params.roomId)
  if (session.room.status !== 'lobby') throw new Error('Cannot change team after start.')
  requirePlayer(session, params.playerId)
  const perTeam = seatsPerTeam(normalizeMaxPlayers(session.room.maxPlayers))
  const count = session.room.players.filter(
    (p) => p.teamId === params.teamId && p.id !== params.playerId,
  ).length
  if (count >= perTeam) throw new Error('That team is full.')
  session.room = rebuildTeamPlayerIds({
    ...session.room,
    players: session.room.players.map((p) =>
      p.id === params.playerId ? { ...p, teamId: params.teamId } : p,
    ),
  })
  return { room: session.room, game: session.game }
}

function set_seat(params: { roomId: string; playerId: string; seat: number }): {
  room: RoomState
  game: GameState | null
} {
  const session = requireSession(params.roomId)
  if (session.room.status !== 'lobby') throw new Error('Cannot change seat after start.')
  requirePlayer(session, params.playerId)
  const maxSeat = normalizeMaxPlayers(session.room.maxPlayers) - 1
  const seat = Math.max(0, Math.min(maxSeat, Math.round(params.seat)))
  const occupied = session.room.players.find((p) => p.seat === seat)
  const prevSeat = session.room.players.find((p) => p.id === params.playerId)?.seat ?? 0
  session.room = {
    ...session.room,
    players: session.room.players.map((p) => {
      if (p.id === params.playerId) return { ...p, seat }
      if (occupied && p.id === occupied.id) return { ...p, seat: prevSeat }
      return p
    }),
  }
  return { room: session.room, game: session.game }
}

function set_ready(params: { roomId: string; playerId: string; ready?: boolean }): {
  room: RoomState
  game: GameState | null
} {
  const session = requireSession(params.roomId)
  const player = requirePlayer(session, params.playerId)
  const ready = typeof params.ready === 'boolean' ? params.ready : !player.isReady
  session.room = {
    ...session.room,
    players: session.room.players.map((p) => (p.id === params.playerId ? { ...p, isReady: ready } : p)),
  }
  return { room: session.room, game: session.game }
}

function set_timer(params: { roomId: string; playerId: string; seconds: number }): {
  room: RoomState
  game: GameState | null
} {
  const session = requireSession(params.roomId)
  if (session.room.hostPlayerId !== params.playerId) throw new Error('Only the host can change the timer.')
  session.room = {
    ...session.room,
    turnTimerSeconds: normalizeTurnTimerSeconds(params.seconds === 0 ? 0 : params.seconds),
  }
  return { room: session.room, game: session.game }
}

function set_target(params: { roomId: string; playerId: string; score: number }): {
  room: RoomState
  game: GameState | null
} {
  const session = requireSession(params.roomId)
  if (session.room.hostPlayerId !== params.playerId) throw new Error('Only the host can change the target.')
  session.room = {
    ...session.room,
    matchTargetScore: Math.max(500, Math.round(params.score)),
  }
  return { room: session.room, game: session.game }
}

function set_max_players(params: { roomId: string; playerId: string; maxPlayers: number }): {
  room: RoomState
  game: GameState | null
} {
  const session = requireSession(params.roomId)
  if (session.room.status !== 'lobby') throw new Error('Cannot change player count after the game starts.')
  if (session.room.hostPlayerId !== params.playerId) throw new Error('Only the host can change the player count.')
  const capacity = normalizeMaxPlayers(params.maxPlayers)
  if (session.room.players.length > capacity) {
    throw new Error(
      `Cannot set ${capacity}-player lobby — ${session.room.players.length} players already joined.`,
    )
  }
  session.room = { ...session.room, maxPlayers: capacity }
  return { room: session.room, game: session.game }
}

function start_game(params: { roomId: string; playerId: string }): {
  room: RoomState
  game: GameState
} {
  const session = requireSession(params.roomId)
  if (session.room.hostPlayerId !== params.playerId) throw new Error('Only the host can start.')
  const maxPlayers = normalizeMaxPlayers(session.room.maxPlayers)
  const perTeam = seatsPerTeam(maxPlayers)
  if (session.room.players.length < maxPlayers) {
    throw new Error(`Need ${maxPlayers} players to start.`)
  }
  if (!session.room.players.every((p) => p.isReady)) throw new Error('All players must be ready.')
  const teamA = session.room.players.filter((p) => p.teamId === 'team-a').length
  const teamB = session.room.players.filter((p) => p.teamId === 'team-b').length
  if (teamA !== perTeam || teamB !== perTeam) {
    throw new Error(
      maxPlayers === 2
        ? 'Need one player on each team (1v1).'
        : 'Each team needs exactly 2 players.',
    )
  }
  const room = rebuildTeamPlayerIds({
    ...session.room,
    status: 'in-progress',
    teams: session.room.teams.map((t) => ({
      ...t,
      melds: [],
      hasGoneOut: false,
      pozzetto: initialPozzettoState(),
    })),
  })
  const game = dealNewRound(room, 1)
  session.room = room
  session.game = game
  return { room, game }
}

function draw(params: { roomId: string; playerId: string }): { room: RoomState; game: GameState } {
  const session = requireSession(params.roomId)
  if (!session.game) throw new Error('Game not started.')
  const game = session.game
  if (game.turn.activePlayerId !== params.playerId) throw new Error('Not your turn.')
  if (game.turn.phase !== 'draw') throw new Error('Already drew this turn.')
  if (game.stock.length === 0) throw new Error('Stock is empty.')
  const result = performDrawFromStock(game.stock, game.hands[params.playerId] ?? [])
  session.game = {
    ...game,
    stock: result.stock,
    hands: { ...game.hands, [params.playerId]: sortHand(result.hand) },
    turn: { ...game.turn, phase: 'action', hasDrawnThisTurn: true },
    lastAcquired: result.drawnCard
      ? { playerId: params.playerId, cardIds: [result.drawnCard.id], at: Date.now() }
      : game.lastAcquired,
  }
  return { room: session.room, game: session.game }
}

function attempt_meld(params: {
  roomId: string
  playerId: string
  handCardIds: string[]
  targetMeldId?: string | null
  selectedDiscardIds?: string[]
  slideEdge?: 'top' | 'bottom'
}): { room: RoomState; game: GameState; error?: string } {
  const session = requireSession(params.roomId)
  if (!session.game) throw new Error('Game not started.')
  let room = session.room
  let game = session.game
  if (game.turn.activePlayerId !== params.playerId) throw new Error('Not your turn.')

  const team = findTeamForPlayer(room, params.playerId)
  if (!team) throw new Error('Team not found.')

  const selectedDiscardIds = params.selectedDiscardIds ?? []
  const isTopTouch = selectedDiscardIds.length > 0
  if (isTopTouch && game.turn.phase !== 'draw') throw new Error('Top Touch only during draw phase.')
  if (!isTopTouch && game.turn.phase !== 'action') throw new Error('Meld only during action phase.')

  const result = attemptMeldAction({
    hand: game.hands[params.playerId] ?? [],
    team,
    selectedHandCardIds: params.handCardIds ?? [],
    targetMeldId: params.targetMeldId ?? null,
    topTouch:
      isTopTouch
        ? { discardPile: game.discardPile.cards, selectedDiscardIds }
        : null,
    slideEdge: params.slideEdge,
  })

  if (!result.ok) {
    if (result.needsSlideChoice) {
      session.game = {
        ...game,
        pendingSlide: {
          teamId: team.id,
          meldId: params.targetMeldId!,
          displacedWildCardId: result.needsSlideChoice.displacedWildCardId,
        },
      }
      return { room, game: session.game, error: result.error }
    }
    throw new Error(result.error)
  }

  const meldsAfter =
    result.kind === 'append'
      ? team.melds.map((m) => (m.id === result.meld.id ? result.meld : m))
      : [...team.melds, result.meld]

  let hand = result.hand
  let pozzettoStacks = game.pozzettoStacks
  let pozzetto = team.pozzetto

  if (isTopTouch) {
    const usedIds = new Set(result.usedDiscardCards.map((c) => c.id))
    const restOfPile = game.discardPile.cards.filter((c) => !usedIds.has(c.id))
    hand = sortHand([...hand, ...restOfPile])
    game = {
      ...game,
      discardPile: { cards: [] },
      lastAcquired: {
        playerId: params.playerId,
        cardIds: [...result.usedDiscardCards.map((c) => c.id), ...restOfPile.map((c) => c.id)],
        at: Date.now(),
      },
    }
  }

  const claim = tryClaimPozzetto(game, { ...team, melds: meldsAfter, pozzetto }, params.playerId, hand, 'meld-empty', hand.length)
  hand = claim.hand
  pozzettoStacks = claim.pozzettoStacks
  pozzetto = claim.pozzetto

  room = withTeam(room, team.id, (t) => ({ ...t, melds: meldsAfter, pozzetto }))
  game = {
    ...game,
    hands: { ...game.hands, [params.playerId]: sortHand(hand) },
    pozzettoStacks,
    turn: { ...game.turn, phase: 'action', hasDrawnThisTurn: true },
    pendingSlide: null,
  }

  const teamAfter = findTeamForPlayer(room, params.playerId)!
  const autoShow = tryAutoShowEnd(room, game, teamAfter, params.playerId)
  if (autoShow.ended) {
    session.room = autoShow.room
    session.game = autoShow.game
    return { room: session.room, game: session.game }
  }

  session.room = room
  session.game = game
  return { room, game }
}

function resolve_slide(params: {
  roomId: string
  playerId: string
  edge: 'top' | 'bottom'
  handCardIds: string[]
  targetMeldId: string
}): { room: RoomState; game: GameState } {
  return attempt_meld({
    roomId: params.roomId,
    playerId: params.playerId,
    handCardIds: params.handCardIds,
    targetMeldId: params.targetMeldId,
    slideEdge: params.edge,
  })
}

function discard(params: { roomId: string; playerId: string; cardId: string }): {
  room: RoomState
  game: GameState
} {
  const session = requireSession(params.roomId)
  if (!session.game) throw new Error('Game not started.')
  let room = session.room
  let game = session.game
  if (game.turn.activePlayerId !== params.playerId) throw new Error('Not your turn.')
  if (!game.turn.hasDrawnThisTurn) throw new Error('Draw before discarding.')

  const team = findTeamForPlayer(room, params.playerId)
  if (!team) throw new Error('Team not found.')

  const result = performDiscard(game.hands[params.playerId] ?? [], params.cardId, game.discardPile.cards)
  if (!result) throw new Error('Card not in hand.')

  const wasClaimedBefore = team.pozzetto.claimed
  const claim = tryClaimPozzetto(
    game,
    team,
    params.playerId,
    result.hand,
    'discard',
    result.handSizeBeforeDiscard,
  )
  const finalPozzetto = pozzettoAfterDiscard(claim.pozzetto, wasClaimedBefore)
  room = withTeam(room, team.id, (t) => ({ ...t, pozzetto: finalPozzetto }))
  game = {
    ...game,
    hands: { ...game.hands, [params.playerId]: sortHand(claim.hand) },
    discardPile: { cards: result.discardPile },
    pozzettoStacks: claim.pozzettoStacks,
  }

  const teamAfter = findTeamForPlayer(room, params.playerId)!
  const autoShow = tryAutoShowEnd(room, game, teamAfter, params.playerId)
  if (autoShow.ended) {
    session.room = autoShow.room
    session.game = autoShow.game
    return { room: session.room, game: session.game }
  }

  if (isIllegalEmptyHand(teamAfter, claim.hand.length)) {
    const prev = game.emptyHandFoulByTeam ?? { 'team-a': 0, 'team-b': 0 }
    game = {
      ...game,
      emptyHandFoulByTeam: {
        ...prev,
        [team.id]: (prev[team.id] ?? 0) + EMPTY_HAND_FOUL_PENALTY,
      },
    }
  }

  game = { ...game, turn: advanceTurn(game, room, params.playerId), pendingSlide: null }
  session.room = room
  session.game = game
  return { room, game }
}

function move_wild(params: { roomId: string; playerId: string; meldId: string }): {
  room: RoomState
  game: GameState
} {
  const session = requireSession(params.roomId)
  if (!session.game) throw new Error('Game not started.')
  const team = findTeamForPlayer(session.room, params.playerId)
  if (!team) throw new Error('Team not found.')
  const meld = team.melds.find((m) => m.id === params.meldId)
  if (!meld) throw new Error('Meld not found.')
  const moved = moveWildInMeld(meld)
  if (!moved.ok) throw new Error(moved.error)
  session.room = withTeam(session.room, team.id, (t) => ({
    ...t,
    melds: t.melds.map((m) => (m.id === meld.id ? moved.meld : m)),
  }))
  return { room: session.room, game: session.game }
}

function declare_show(params: { roomId: string; playerId: string }): {
  room: RoomState
  game: GameState
} {
  const session = requireSession(params.roomId)
  if (!session.game) throw new Error('Game not started.')
  const team = findTeamForPlayer(session.room, params.playerId)
  if (!team) throw new Error('Team not found.')
  const handSize = session.game.hands[params.playerId]?.length ?? 0
  const elig = evaluateShowEligibility(team, handSize)
  if (!elig.eligible) throw new Error('Not eligible to Show.')
  const scored = endRoundWithScore(session.room, session.game, 'show', team.id)
  session.room = scored.room
  session.game = scored.game
  return scored
}

function force_sudden_death(params: { roomId: string; playerId: string }): {
  room: RoomState
  game: GameState
} {
  const session = requireSession(params.roomId)
  if (!session.game) throw new Error('Game not started.')
  if (session.game.stock.length > 0) throw new Error('Stock is not empty.')
  const scored = endRoundWithScore(session.room, session.game, 'sudden-death', null)
  session.room = scored.room
  session.game = scored.game
  return scored
}

function auto_end_turn(params: { roomId: string; playerId: string }): {
  room: RoomState
  game: GameState
} {
  const session = requireSession(params.roomId)
  if (!session.game) throw new Error('Game not started.')
  // No-timer rooms never auto-skip a turn.
  if (session.room.turnTimerSeconds === 0) {
    return { room: session.room, game: session.game }
  }
  const game = session.game
  if (game.turn.activePlayerId !== params.playerId) throw new Error('Not your turn.')
  const hand = game.hands[params.playerId] ?? []
  if (hand.length === 0) {
    session.game = { ...game, turn: advanceTurn(game, session.room, params.playerId) }
    return { room: session.room, game: session.game }
  }
  // Ensure drawn so discard is legal.
  if (!game.turn.hasDrawnThisTurn && game.stock.length > 0) {
    draw({ roomId: params.roomId, playerId: params.playerId })
  }
  const latestHand = session.game!.hands[params.playerId] ?? []
  const cardId = latestHand[latestHand.length - 1]?.id
  if (!cardId) {
    session.game = {
      ...session.game!,
      turn: advanceTurn(session.game!, session.room, params.playerId),
    }
    return { room: session.room, game: session.game }
  }
  return discard({ roomId: params.roomId, playerId: params.playerId, cardId })
}

function toggle_pause(params: { roomId: string; playerId: string }): {
  room: RoomState
  game: GameState
} {
  const session = requireSession(params.roomId)
  if (!session.game) throw new Error('Game not started.')
  const turn = session.game.turn
  if (turn.isPaused) {
    const pausedFor = turn.pausedAt ? Date.now() - turn.pausedAt : 0
    session.game = {
      ...session.game,
      turn: {
        ...turn,
        isPaused: false,
        pausedAt: null,
        startedAt: turn.startedAt + pausedFor,
      },
    }
  } else {
    session.game = {
      ...session.game,
      turn: { ...turn, isPaused: true, pausedAt: Date.now() },
    }
  }
  void params.playerId
  return { room: session.room, game: session.game }
}

function start_new_game(params: { roomId: string; playerId: string }): {
  room: RoomState
  game: GameState
} {
  const session = requireSession(params.roomId)
  if (session.room.hostPlayerId !== params.playerId) throw new Error('Only the host can start a new game.')
  const room = rebuildTeamPlayerIds({
    ...session.room,
    status: 'in-progress',
    teams: session.room.teams.map((t) => ({
      ...t,
      score: 0,
      melds: [],
      hasGoneOut: false,
      pozzetto: initialPozzettoState(),
    })),
  })
  const game = dealNewRound(room, 1)
  session.room = room
  session.game = game
  return { room, game }
}

function next_round(params: { roomId: string; playerId: string }): {
  room: RoomState
  game: GameState
} {
  const session = requireSession(params.roomId)
  if (!session.game) throw new Error('Game not started.')
  if (session.room.status !== 'round-end') throw new Error('Round is not over.')
  if (session.game.gameOverTeamId) throw new Error('Match is over — start a new game.')
  const room = rebuildTeamPlayerIds({
    ...session.room,
    status: 'in-progress',
    teams: session.room.teams.map((t) => ({
      ...t,
      melds: [],
      hasGoneOut: false,
      pozzetto: initialPozzettoState(),
    })),
  })
  const game = {
    ...dealNewRound(room, session.game.round + 1),
    roundScoresHistory: session.game.roundScoresHistory,
  }
  void params.playerId
  session.room = room
  session.game = game
  return { room, game }
}

function return_to_lobby(params: { roomId: string; playerId: string }): {
  room: RoomState
  game: null
} {
  const session = requireSession(params.roomId)
  void params.playerId
  session.room = {
    ...session.room,
    status: 'lobby',
    players: session.room.players.map((p) => ({ ...p, isReady: false })),
    teams: session.room.teams.map((t) => ({
      ...t,
      melds: [],
      hasGoneOut: false,
      pozzetto: initialPozzettoState(),
    })),
  }
  session.game = null
  return { room: session.room, game: null }
}

function get_state(params: { roomId: string }): { room: RoomState; game: GameState | null } {
  const session = requireSession(params.roomId)
  return { room: session.room, game: session.game }
}

const METHODS: Record<string, (params: any) => unknown> = {
  create_room,
  join_room,
  rejoin_room,
  set_connection,
  set_team,
  set_seat,
  set_ready,
  set_timer,
  set_max_players,
  set_target,
  start_game,
  draw,
  attempt_meld,
  resolve_slide,
  discard,
  move_wild,
  declare_show,
  force_sudden_death,
  auto_end_turn,
  toggle_pause,
  start_new_game,
  next_round,
  return_to_lobby,
  get_state,
  _ping: () => ({ pong: true }),
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false })

rl.on('line', (line) => {
  let req: { id?: number | string; method?: string; params?: unknown }
  try {
    req = JSON.parse(line)
  } catch {
    process.stdout.write(JSON.stringify({ id: null, ok: false, error: 'Invalid JSON' }) + '\n')
    return
  }
  const id = req.id ?? null
  const method = req.method ?? ''
  const fn = METHODS[method]
  if (!fn) {
    process.stdout.write(JSON.stringify({ id, ok: false, error: `Unknown method: ${method}` }) + '\n')
    return
  }
  try {
    const result = fn(req.params ?? {})
    process.stdout.write(JSON.stringify({ id, ok: true, result }) + '\n')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    process.stdout.write(JSON.stringify({ id, ok: false, error: message }) + '\n')
  }
})

process.stdout.write(JSON.stringify({ id: null, ok: true, result: { ready: true } }) + '\n')
