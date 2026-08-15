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

  return rebuildLobbyTeams({ ...room, players })
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
    return rebuildLobbyTeams({
      ...room,
      players: room.players.map((p) => (p.id === playerId ? { ...p, teamId } : p)),
    })
  }

  const destBot = dest.find((p) => p.isMock)
  if (!destBot) throw new Error('That team is full.')

  const fromTeam = player.teamId
  const fromSeat = player.seat
  return rebuildLobbyTeams({
    ...room,
    players: room.players.map((p) => {
      if (p.id === playerId) return { ...p, teamId, seat: destBot.seat }
      if (p.id === destBot.id) return { ...p, teamId: fromTeam, seat: fromSeat }
      return p
    }),
  })
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
  return rebuildLobbyTeams({ ...room, players, maxPlayers: capacity })
}
