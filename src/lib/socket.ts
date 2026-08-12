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

function emitAck<T = RoomAck>(event: string, payload?: unknown): Promise<T> {
  const s = connectSocket()
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Server timeout — is the backend running?')), 12000)
    s.timeout(10000).emit(event, payload ?? {}, (err: Error | null, res: T) => {
      window.clearTimeout(timer)
      if (err) reject(err)
      else resolve(res)
    })
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

export function socketSetTeam(teamId: TeamId): void {
  connectSocket().emit('room:setTeam', { teamId })
}

export function socketSetSeat(seat: number): void {
  connectSocket().emit('room:setSeat', { seat })
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

export function socketSetTarget(score: number): void {
  connectSocket().emit('room:setTarget', { score })
}

export async function socketStartGame(): Promise<RoomAck> {
  return emitAck('room:start')
}

export function socketDraw(): void {
  connectSocket().emit('game:draw')
}

export function socketAttemptMeld(payload: {
  handCardIds: string[]
  targetMeldId?: string | null
  selectedDiscardIds?: string[]
  slideEdge?: 'top' | 'bottom'
}): void {
  connectSocket().emit('game:attemptMeld', payload)
}

export function socketResolveSlide(payload: {
  edge: 'top' | 'bottom'
  handCardIds: string[]
  targetMeldId: string
}): void {
  connectSocket().emit('game:resolveSlide', payload)
}

export function socketDiscard(cardId: string): void {
  connectSocket().emit('game:discard', { cardId })
}

export function socketMoveWild(meldId: string): void {
  connectSocket().emit('game:moveWild', { meldId })
}

export function socketDeclareShow(): void {
  connectSocket().emit('game:declareShow')
}

export function socketForceSuddenDeath(): void {
  connectSocket().emit('game:forceSuddenDeath')
}

export function socketAutoEndTurn(): void {
  connectSocket().emit('game:autoEndTurn')
}

export function socketTogglePause(): void {
  connectSocket().emit('game:togglePause')
}

export function socketStartNewGame(): void {
  connectSocket().emit('game:startNewGame')
}

export function socketNextRound(): void {
  connectSocket().emit('game:nextRound')
}

export function socketReturnToLobby(): void {
  connectSocket().emit('room:returnToLobby')
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
