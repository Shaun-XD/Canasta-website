import type { CSSProperties } from 'react'
import { useCardFlip } from '../hooks/useCardFlip'
import { Card, type CardProps } from './Card'

export interface AnimatedCardProps extends CardProps {
  /**
   * Stable identity used to track this card's position across renders and
   * parent containers (see `useCardFlip`). Should be the card's `id`.
   */
  flipId: string
  /**
   * True for ~2s right after this card was drawn from stock or picked up
   * from the discard pile, to trigger the temporary glow highlight (item 8).
   * Uses a shared CSS keyframe so it plays once and fades on its own.
   */
  isNew?: boolean
  style?: CSSProperties
  /**
   * Classes applied to the INNER visual wrapper (NOT the FLIP-measured outer
   * node). Put hover-lift / scale transforms here so they never affect the
   * layout-stable position `useCardFlip` tracks - otherwise a hover
   * transform on an ancestor of the measured node makes every re-render
   * look like the card "moved" and the discard pile disappears mid-hover.
   */
  wrapperClassName?: string
}

/**
 * Thin wrapper around `Card` that opts it into the shared FLIP move
 * animation and the optional "newly acquired" glow highlight.
 *
 * Structure (important for the hover/transform bug class):
 *   outer div  ← measured by useCardFlip; NEVER has CSS transforms
 *     inner div ← visual transforms / glow / hover scale live here
 *       Card
 */
export function AnimatedCard({ flipId, isNew = false, style, wrapperClassName = '', ...cardProps }: AnimatedCardProps) {
  const ref = useCardFlip<HTMLDivElement>(flipId)
  return (
    <div ref={ref} style={style} className="inline-block">
      <div className={`rounded-[8px] ${isNew ? 'animate-card-glow' : ''} ${wrapperClassName}`}>
        <Card {...cardProps} />
      </div>
    </div>
  )
}
