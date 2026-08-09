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
  wrapperClassName?: string
}

/**
 * Thin wrapper around `Card` that opts it into the shared FLIP move
 * animation (hand -> meld area, hand -> discard pile) and the optional
 * "newly acquired" glow highlight. This is the single reusable animation
 * component referenced by items 1 and 8 of the animation spec - every place
 * a card can move between containers renders it through here instead of a
 * bare `Card`.
 */
export function AnimatedCard({ flipId, isNew = false, style, wrapperClassName = '', ...cardProps }: AnimatedCardProps) {
  const ref = useCardFlip<HTMLDivElement>(flipId)
  return (
    <div
      ref={ref}
      style={style}
      className={`inline-block rounded-[8px] ${isNew ? 'animate-card-glow' : ''} ${wrapperClassName}`}
    >
      <Card {...cardProps} />
    </div>
  )
}
