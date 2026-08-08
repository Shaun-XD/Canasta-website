import { Card } from './Card'

/** A compact face-down stack used to show an opponent's remaining card count. */
export function MiniCardStack({ count }: { count: number }) {
  const shown = Math.min(count, 4)
  return (
    <div className="relative flex items-center" style={{ width: 34 + shown * 4, height: 46 }}>
      {Array.from({ length: shown }).map((_, i) => (
        <div key={i} className="absolute" style={{ left: i * 4 }}>
          <Card faceDown width={30} />
        </div>
      ))}
      <span className="absolute -bottom-1 -right-1 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white">
        {count}
      </span>
    </div>
  )
}
