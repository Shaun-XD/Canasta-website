import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import { getSocket, socketRejoinRoom } from '../lib/socket'

// A saved route is only a navigation hint. Room membership is restored by
// the existing lobby/table session code and checked by the multiplayer server.
const savedPathKey = 'canasta.android.lastTable'
const tablePath = /^\/(game|lobby)\/[A-Z0-9]{5}$/

export function AndroidSession() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const hasRoom = useGameStore(s => !!s.room)
  const online = useGameStore(s => s.playMode === 'online')
  const roomId = useGameStore(s => s.room?.roomId)
  const playerId = useGameStore(s => s.localPlayerId)
  const [recoveryMessage, setRecoveryMessage] = useState('')
  const retryRef = useRef<() => void>(() => {})
  const [savedPath, setSavedPath] = useState(() => localStorage.getItem(savedPathKey))
  const atTable = tablePath.test(pathname)

  useEffect(() => {
    if (atTable && hasRoom) {
      if (online) {
        localStorage.setItem(savedPathKey, pathname)
        setSavedPath(pathname)
      } else {
        localStorage.removeItem(savedPathKey)
        setSavedPath(null)
      }
    }
    if (!localStorage.getItem('canasta.onlineSession')) {
      localStorage.removeItem(savedPathKey)
      setSavedPath(null)
    }
  }, [atTable, hasRoom, online, pathname])

  useEffect(() => {
    setRecoveryMessage('')
    if (!atTable || !roomId || !playerId || !online) return
    const seat = { roomId, playerId }
    const socket = getSocket()
    let generation = 0
    let pending = false
    let lost = false
    let timer: number | undefined
    let disposed = false
    const currentSeat = () => {
      const state = useGameStore.getState()
      return !disposed && state.playMode === 'online' &&
        state.room?.roomId === roomId && state.localPlayerId === playerId
    }

    function invalidate() {
      generation++
      pending = false
      lost = true
      window.clearTimeout(timer)
      setRecoveryMessage('Connection lost.')
    }
    function retryLater() {
      window.clearTimeout(timer)
      if (navigator.onLine && !document.hidden) timer = window.setTimeout(recover, 3000)
    }
    async function recover() {
      if (!currentSeat() || pending || document.hidden) return
      lost = true
      setRecoveryMessage('Rejoining table…')
      if (!socket.connected) {
        socket.connect()
        retryLater()
        return
      }
      pending = true
      const attempt = generation
      const ack = await socketRejoinRoom(seat)
      if (!currentSeat() || attempt !== generation) return
      pending = false
      if (ack.ok && ack.room && ack.room.roomId === roomId && ack.playerId === playerId &&
          ack.room.players.some(p => p.id === playerId && p.connectionStatus === 'connected')) {
        window.clearTimeout(timer)
        lost = false
        useGameStore.setState({ room: ack.room, game: ack.game ?? null, lastActionError: null })
        setRecoveryMessage('')
        return
      }
      setRecoveryMessage(ack.error || 'Could not rejoin the table.')
      if (/room not found|player not (in|found)/i.test(ack.error ?? '')) return
      // A failed ack can mean the WebView's socket still looks connected
      // after a network switch. Start a fresh transport before retrying.
      socket.disconnect()
      retryLater()
    }
    function disconnected() {
      if (!currentSeat()) return
      invalidate()
      retryLater()
    }
    function offline() {
      invalidate()
      socket.disconnect()
    }
    function visible() {
      if (!document.hidden) void recover()
    }
    // The backend can receive the old socket's disconnect after the new
    // session has rejoined. Repair that seat's authoritative presence.
    const unsubscribe = useGameStore.subscribe((next, prev) => {
      if (!currentSeat() || lost || next.room === prev.room) return
      const presence = next.room?.players.find(p => p.id === playerId)?.connectionStatus
      if (presence === 'disconnected') void recover()
    })
    // Android can briefly report offline after an interface change. An explicit
    // retry and an actual Socket.IO connection should still try the server.
    retryRef.current = recover
    socket.on('connect', recover)
    socket.on('disconnect', disconnected)
    window.addEventListener('offline', offline)
    window.addEventListener('online', recover)
    document.addEventListener('visibilitychange', visible)
    if (!socket.connected || !navigator.onLine) disconnected()
    return () => {
      disposed = true
      window.clearTimeout(timer)
      unsubscribe()
      socket.off('connect', recover)
      socket.off('disconnect', disconnected)
      window.removeEventListener('offline', offline)
      window.removeEventListener('online', recover)
      document.removeEventListener('visibilitychange', visible)
      retryRef.current = () => {}
    }
  }, [atTable, roomId, playerId, online])

  useEffect(() => {
    function onBack(event: Event) {
      if (!atTable) return
      event.preventDefault()
      const close = document.querySelector<HTMLButtonElement>('[aria-label="Close table menu"]')
      if (close) { close.click(); return }
      if (window.confirm('Leave this table and return to the home screen?')) {
        useGameStore.getState().actions.exitToHome()
        navigate('/', { replace: true })
      }
    }
    window.addEventListener('canasta-back', onBack)
    return () => window.removeEventListener('canasta-back', onBack)
  }, [atTable, navigate])

  if (atTable && hasRoom && online && recoveryMessage) {
    return (
      <div role="status" className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-2 bg-emerald-950 p-2 text-center text-sm text-white">
        <span>{recoveryMessage}</span>
        <button className="rounded border border-white/40 px-3 py-1" onClick={() => retryRef.current()}>Reconnect</button>
        <button className="rounded border border-white/40 px-3 py-1" onClick={() => {
          useGameStore.getState().actions.exitToHome()
          navigate('/', { replace: true })
        }}>Exit to home</button>
      </div>
    )
  }
  if (pathname === '/' && savedPath && tablePath.test(savedPath)) {
    return <button className="fixed bottom-3 right-3 z-50 rounded-lg bg-yellow-400 px-4 py-3 text-sm font-bold text-emerald-950 shadow" onClick={() => {
      localStorage.removeItem(savedPathKey)
      setSavedPath(null)
      navigate(savedPath)
    }}>Resume online table</button>
  }
  return null
}
