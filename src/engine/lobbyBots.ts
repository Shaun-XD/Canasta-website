import type { Player, RoomState, TeamId } from '../types/game'
import { normalizeMaxPlayers, seatsPerTeam } from '../types/game'

const AVATAR_COLORS = ['#ef4444', '#3b82f6', '#eab308', '#22c55e', '#a855f7', '#ec4899']

const BOT_LABELS: Record<TeamId, string[]> = {
  'team-a': ['Teammate (bot)', 'Red bot'],
  'team-b': ['Opponent (bot)', 'Opponent #2 (bot)'],
}

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

export function rebuildLobbyTeams(room: RoomState): RoomState {
  return {
    ...room,
    teams: room.teams.map((t) => ({
      ...t,
      playerIds: room.players.filter((p) => p.teamId === t.id).map((p) => p.id),
    })),
  }
}

/** Seat A/B/A/B so partners sit opposite and turn order alternates. */
export function seatPlayersAlternating(players: Player[]): Player[] {
  const teamA = players.filter((p) => p.teamId === 'team-a').sort((a, b) => a.seat - b.seat)
  const teamB = players.filter((p) => p.teamId === 'team-b').sort((a, b) => a.seat - b.seat)
  const seated: Player[] = []
  const n = Math.max(teamA.length, teamB.length)
  for (let i = 0; i < n; i += 1) {
    if (teamA[i]) seated.push({ ...teamA[i], seat: seated.length })
    if (teamB[i]) seated.push({ ...teamB[i], seat: seated.length })
  }
  return seated
}

function nextFreeSeat(players: Player[], capacity: number): number {
  const used = new Set(players.map((p) => p.seat))
  for (let seat = 0; seat < capacity; seat += 1) {
    if (!used.has(seat)) return seat
  }
  return players.length
}

function nextBotName(players: Player[], teamId: TeamId): string {
  const used = new Set(players.map((p) => p.name))
  for (const name of BOT_LABELS[teamId]) {
    if (!used.has(name)) return name
  }
  return `Bot ${players.filter((p) => p.isMock).length + 1}`
}

/** Fill every empty team slot with a ready bot. Existing humans keep their seats. */
export function fillLobbyBots(room: RoomState): RoomState {
  if (room.status !== 'lobby') throw new Error('Can only fill bots in the lobby.')
  const capacity = normalizeMaxPlayers(room.maxPlayers)
  const perTeam = seatsPerTeam(capacity)
  const players = [...room.players]
  const teams: TeamId[] = ['team-a', 'team-b']

  while (players.length < capacity) {
    const teamId = teams.find((id) => players.filter((p) => p.teamId === id).length < perTeam)
    if (!teamId) break
    players.push({
      id: randomId('bot'),
      name: nextBotName(players, teamId),
      teamId,
      seat: nextFreeSeat(players, capacity),
      isReady: true,
      isLocal: false,
      isMock: true,
      connectionStatus: 'connected',
      avatarColor: AVATAR_COLORS[players.length % AVATAR_COLORS.length],
    })
  }

  return rebuildLobbyTeams({ ...room, players: seatPlayersAlternating(players) })
}

export function removeLobbyBots(room: RoomState): RoomState {
  if (room.status !== 'lobby') throw new Error('Can only remove bots in the lobby.')
  return rebuildLobbyTeams({
    ...room,
    players: room.players.filter((p) => !p.isMock),
  })
}

/**
 * Move a human onto `teamId`. If that team is already at capacity but has a
 * bot, swap: the bot takes the human's old team and seat.
 */
export function switchTeamAllowingBotSwap(
  room: RoomState,
  playerId: string,
  teamId: TeamId,
): RoomState {
  if (room.status !== 'lobby') throw new Error('Cannot change team after start.')
  const player = room.players.find((p) => p.id === playerId)
  if (!player) throw new Error('Player not in room.')
  if (player.teamId === teamId) return room

  const perTeam = seatsPerTeam(normalizeMaxPlayers(room.maxPlayers))
  const dest = room.players.filter((p) => p.teamId === teamId)
  if (dest.length < perTeam) {
    const moved = room.players.map((p) => (p.id === playerId ? { ...p, teamId } : p))
    return rebuildLobbyTeams({ ...room, players: seatPlayersAlternating(moved) })
  }

  const destBot = dest.find((p) => p.isMock)
  if (!destBot) throw new Error('That team is full.')

  const fromTeam = player.teamId
  const fromSeat = player.seat
  const swapped = room.players.map((p) => {
    if (p.id === playerId) return { ...p, teamId, seat: destBot.seat }
    if (p.id === destBot.id) return { ...p, teamId: fromTeam, seat: fromSeat }
    return p
  })
  return rebuildLobbyTeams({ ...room, players: seatPlayersAlternating(swapped) })
}

/** Shrink/grow capacity. Humans are never dropped; extra bots are removed. */
export function resizeLobbyCapacity(room: RoomState, capacity: 2 | 4): RoomState {
  if (room.status !== 'lobby') throw new Error('Cannot change player count after the game starts.')
  const humans = room.players.filter((p) => !p.isMock)
  if (humans.length > capacity) {
    throw new Error(
      `Cannot set ${capacity}-player lobby — ${humans.length} humans already joined.`,
    )
  }
  let players = room.players
  if (players.length > capacity) {
    const extra = players.length - capacity
    const dropIds = new Set(
      players
        .filter((p) => p.isMock)
        .slice(-extra)
        .map((p) => p.id),
    )
    players = players.filter((p) => !dropIds.has(p.id))
  }
  return rebuildLobbyTeams({ ...room, players: seatPlayersAlternating(players), maxPlayers: capacity })
}
