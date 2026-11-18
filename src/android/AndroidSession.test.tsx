import { EventEmitter } from 'node:events'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { RoomAck } from '../lib/socket'
import { getSocket, socketRejoinRoom } from '../lib/socket'
import { useGameStore } from '../store/gameStore'
import { AndroidSession } from './AndroidSession'

vi.mock('../lib/socket', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/socket')>(),
  getSocket: vi.fn(),
  socketRejoinRoom: vi.fn(),
}))

class FakeSocket extends EventEmitter {
  connected = true
  connect = vi.fn()
  disconnect = () => {
    this.connected = false
    this.emit('disconnect')
  }
}

let socket: FakeSocket
let resolveAck: (ack: RoomAck) => void
let seatAck: RoomAck
beforeEach(() => {
  socket = new FakeSocket()
  vi.mocked(getSocket).mockReturnValue(socket as unknown as ReturnType<typeof getSocket>)
  vi.mocked(socketRejoinRoom).mockImplementation(() => new Promise(r => { resolveAck = r }))
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  const roomId = useGameStore.getState().actions.createRoom('Guest')
  const { room, localPlayerId } = useGameStore.getState()
  seatAck = { ok: true, room: room!, playerId: localPlayerId!, game: null }
  useGameStore.setState({ playMode: 'online' })
  render(<MemoryRouter initialEntries={[`/lobby/${roomId}`]}><AndroidSession /></MemoryRouter>)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks() })

it('keeps recovery visible after transport reconnect until the same seat has an acknowledgement', async () => {
  expect(socketRejoinRoom).not.toHaveBeenCalled()
  act(() => socket.disconnect())
  expect(screen.getByText('Connection lost.')).toBeTruthy()
  act(() => { socket.connected = true; socket.emit('connect'); window.dispatchEvent(new Event('online')) })
  expect(screen.getByText('Rejoining table…')).toBeTruthy()
  fireEvent.click(screen.getByText('Reconnect'))
  expect(socketRejoinRoom).toHaveBeenCalledTimes(1)
  await act(async () => resolveAck(seatAck))
  expect(screen.queryByRole('status')).toBeNull()

  // A late disconnect from the old socket can mark the current seat offline.
  act(() => useGameStore.setState({
    room: { ...seatAck.room!, players: seatAck.room!.players.map(p =>
      p.id === seatAck.playerId ? { ...p, connectionStatus: 'disconnected' } : p) },
  }))
  expect(socketRejoinRoom).toHaveBeenCalledTimes(2)
  await act(async () => resolveAck(seatAck))
  expect(screen.queryByRole('status')).toBeNull()
})

it('ignores a late acknowledgement from a lost transport and offers a retry or exit for a missing room', async () => {
  act(() => { socket.disconnect(); socket.connected = true; socket.emit('connect') })
  const stale = resolveAck
  act(() => socket.disconnect())
  await act(async () => stale(seatAck))
  expect(screen.getByText('Connection lost.')).toBeTruthy()
  act(() => { socket.connected = true; socket.emit('connect') })
  await act(async () => resolveAck({ ok: false, error: 'Room not found.' }))
  expect(screen.getByText('Room not found.')).toBeTruthy()
  expect(screen.getByText('Exit to home')).toBeTruthy()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  fireEvent.click(screen.getByText('Reconnect'))
  await act(async () => resolveAck(seatAck))
  expect(screen.queryByRole('status')).toBeNull()
})
