import { useLayoutEffect, useRef } from 'react'

/**
 * Module-level, cross-component registry of the last known screen position
 * for every animatable element, keyed by a stable id (typically a card's
 * `CardModel.id`, which stays the same as it moves from a hand into a meld
 * or onto the discard pile).
 *
 * This lives outside React state on purpose: the whole point of the FLIP
 * ("First, Last, Invert, Play") technique is to compare a DOM node's
 * position across renders/parents without triggering extra re-renders.
 */
const lastKnownRect = new Map<string, DOMRect>()

// Distinctly visible motion (per item 3): long enough to read as real
// travel from stock/discard to hand, short enough to not feel sluggish.
const FLIP_DURATION_MS = 380
const FLIP_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)' // ease-out

/**
 * Manually seeds the "last known position" for `id` (e.g. the stock pile's
 * on-screen rect) BEFORE that id's `AnimatedCard` first mounts elsewhere.
 *
 * This is needed for stock draws specifically: the stock is rendered as a
 * single generic face-down `Card`, not as a per-card `AnimatedCard` with a
 * stable id, so there is normally no recorded rect for a freshly-drawn
 * card's id to animate FROM - it would just pop into the hand instantly.
 * Callers (see `Table.tsx`'s draw handler) capture the stock pile's rect at
 * click time and seed it here for the drawn card's id, so the very next
 * render of that id (now inside the hand) picks it up as `prevRect` and
 * flies from the stock position into its landing slot.
 */
export function seedFlipOrigin(id: string, rect: DOMRect): void {
  lastKnownRect.set(id, rect)
}

/**
 * Shared card-movement animation primitive (item 1 in the animation spec).
 *
 * Attach the returned ref to the element you want to track by `id`. Any
 * time that element renders somewhere new on screen relative to where an
 * element with the same `id` last rendered - including a totally different
 * parent container, e.g. a card leaving the hand row and reappearing inside
 * a `MeldArea` or the discard pile - this animates a slide from the old
 * position to the new one with a slight upward arc and an ease-out finish,
 * instead of the card silently teleporting.
 *
 * Used by BOTH the "hand -> meld" and "hand -> discard pile" transitions
 * (see `AnimatedCard`), so there is exactly one animation implementation to
 * maintain rather than two bespoke ones.
 */
export function useCardFlip<T extends HTMLElement>(id: string) {
  const ref = useRef<T>(null)

  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return

    const prevRect = lastKnownRect.get(id)
    const nextRect = node.getBoundingClientRect()

    if (prevRect) {
      const dx = prevRect.left - nextRect.left
      const dy = prevRect.top - nextRect.top
      const moved = Math.abs(dx) > 1 || Math.abs(dy) > 1

      if (moved && typeof node.animate === 'function') {
        // Bow the midpoint slightly upward so long hops (e.g. hand -> far
        // meld area) read as a gentle arc/toss rather than a straight slide.
        const arcLift = Math.min(36, Math.hypot(dx, dy) * 0.18)
        const anim = node.animate(
          [
            { transform: `translate(${dx}px, ${dy}px)` },
            { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - arcLift}px)` },
            { transform: 'translate(0, 0)' },
          ],
          { duration: FLIP_DURATION_MS, easing: FLIP_EASING, fill: 'none' },
        )
        anim.addEventListener('finish', () => anim.cancel())
      }
    }

    lastKnownRect.set(id, nextRect)
  })

  return ref
}
