import { useEffect } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import { PlayerAvatar } from '../components/PlayerAvatar'
import type { TeamId } from '../types/game'

export function Lobby() {
  const { roomId } = useParams()
  const navigate = useNavigate()
  const room = useGameStore((s) => s.room)
  const localPlayerId = useGameStore((s) => s.localPlayerId)
  const { toggleReady, setLocalTeam, startGame } = useGameStore((s) => s.actions)

  useEffect(() => {
    if (room?.status === 'in-progress' && room.roomId === roomId) {
      navigate(`/game/${roomId}`)
    }
  }, [room?.status, room?.roomId, roomId, navigate])

  if (!room || room.roomId !== roomId) {
    return <Navigate to="/" replace />
  }

  const localPlayer = room.players.find((p) => p.id === localPlayerId)
  const allReady = room.players.length >= 4 && room.players.every((p) => p.isReady)

  function playersOnTeam(teamId: TeamId) {
    return room!.players.filter((p) => p.teamId === teamId).sort((a, b) => a.seat - b.seat)
  }

  return (
    <div className="felt-bg min-h-screen px-4 py-10 text-white">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-white/50">
            Room Code — share with friends
          </span>
          <div className="rounded-xl border border-white/15 bg-black/30 px-6 py-3 text-3xl font-black tracking-[0.3em] text-yellow-300 shadow-lg">
            {room.roomId}
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          {room.teams.map((team) => (
            <div key={team.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <h2 className="mb-3 flex items-center justify-between text-lg font-bold">
                {team.name}
                {localPlayer && localPlayer.teamId !== team.id && (
                  <button
                    type="button"
                    onClick={() => setLocalTeam(team.id)}
                    className="rounded-md border border-white/20 px-2 py-1 text-xs font-medium text-white/70 transition hover:bg-white/10 hover:text-white"
                  >
                    Switch here
                  </button>
                )}
              </h2>
              <div className="space-y-2">
                {playersOnTeam(team.id).map((p) => (
                  <div
                    key={p.id}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 ${
                      p.isLocal ? 'bg-yellow-400/10 ring-1 ring-yellow-300/40' : 'bg-white/5'
                    }`}
                  >
                    <PlayerAvatar name={p.name} color={p.avatarColor} connectionStatus={p.connectionStatus} size={36} />
                    <div className="flex-1">
                      <p className="text-sm font-semibold">
                        {p.name} {p.isLocal && <span className="text-yellow-300">(you)</span>}
                      </p>
                      <p className="text-[11px] text-white/50">Seat {p.seat + 1}</p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                        p.isReady ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-white/50'
                      }`}
                    >
                      {p.isReady ? 'Ready' : 'Not ready'}
                    </span>
                  </div>
                ))}
                {playersOnTeam(team.id).length === 0 && (
                  <p className="px-3 py-2 text-sm italic text-white/40">Empty</p>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={toggleReady}
            className={`w-full max-w-xs rounded-lg px-4 py-2.5 font-semibold transition ${
              localPlayer?.isReady
                ? 'border border-white/20 bg-white/10 text-white hover:bg-white/15'
                : 'bg-yellow-400 text-emerald-950 hover:bg-yellow-300'
            }`}
          >
            {localPlayer?.isReady ? 'Cancel Ready' : "I'm Ready"}
          </button>

          <button
            type="button"
            disabled={!allReady}
            onClick={startGame}
            className="w-full max-w-xs rounded-lg bg-emerald-500 px-4 py-2.5 font-semibold text-white shadow transition enabled:hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Start Game {allReady ? '' : `(${room.players.filter((p) => p.isReady).length}/4 ready)`}
          </button>
        </div>
      </div>
    </div>
  )
}
