import { io, type Socket } from 'socket.io-client'
import type { GameState, RoomState, TeamId } from '../types/game'

/**
 * Realtime client for the FastAPI + Socket.IO backend (`server/`).
 *
 * Set `VITE_SOCKET_URL` (e.g. https://your-api.railway.app). When unset,
 * defaults to local `http://localhost:4000`. Solo/mock mode does not need
 * a socket connection.
 */

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:4000'

let socket: Socket | null = null

export type RoomAck = {
  ok: boolean
  error?: string
  roomId?: string
  playerId?: string
  room?: RoomState
  game?: GameState | null
}

export function getSocketUrl(): string {
  return SOCKET_URL
}

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      autoConnect: false,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 12,
      reconnectionDelay: 800,
    })
  }
  return socket
}

export function connectSocket(): Socket {
  const s = getSocket()
  if (!s.connected) s.connect()
  return s
}

export function disconnectSocket(): void {
  if (socket?.connected) socket.disconnect()
}

function emitAck(event: string, payload?: unknown): Promise<RoomAck> {
  const s = connectSocket()
  return new Promise((resolve) => {
    const fail = (error: string) => resolve({ ok: false, error })
    const timer = window.setTimeout(() => fail('Server timeout — is the backend running?'), 12000)
    try {
      s.timeout(10000).emit(event, payload ?? {}, (err: Error | null, res: RoomAck) => {
        window.clearTimeout(timer)
        if (err) fail(err.message || 'Request failed.')
        else resolve(res ?? { ok: false, error: 'Empty server response.' })
      })
    } catch (err) {
      window.clearTimeout(timer)
      fail(err instanceof Error ? err.message : 'Request failed.')
    }
  })
}

export async function socketCreateRoom(opts: {
  playerName: string
  targetScore?: number
  turnTimerSeconds?: number
  maxPlayers?: number
}): Promise<RoomAck> {
  return emitAck('room:create', opts)
}

export async function socketJoinRoom(opts: { roomId: string; playerName: string }): Promise<RoomAck> {
  return emitAck('room:join', opts)
}

export async function socketRejoinRoom(opts: { roomId: string; playerId: string }): Promise<RoomAck> {
  return emitAck('room:rejoin', opts)
}

export function socketSetTeam(teamId: TeamId): Promise<RoomAck> {
  return emitAck('room:setTeam', { teamId })
}

export function socketSetSeat(seat: number): Promise<RoomAck> {
  return emitAck('room:setSeat', { seat })
}

export function socketSetReady(ready?: boolean): Promise<RoomAck> {
  return emitAck('room:setReady', ready === undefined ? {} : { ready })
}

export function socketSetTimer(seconds: number): Promise<RoomAck> {
  return emitAck('room:setTimer', { seconds })
}

export function socketSetMaxPlayers(maxPlayers: number): Promise<RoomAck> {
  return emitAck('room:setMaxPlayers', { maxPlayers })
}

export function socketSetTarget(score: number): Promise<RoomAck> {
  return emitAck('room:setTarget', { score })
}

export async function socketStartGame(): Promise<RoomAck> {
  return emitAck('room:start')
}

export async function socketDraw(): Promise<RoomAck> {
  return emitAck('game:draw')
}

export async function socketAttemptMeld(payload: {
  handCardIds: string[]
  targetMeldId?: string | null
  selectedDiscardIds?: string[]
  slideEdge?: 'top' | 'bottom'
}): Promise<RoomAck> {
  return emitAck('game:attemptMeld', payload)
}

export async function socketResolveSlide(payload: {
  edge: 'top' | 'bottom'
  handCardIds: string[]
  targetMeldId: string
}): Promise<RoomAck> {
  return emitAck('game:resolveSlide', payload)
}

export async function socketDiscard(cardId: string): Promise<RoomAck> {
  return emitAck('game:discard', { cardId })
}

export function socketMoveWild(meldId: string): Promise<RoomAck> {
  return emitAck('game:moveWild', { meldId })
}

export function socketDeclareShow(): Promise<RoomAck> {
  return emitAck('game:declareShow')
}

export function socketForceSuddenDeath(): Promise<RoomAck> {
  return emitAck('game:forceSuddenDeath')
}

export function socketAutoEndTurn(): Promise<RoomAck> {
  return emitAck('game:autoEndTurn')
}

export async function socketTogglePause(): Promise<RoomAck> {
  return emitAck('game:togglePause')
}

export function socketStartNewGame(): Promise<RoomAck> {
  return emitAck('game:startNewGame')
}

export function socketNextRound(): Promise<RoomAck> {
  return emitAck('game:nextRound')
}

export function socketReturnToLobby(): Promise<RoomAck> {
  return emitAck('room:returnToLobby')
}

export function bindSocketStoreHandlers(handlers: {
  onRoomState: (room: RoomState, playerId: string) => void
  onGameState: (game: GameState | null, playerId: string) => void
  onActionError: (error: string) => void
  /** Fired after a transport reconnect — callers should rejoin the room. */
  onReconnect?: () => void
}): () => void {
  const s = connectSocket()
  const onRoom = (payload: { room: RoomState; playerId: string }) => {
    handlers.onRoomState(payload.room, payload.playerId)
  }
  const onGame = (payload: { game: GameState | null; playerId: string }) => {
    handlers.onGameState(payload.game, payload.playerId)
  }
  const onErr = (payload: { error: string }) => {
    handlers.onActionError(payload.error)
  }
  const onReconnect = () => {
    handlers.onReconnect?.()
  }
  s.on('room:state', onRoom)
  s.on('game:state', onGame)
  s.on('action:error', onErr)
  s.io.on('reconnect', onReconnect)
  return () => {
    s.off('room:state', onRoom)
    s.off('game:state', onGame)
    s.off('action:error', onErr)
    s.io.off('reconnect', onReconnect)
  }
}
