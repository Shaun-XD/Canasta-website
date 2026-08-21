import type { ConnectionStatus } from '../types/game'

function initials(name: string): string {
  return name
    .replace(/\(.*?\)/g, ' ')
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}

const STATUS_COLOR: Record<ConnectionStatus, string> = {
  connected: 'bg-emerald-400',
  connecting: 'bg-amber-400',
  disconnected: 'bg-red-500',
}

export function PlayerAvatar({
  name,
  color,
  connectionStatus,
  size = 44,
}: {
  name: string
  color: string
  connectionStatus: ConnectionStatus
  size?: number
}) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className="flex items-center justify-center rounded-full font-semibold text-white shadow-inner ring-2 ring-white/20"
        style={{ width: size, height: size, backgroundColor: color, fontSize: size * 0.36 }}
      >
        {initials(name)}
      </div>
      <span
        className={`absolute -bottom-0.5 -right-0.5 block rounded-full ring-2 ring-emerald-950 ${STATUS_COLOR[connectionStatus]}`}
        style={{ width: size * 0.28, height: size * 0.28 }}
        title={connectionStatus}
      />
    </div>
  )
}
