import { describe, expect, it } from 'vitest'
import type { Player, RoomState, Team } from '../types/game'
import { initialPozzettoState } from './pozzetto'
import {
  fillLobbyBots,
  removeLobbyBots,
  resizeLobbyCapacity,
  switchTeamAllowingBotSwap,
} from './lobbyBots'

function player(partial: Partial<Player> & Pick<Player, 'id' | 'teamId' | 'seat'>): Player {
  return {
    name: partial.name ?? partial.id,
    isReady: false,
    isLocal: false,
    isMock: false,
    connectionStatus: 'connected',
    avatarColor: '#fff',
    ...partial,
  }
}

function emptyTeam(id: Team['id'], name: string): Team {
  return {
    id,
    name,
    playerIds: [],
    melds: [],
    score: 0,
    hasGoneOut: false,
    pozzetto: initialPozzettoState(),
  }
}

function lobby(players: Player[], maxPlayers: 2 | 4 = 4): RoomState {
  return {
    roomId: 'ABCDE',
    status: 'lobby',
    players,
    teams: [emptyTeam('team-a', 'Team Red'), emptyTeam('team-b', 'Team Blue')],
    hostPlayerId: players[0]?.id ?? null,
    matchTargetScore: 2100,
    maxPlayers,
    turnTimerSeconds: 0,
  }
}

describe('fillLobbyBots', () => {
  it('fills empty 2v2 slots so opposite humans each get a bot partner', () => {
    const room = fillLobbyBots(
      lobby([
        player({ id: 'h1', name: 'Ada', teamId: 'team-a', seat: 0 }),
        player({ id: 'h2', name: 'Ben', teamId: 'team-b', seat: 1 }),
      ]),
    )
    expect(room.players).toHaveLength(4)
    expect(room.players.filter((p) => p.teamId === 'team-a')).toHaveLength(2)
    expect(room.players.filter((p) => p.teamId === 'team-b')).toHaveLength(2)
    expect(room.players.filter((p) => p.isMock)).toHaveLength(2)
    expect(room.players.filter((p) => p.isMock).every((p) => p.isReady)).toBe(true)
  })

  it('puts both bots on the empty team when humans sit together', () => {
    const room = fillLobbyBots(
      lobby([
        player({ id: 'h1', teamId: 'team-a', seat: 0 }),
        player({ id: 'h2', teamId: 'team-a', seat: 1 }),
      ]),
    )
    expect(room.players.filter((p) => p.teamId === 'team-b' && p.isMock)).toHaveLength(2)
    expect(room.players.filter((p) => p.teamId === 'team-a' && !p.isMock)).toHaveLength(2)
  })
})

describe('switchTeamAllowingBotSwap', () => {
  it('swaps a human onto a bot-filled team and the bot takes the vacated seat', () => {
    const filled = fillLobbyBots(
      lobby([
        player({ id: 'h1', name: 'Ada', teamId: 'team-a', seat: 0 }),
        player({ id: 'h2', name: 'Ben', teamId: 'team-b', seat: 1 }),
      ]),
    )
    const botOnB = filled.players.find((p) => p.isMock && p.teamId === 'team-b')!
    const swapped = switchTeamAllowingBotSwap(filled, 'h1', 'team-b')

    const ada = swapped.players.find((p) => p.id === 'h1')!
    const movedBot = swapped.players.find((p) => p.id === botOnB.id)!
    expect(ada.teamId).toBe('team-b')
    expect(ada.seat).toBe(botOnB.seat)
    expect(movedBot.teamId).toBe('team-a')
    expect(movedBot.seat).toBe(0)
    expect(swapped.players.filter((p) => p.teamId === 'team-a')).toHaveLength(2)
    expect(swapped.players.filter((p) => p.teamId === 'team-b')).toHaveLength(2)
  })

  it('rejects a switch onto a team that is full of humans', () => {
    const room = lobby([
      player({ id: 'h1', teamId: 'team-a', seat: 0 }),
      player({ id: 'h2', teamId: 'team-b', seat: 1 }),
      player({ id: 'h3', teamId: 'team-b', seat: 2 }),
    ])
    expect(() => switchTeamAllowingBotSwap(room, 'h1', 'team-b')).toThrow('That team is full.')
  })
})

describe('resizeLobbyCapacity', () => {
  it('drops bots when shrinking 4 → 2 and keeps humans', () => {
    const filled = fillLobbyBots(
      lobby([
        player({ id: 'h1', teamId: 'team-a', seat: 0 }),
        player({ id: 'h2', teamId: 'team-b', seat: 1 }),
      ]),
    )
    const shrunk = resizeLobbyCapacity(filled, 2)
    expect(shrunk.maxPlayers).toBe(2)
    expect(shrunk.players.every((p) => !p.isMock)).toBe(true)
    expect(shrunk.players.map((p) => p.id).sort()).toEqual(['h1', 'h2'])
  })
})

describe('removeLobbyBots', () => {
  it('removes only mocks', () => {
    const filled = fillLobbyBots(lobby([player({ id: 'h1', teamId: 'team-a', seat: 0 })]))
    const cleared = removeLobbyBots(filled)
    expect(cleared.players).toEqual([expect.objectContaining({ id: 'h1', isMock: false })])
  })
})
