import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import { Card } from '../components/Card'
import { DEFAULT_TARGET_SCORE, DEFAULT_TURN_TIMER_SECONDS } from '../types/game'

export function Landing() {
  const navigate = useNavigate()
  const createRoom = useGameStore((s) => s.actions.createRoom)
  const joinRoom = useGameStore((s) => s.actions.joinRoom)

  const [name, setName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [error, setError] = useState('')
  const [targetScore, setTargetScore] = useState(String(DEFAULT_TARGET_SCORE))
  const [turnTimerSeconds, setTurnTimerSeconds] = useState(String(DEFAULT_TURN_TIMER_SECONDS))

  function handleCreate() {
    if (!name.trim()) {
      setError('Enter your name first.')
      return
    }
    const parsedTarget = Number(targetScore)
    const parsedTimer = Number(turnTimerSeconds)
    const roomId = createRoom(
      name.trim(),
      Number.isFinite(parsedTarget) && parsedTarget > 0 ? parsedTarget : DEFAULT_TARGET_SCORE,
      Number.isFinite(parsedTimer) && parsedTimer >= 10 ? parsedTimer : DEFAULT_TURN_TIMER_SECONDS,
    )
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

        {mode === 'create' && (
          <div className="mb-4">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-white/60">
              Match target score
            </label>
            <input
              type="number"
              min={500}
              step={100}
              value={targetScore}
              onChange={(e) => setTargetScore(e.target.value)}
              className="w-full rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-white placeholder-white/40 outline-none focus:border-yellow-300 focus:ring-1 focus:ring-yellow-300"
            />
            <p className="mt-1 text-[11px] text-white/40">Default {DEFAULT_TARGET_SCORE}. First team to reach this wins the match.</p>

            <label className="mb-1 mt-4 block text-xs font-semibold uppercase tracking-wide text-white/60">
              Turn timer (seconds)
            </label>
            <input
              type="number"
              min={10}
              step={5}
              value={turnTimerSeconds}
              onChange={(e) => setTurnTimerSeconds(e.target.value)}
              className="w-full rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-white placeholder-white/40 outline-none focus:border-yellow-300 focus:ring-1 focus:ring-yellow-300"
            />
            <p className="mt-1 text-[11px] text-white/40">
              Default {DEFAULT_TURN_TIMER_SECONDS}s. Applies to every player; a turn auto-ends if it runs out.
            </p>
          </div>
        )}

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
        Full Rajasthani Canasta rules engine — Sets & Sequences, wild-card limits, the
        Slide, Pozzetto, and Show. See README for details.
      </p>
    </div>
  )
}
