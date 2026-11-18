import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import { getSocket } from '../lib/socket'

// A saved route is only a navigation hint. Room membership is restored by
// the existing lobby/table session code and checked by the multiplayer server.
const savedPathKey = 'canasta.android.lastTable'
const tablePath = /^\/(game|lobby)\/[A-Z0-9]{5}$/

export function AndroidSession() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const hasRoom = useGameStore(s => !!s.room)
  const online = useGameStore(s => s.playMode === 'online')
  const [disconnected, setDisconnected] = useState(false)
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
    if (!atTable || !hasRoom || !online) return
    const socket = getSocket()
    const syncStatus = () => setDisconnected(!navigator.onLine || !socket.connected)
    syncStatus()
    socket.on('connect', syncStatus)
    socket.on('disconnect', syncStatus)
    window.addEventListener('offline', syncStatus)
    window.addEventListener('online', syncStatus)
    return () => {
      socket.off('connect', syncStatus)
      socket.off('disconnect', syncStatus)
      window.removeEventListener('offline', syncStatus)
      window.removeEventListener('online', syncStatus)
    }
  }, [atTable, hasRoom, online])

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

  if (atTable && hasRoom && online && disconnected) {
    return (
      <div role="status" className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-2 bg-emerald-950 p-2 text-center text-sm text-white">
        Connection lost.
        <button className="rounded border border-white/40 px-3 py-1" onClick={() => void useGameStore.getState().actions.rejoinOnlineSession()}>Reconnect</button>
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
