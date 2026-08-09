import { useLayoutEffect, useRef } from 'react'

/** A position in the scroll-stable / transform-stable coordinate space. */
interface FlipPosition {
  left: number
  top: number
}

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
const lastKnownRect = new Map<string, FlipPosition>()

// Distinctly visible motion: long enough to read as real travel from
// stock/discard to hand, short enough to not feel sluggish. Also used as
// the per-action pacing delay for mock/bot turns so their flights can
// finish before the next action starts.
export const FLIP_DURATION_MS = 380
const FLIP_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)' // ease-out

// Every container a card can fly into/out of (the hand row, the meld
// fans, the discard fan) scrolls or clips overflow for layout reasons (see
// their `overflow-x-auto`/`overflow-y-auto` classes) - a plain `transform`
// on the real, in-place element would get clipped for most of the flight
// and only "pop into view" for the last few pixels near its landing slot,
// which reads as no animation at all. So the actual flight is played on a
// throwaway visual clone ("ghost") positioned `fixed` on `<body>`, which is
// never inside any clipping/scrolling ancestor, while the real element is
// hidden for the duration. `z-index` is set far above anything else in the
// app so the flight is always drawn on top.
const GHOST_Z_INDEX = 2147483000

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
export function seedFlipOrigin(id: string, rect: DOMRect | FlipPosition): void {
  lastKnownRect.set(id, { left: rect.left, top: rect.top })
}

/**
 * Looks up a DOM element marked with `data-flip-anchor="<anchorId>"` and
 * returns its current viewport rect, or null if it isn't on screen yet.
 * Used by bot/mock turn pacing to seed flight origins/destinations for
 * seats that only render a MiniCardStack (not individual hand cards).
 */
export function getFlipAnchorRect(anchorId: string): DOMRect | null {
  if (typeof document === 'undefined') return null
  const el = document.querySelector(`[data-flip-anchor="${anchorId}"]`)
  if (!(el instanceof HTMLElement)) return null
  return el.getBoundingClientRect()
}

/** Convenience: seed a card's FLIP origin from a named flip-anchor element. */
export function seedFlipOriginFromAnchor(cardId: string, anchorId: string): boolean {
  const rect = getFlipAnchorRect(anchorId)
  if (!rect) return false
  seedFlipOrigin(cardId, rect)
  return true
}

/**
 * Plays a one-off card flight between two arbitrary viewport rects, without
 * requiring an `AnimatedCard` at either end. Used for bot/mock draws (where
 * the destination is only a MiniCardStack count, not a per-card element).
 *
 * Resolves when the flight finishes (or immediately if Web Animations API
 * isn't available).
 */
export function playDetachedCardFlight(opts: {
  from: DOMRect | FlipPosition
  to: DOMRect | FlipPosition
  faceDown?: boolean
  width?: number
  height?: number
}): Promise<void> {
  const width = opts.width ?? 56
  const height = opts.height ?? Math.round(width * 1.4)
  const fromLeft = opts.from.left
  const fromTop = opts.from.top
  const toLeft = opts.to.left
  const toTop = opts.to.top
  const dx = fromLeft - toLeft
  const dy = fromTop - toTop

  if (typeof document === 'undefined') return Promise.resolve()
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return Promise.resolve()

  const ghost = document.createElement('div')
  ghost.style.position = 'fixed'
  ghost.style.left = `${toLeft}px`
  ghost.style.top = `${toTop}px`
  ghost.style.width = `${width}px`
  ghost.style.height = `${height}px`
  ghost.style.margin = '0'
  ghost.style.zIndex = String(GHOST_Z_INDEX)
  ghost.style.pointerEvents = 'none'
  ghost.style.borderRadius = '8px'
  ghost.style.overflow = 'hidden'
  ghost.style.boxShadow = '0 8px 24px rgba(0,0,0,0.45)'
  // Lightweight face-down visual (matches Card back colors) so we don't need
  // to mount a React Card just for a bot draw flight.
  ghost.innerHTML = opts.faceDown !== false
    ? `<div style="width:100%;height:100%;background:#0f2a63;border:2px solid #93c5fd;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#93c5fd;font:700 14px/1 system-ui,sans-serif;">C</div>`
    : `<div style="width:100%;height:100%;background:#fff;border:1px solid #d4d4d8;border-radius:8px;"></div>`
  document.body.appendChild(ghost)

  if (typeof ghost.animate !== 'function') {
    ghost.remove()
    return Promise.resolve()
  }

  const arcLift = Math.min(36, Math.hypot(dx, dy) * 0.18)
  const anim = ghost.animate(
    [
      { transform: `translate(${dx}px, ${dy}px)` },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - arcLift}px)` },
      { transform: 'translate(0, 0)' },
    ],
    { duration: FLIP_DURATION_MS, easing: FLIP_EASING, fill: 'none' },
  )

  return new Promise((resolve) => {
    const cleanup = () => {
      ghost.remove()
      resolve()
    }
    anim.addEventListener('finish', cleanup)
    anim.addEventListener('cancel', cleanup)
  })
}

/**
 * A card's position measured in a coordinate space that stays stable across
 * pure scrolling of any ancestor - i.e. `getBoundingClientRect()`'s
 * viewport-relative position with every ancestor's current scroll offset
 * added back in.
 *
 * IMPORTANT: the measured node (and its ancestors) must NOT carry CSS
 * transforms used for hover/selection polish. Transforms on an ancestor of
 * the measured node change `getBoundingClientRect()` without a real move,
 * which used to make the discard pile "disappear" on hover whenever a
 * re-render landed mid-hover. Hover lifts live on an INNER child of
 * `AnimatedCard` instead (see that component's structure) so they never
 * affect this measurement. Same coordinate space as `seedFlipOrigin`
 * (viewport rects) so stock-draw seeding stays consistent.
 */
function getScrollStablePosition(node: HTMLElement): FlipPosition {
  const rect = node.getBoundingClientRect()
  let left = rect.left
  let top = rect.top
  let ancestor = node.parentElement
  while (ancestor) {
    left += ancestor.scrollLeft
    top += ancestor.scrollTop
    ancestor = ancestor.parentElement
  }
  return { left, top }
}

/**
 * Shared card-movement animation primitive.
 *
 * Attach the returned ref to the element you want to track by `id`. Any
 * time that element renders somewhere new on screen relative to where an
 * element with the same `id` last rendered - including a totally different
 * parent container - this plays a slide from the old position to the new
 * one with a slight upward arc and an ease-out finish.
 */
export function useCardFlip<T extends HTMLElement>(id: string) {
  const ref = useRef<T>(null)

  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return

    const prevPos = lastKnownRect.get(id)
    const nextPos = getScrollStablePosition(node)

    if (prevPos) {
      const dx = prevPos.left - nextPos.left
      const dy = prevPos.top - nextPos.top
      const moved = Math.abs(dx) > 1 || Math.abs(dy) > 1

      if (moved && typeof node.animate === 'function') {
        playFlightGhost(node, dx, dy)
      }
    }

    lastKnownRect.set(id, nextPos)
  })

  return ref
}

/**
 * Plays the actual FLIP flight on a fixed-position clone of `node` appended
 * to `document.body`. `node` itself is hidden for the duration and restored
 * the instant the ghost's flight finishes.
 */
function playFlightGhost(node: HTMLElement, dx: number, dy: number): void {
  const rect = node.getBoundingClientRect()
  const ghost = node.cloneNode(true) as HTMLElement
  ghost.style.position = 'fixed'
  ghost.style.left = `${rect.left}px`
  ghost.style.top = `${rect.top}px`
  ghost.style.width = `${rect.width}px`
  ghost.style.height = `${rect.height}px`
  ghost.style.margin = '0'
  ghost.style.zIndex = String(GHOST_Z_INDEX)
  ghost.style.pointerEvents = 'none'
  // Clear any inherited hover/selection transforms on the clone so the
  // flight itself isn't double-scaled / mid-lift.
  ghost.style.transform = 'none'
  document.body.appendChild(ghost)

  const originalVisibility = node.style.visibility
  node.style.visibility = 'hidden'

  const arcLift = Math.min(36, Math.hypot(dx, dy) * 0.18)
  const anim = ghost.animate(
    [
      { transform: `translate(${dx}px, ${dy}px)` },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - arcLift}px)` },
      { transform: 'translate(0, 0)' },
    ],
    { duration: FLIP_DURATION_MS, easing: FLIP_EASING, fill: 'none' },
  )

  const cleanup = () => {
    node.style.visibility = originalVisibility
    ghost.remove()
  }
  anim.addEventListener('finish', cleanup)
  anim.addEventListener('cancel', cleanup)
}
