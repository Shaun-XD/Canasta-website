import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import { Card } from '../components/Card'

export function Landing() {
  const navigate = useNavigate()
  const createRoom = useGameStore((s) => s.actions.createRoom)
  const joinRoom = useGameStore((s) => s.actions.joinRoom)

  const [name, setName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [error, setError] = useState('')

  function handleCreate() {
    if (!name.trim()) {
      setError('Enter your name first.')
      return
    }
    const roomId = createRoom(name.trim())
    navigate(`/lobby/${roomId}`)
  }

  function handleJoin() {
    if (!name.trim()) {
      setError('Enter your name first.')
      return
    }
    if (!joinCode.trim()) {
      setError('Enter a room code to join.')
      return
    }
    joinRoom(joinCode.trim(), name.trim())
    navigate(`/lobby/${joinCode.trim().toUpperCase()}`)
  }

  return (
    <div className="felt-bg flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="mb-10 flex items-center gap-4">
        <div className="flex gap-1 -rotate-6">
          <Card rank="A" suit="spades" width={54} />
          <Card rank="K" suit="hearts" width={54} className="rotate-6" />
        </div>
        <div className="text-left">
          <h1 className="text-5xl font-black tracking-tight text-white drop-shadow">
            Canasta
          </h1>
          <p className="text-sm font-medium text-white/60">Online multiplayer · 2 vs 2</p>
        </div>
      </div>

      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-black/25 p-6 shadow-2xl backdrop-blur">
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-white/60">
          Your name
        </label>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setError('')
          }}
          placeholder="e.g. Alex"
          maxLength={24}
          className="mb-4 w-full rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-white placeholder-white/40 outline-none focus:border-yellow-300 focus:ring-1 focus:ring-yellow-300"
        />

        <div className="mb-4 flex rounded-lg bg-white/5 p-1">
          <button
            type="button"
            onClick={() => setMode('create')}
            className={`flex-1 rounded-md py-1.5 text-sm font-semibold transition ${
              mode === 'create' ? 'bg-yellow-400 text-emerald-950' : 'text-white/70 hover:text-white'
            }`}
          >
            Create Room
          </button>
          <button
            type="button"
            onClick={() => setMode('join')}
            className={`flex-1 rounded-md py-1.5 text-sm font-semibold transition ${
              mode === 'join' ? 'bg-yellow-400 text-emerald-950' : 'text-white/70 hover:text-white'
            }`}
          >
            Join Room
          </button>
        </div>

        {mode === 'join' && (
          <input
            value={joinCode}
            onChange={(e) => {
              setJoinCode(e.target.value.toUpperCase())
              setError('')
            }}
            placeholder="Room code, e.g. AB3XZ"
            maxLength={8}
            className="mb-4 w-full rounded-lg border border-white/15 bg-white/10 px-3 py-2 tracking-widest text-white placeholder-white/40 outline-none focus:border-yellow-300 focus:ring-1 focus:ring-yellow-300"
          />
        )}

        {error && <p className="mb-3 text-sm text-red-300">{error}</p>}

        <button
          type="button"
          onClick={mode === 'create' ? handleCreate : handleJoin}
          className="w-full rounded-lg bg-yellow-400 py-2.5 font-semibold text-emerald-950 shadow transition hover:bg-yellow-300 active:scale-[0.99]"
        >
          {mode === 'create' ? 'Create Room' : 'Join Room'}
        </button>
      </div>

      <p className="mt-8 max-w-md text-center text-xs text-white/40">
        Frontend demo build — game rules (melds, canastas, scoring) are placeholder
        logic pending final ruleset. See README for details.
      </p>
    </div>
  )
}
