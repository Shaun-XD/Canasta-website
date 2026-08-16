import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useGameStore } from '../store/gameStore'
import { PlayerAvatar } from '../components/PlayerAvatar'
import type { MaxPlayers, TeamId } from '../types/game'
import { DEFAULT_TURN_TIMER_SECONDS, normalizeMaxPlayers, seatsPerTeam } from '../types/game'
import { useIsHandheld } from '../lib/device'

export function Lobby() {
  const handheld = useIsHandheld()
  const { roomId } = useParams()
  const navigate = useNavigate()
  const room = useGameStore((s) => s.room)
  const localPlayerId = useGameStore((s) => s.localPlayerId)
  const playMode = useGameStore((s) => s.playMode)
  const lastActionError = useGameStore((s) => s.lastActionError)
  const {
    toggleReady,
    setLocalTeam,
    startGame,
    setTurnTimerSeconds,
    setMaxPlayers,
    fillBots,
    removeBots,
    exitToHome,
    rejoinOnlineSession,
  } = useGameStore((s) => s.actions)

  const [sessionCheck, setSessionCheck] = useState<'pending' | 'done'>('pending')

  // After refresh / mobile sleep, Zustand is empty but localStorage still has
  // roomId+playerId — rejoin so Ready/Start work again (CLIENTS rebind).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await rejoinOnlineSession()
      if (!cancelled) setSessionCheck('done')
    })()
    return () => {
      cancelled = true
    }
    // Intentionally once per lobby room visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])

  useEffect(() => {
    if (room?.status === 'in-progress' && room.roomId === roomId) {
      navigate(`/game/${roomId}`)
    }
  }, [room?.status, room?.roomId, roomId, navigate])

  if (sessionCheck === 'pending') {
    return (
      <div
        className={
          handheld
            ? 'felt-bg page-scroll flex items-center justify-center text-white/70'
            : 'felt-bg flex min-h-screen items-center justify-center text-white/70'
        }
      >
        Reconnecting to lobby…
      </div>
    )
  }

  if (!room || room.roomId !== roomId) {
    return <Navigate to="/" replace />
  }

  const capacity = normalizeMaxPlayers(room.maxPlayers)
  const perTeam = seatsPerTeam(capacity)
  const localPlayer = room.players.find((p) => p.id === localPlayerId)
  const teamACount = room.players.filter((p) => p.teamId === 'team-a').length
  const teamBCount = room.players.filter((p) => p.teamId === 'team-b').length
  const teamsBalanced = teamACount === perTeam && teamBCount === perTeam
  const allReady = room.players.length >= capacity && room.players.every((p) => p.isReady)
  const canStart = allReady && teamsBalanced
  const isHost = localPlayer?.id === room.hostPlayerId
  const humans = room.players.filter((p) => !p.isMock).length
  const botCount = room.players.filter((p) => p.isMock).length
  const openSeats = Math.max(0, capacity - room.players.length)
  const noTimer = room.turnTimerSeconds === 0
  const readyCount = room.players.filter((p) => p.isReady).length

  function playersOnTeam(teamId: TeamId) {
    return room!.players.filter((p) => p.teamId === teamId).sort((a, b) => a.seat - b.seat)
  }

  function handleExit() {
    exitToHome()
    navigate('/', { replace: true })
  }

  function handleMaxPlayers(next: MaxPlayers) {
    setMaxPlayers(next)
  }

  return (
    <div
      className={
        handheld
          ? 'felt-bg page-scroll px-4 py-6 text-white'
          : 'felt-bg min-h-screen px-4 py-10 text-white'
      }
    >
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex justify-start">
          <button
            type="button"
            onClick={handleExit}
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-sm font-semibold text-white/70 transition hover:border-red-400/40 hover:bg-red-500/20 hover:text-white"
          >
            ← Exit to home
          </button>
        </div>

        <div className="mb-6 flex flex-col items-center gap-2 text-center sm:mb-8">
          <span className="text-xs font-semibold uppercase tracking-widest text-white/50">
            Room Code — share with friends
          </span>
          <div className="rounded-xl border border-white/15 bg-black/30 px-4 py-2.5 text-2xl font-black tracking-[0.18em] text-yellow-300 shadow-lg sm:px-6 sm:py-3 sm:text-3xl sm:tracking-[0.3em]">
            {room.roomId}
          </div>
          <span className="text-xs font-medium text-white/50">
            Match target score: <span className="text-white/80">{room.matchTargetScore}</span>
          </span>

          <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-xs font-medium text-white/50">
            <span>Players:</span>
            {isHost ? (
              <div className="flex rounded-md bg-white/5 p-0.5">
                <button
                  type="button"
                  onClick={() => handleMaxPlayers(2)}
                  className={`rounded px-2.5 py-1 text-[11px] font-semibold transition ${
                    capacity === 2
                      ? 'bg-yellow-400 text-emerald-950'
                      : 'text-white/70 hover:text-white'
                  }`}
                >
                  2 (1v1)
                </button>
                <button
                  type="button"
                  onClick={() => handleMaxPlayers(4)}
                  className={`rounded px-2.5 py-1 text-[11px] font-semibold transition ${
                    capacity === 4
                      ? 'bg-yellow-400 text-emerald-950'
                      : 'text-white/70 hover:text-white'
                  }`}
                >
                  4 (2v2)
                </button>
              </div>
            ) : (
              <span className="text-white/80">
                {capacity === 2 ? '2-player (1v1)' : '4-player (2v2)'}
              </span>
            )}
            {openSeats > 0 && (
              <button
                type="button"
                onClick={fillBots}
                className="rounded-md border border-yellow-300/50 bg-yellow-400/15 px-2.5 py-1 text-[11px] font-semibold text-yellow-100 transition hover:bg-yellow-400/25"
              >
                Fill bots ({openSeats})
              </button>
            )}
            {botCount > 0 && (
              <button
                type="button"
                onClick={removeBots}
                className="rounded-md border border-white/20 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-white/70 transition hover:bg-white/10 hover:text-white"
              >
                Remove bots
              </button>
            )}
          </div>
          {openSeats > 0 && (
            <p className="max-w-md text-[11px] text-white/40">
              Fill empty seats with bots. You can still use “Switch here” onto a bot’s team — the
              bot takes your old seat.
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-xs font-medium text-white/50">
            <span>Turn timer:</span>
            {isHost ? (
              <>
                <input
                  type="number"
                  min={10}
                  step={5}
                  disabled={noTimer}
                  value={noTimer ? DEFAULT_TURN_TIMER_SECONDS : room.turnTimerSeconds}
                  onChange={(e) => setTurnTimerSeconds(Number(e.target.value))}
                  className="w-20 rounded-md border border-white/15 bg-white/10 px-2 py-1 text-center text-white outline-none focus:border-yellow-300 focus:ring-1 focus:ring-yellow-300 disabled:opacity-40"
                />
                <span>seconds</span>
                <button
                  type="button"
                  onClick={() => setTurnTimerSeconds(noTimer ? DEFAULT_TURN_TIMER_SECONDS : 0)}
                  className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition ${
                    noTimer
                      ? 'border-yellow-300/60 bg-yellow-400/20 text-yellow-200'
                      : 'border-white/20 bg-white/5 text-white/70 hover:bg-white/10'
                  }`}
                >
                  No timer
                </button>
              </>
            ) : (
              <span className="text-white/80">{noTimer ? 'Off (no timer)' : `${room.turnTimerSeconds}s per turn`}</span>
            )}
          </div>
          {noTimer && (
            <p className="text-[11px] text-white/40">No countdown — turns never auto-skip.</p>
          )}
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
                        {p.isMock && (
                          <span className="ml-1 text-[10px] font-medium text-sky-300/80">bot</span>
                        )}
                        {p.id === room.hostPlayerId && (
                          <span className="ml-1 text-[10px] font-medium text-white/40">host</span>
                        )}
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

        {!teamsBalanced && room.players.length >= capacity && (
          <p className="mt-4 text-center text-sm text-amber-200/90">
            {capacity === 2
              ? `Need one player on each team (currently ${teamACount}–${teamBCount}). Use “Switch here”.`
              : `Teams must be 2v2 to start (currently ${teamACount}–${teamBCount}). Use “Switch here”.`}
          </p>
        )}

        {lastActionError && (
          <p className="mt-4 rounded-lg border border-red-400/30 bg-red-500/15 px-3 py-2 text-center text-sm text-red-200">
            {lastActionError}
          </p>
        )}

        <div className="mt-6 flex flex-col items-center gap-3 pb-4 sm:mt-8">
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
            disabled={!canStart || (playMode === 'online' && !isHost)}
            onClick={startGame}
            className="w-full max-w-xs rounded-lg bg-emerald-500 px-4 py-2.5 font-semibold text-white shadow transition enabled:hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {playMode === 'online' && !isHost
              ? 'Waiting for host to start…'
              : `Start Game ${canStart ? '' : `(${readyCount}/${capacity} ready)`}`}
          </button>
          {playMode === 'online' && (
            <p className="text-center text-xs text-white/45">
              Online lobby · {humans}/{capacity} humans
              {botCount > 0 ? ` · ${botCount} bot${botCount === 1 ? '' : 's'}` : ''} ·{' '}
              {capacity === 2 ? '1v1' : '2v2'} · share code{' '}
              <span className="font-semibold text-yellow-300/90">{room.roomId}</span>
              {!isHost && localPlayer && (
                <>
                  {' '}
                  · only the <span className="text-white/70">host</span> can press Start
                </>
              )}
            </p>
          )}
          {playMode === 'solo' && (
            <p className="text-center text-xs text-white/45">
              Solo lobby · {capacity === 2 ? '1v1 vs bot' : '2v2 with bots'} ({room.players.length}/
              {capacity} seats)
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
