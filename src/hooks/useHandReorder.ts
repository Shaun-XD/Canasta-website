import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { freezeCardFlip, unfreezeCardFlip } from './useCardFlip'

/**
 * Lightweight, dependency-free drag-to-reorder for the player's own hand
 * (item 6). This is a purely local display-order preference - it never
 * touches game rules or the store's hand array, which stays sorted by rank
 * for everyone else's bookkeeping (AI, discard logic, etc).
 *
 * Pointer model: the held card is `position: fixed` at `dragPoint`
 * (`client − grab offset`, viewport pixels). Slot swaps must not feed a
 * layout `translate()`, or a squeezed phone fan / FLIP ancestor multiplies
 * the delta and the card runs away from the finger. Touch devices never
 * fire `pointerenter` while a finger is down, so reorder also hit-tests
 * `elementsFromPoint` on `pointermove`. A tap that never crosses the drag
 * threshold still counts as a click (select); a real drag swallows the
 * following click.
 *
 * Auto-arrange buttons call {@link applyOrder} with a new id sequence;
 * FLIP then flies each card into its new slot.
 */

const DRAG_THRESHOLD_PX = 8

export type DragPoint = { left: number; top: number }

/** Viewport top-left of the card so the grab point stays under the pointer. */
export function pointerToDragPoint(
  clientX: number,
  clientY: number,
  grabOffset: { x: number; y: number },
): DragPoint {
  return { left: clientX - grabOffset.x, top: clientY - grabOffset.y }
}

function cardIdAtPoint(x: number, y: number, skipId: string): string | null {
  if (typeof document === 'undefined' || typeof document.elementsFromPoint !== 'function') {
    return null
  }
  const stack = document.elementsFromPoint(x, y)
  for (const node of stack) {
    const host = node instanceof Element ? node.closest('[data-hand-card-id]') : null
    const id = host?.getAttribute('data-hand-card-id')
    if (id && id !== skipId) return id
  }
  return null
}

export function useHandReorder(cardIds: string[]) {
  const [order, setOrder] = useState<string[]>(cardIds)
  const draggingIdRef = useRef<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const grabOffsetRef = useRef({ x: 0, y: 0 })
  const originClientRef = useRef({ x: 0, y: 0 })
  const [dragPoint, setDragPoint] = useState<DragPoint | null>(null)
  const movedRef = useRef(false)
  const suppressClickRef = useRef(false)

  // Reconcile the local order with the authoritative hand whenever cards are
  // added (drawn/picked up) or removed (melded/discarded), while preserving
  // whatever manual arrangement the player has made of the cards that remain.
  //
  // This must be a `useLayoutEffect`, not `useEffect`: a plain `useEffect`
  // runs (and its `setOrder` commits) only after the browser has already
  // painted the render that's missing the newly-drawn card, so the card's
  // `AnimatedCard` doesn't actually mount - and therefore doesn't seed/play
  // its FLIP-in animation - until a second, later paint. Reconciling
  // synchronously in a layout effect instead means the new card mounts (and
  // its flight plays) in the very same commit as the store update that
  // added it, with nothing skipped in between.
  useLayoutEffect(() => {
    setOrder((prev) => {
      const stillHeld = prev.filter((id) => cardIds.includes(id))
      const newlyAdded = cardIds.filter((id) => !stillHeld.includes(id))
      const next = [...stillHeld, ...newlyAdded]
      const same = next.length === prev.length && next.every((id, i) => id === prev[i])
      return same ? prev : next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardIds.join('|')])

  function swapDraggedOver(overId: string) {
    const dragId = draggingIdRef.current
    if (!dragId || dragId === overId) return
    setOrder((prev) => {
      const from = prev.indexOf(dragId)
      const to = prev.indexOf(overId)
      if (from === -1 || to === -1) return prev
      const next = [...prev]
      next.splice(from, 1)
      next.splice(to, 0, dragId)
      return next
    })
  }

  function handlePointerDown(
    id: string,
    event?: {
      clientX: number
      clientY: number
      pointerId: number
      currentTarget: EventTarget | null
    },
  ) {
    draggingIdRef.current = id
    freezeCardFlip(id)
    setDraggingId(id)
    movedRef.current = false
    if (!event) {
      setDragPoint(null)
      return
    }
    const el = event.currentTarget
    const rect =
      el instanceof HTMLElement ? el.getBoundingClientRect() : { left: event.clientX, top: event.clientY }
    grabOffsetRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    originClientRef.current = { x: event.clientX, y: event.clientY }
    setDragPoint({ left: rect.left, top: rect.top })
    if (el instanceof HTMLElement && typeof el.setPointerCapture === 'function') {
      try {
        el.setPointerCapture(event.pointerId)
      } catch {
        /* setPointerCapture can throw if the pointer is already gone */
      }
    }
  }

  function handlePointerEnter(id: string) {
    if (!draggingIdRef.current) return
    swapDraggedOver(id)
  }

  function endDrag() {
    const id = draggingIdRef.current
    if (movedRef.current) suppressClickRef.current = true
    draggingIdRef.current = null
    if (id) unfreezeCardFlip(id)
    setDraggingId(null)
    setDragPoint(null)
  }

  /** True when the pointerup click belongs to a drag, not a tap-to-select. */
  function consumeClickIfDragged(): boolean {
    if (!suppressClickRef.current) return false
    suppressClickRef.current = false
    return true
  }

  /** Replace display order (e.g. suit / rank auto-sort). FLIP animates the move. */
  function applyOrder(nextIds: string[]) {
    const held = new Set(cardIds)
    const cleaned = nextIds.filter((id) => held.has(id))
    // Append any missing ids (shouldn't happen) to stay in sync with the hand.
    for (const id of cardIds) {
      if (!cleaned.includes(id)) cleaned.push(id)
    }
    setOrder((prev) => {
      const same = cleaned.length === prev.length && cleaned.every((id, i) => id === prev[i])
      return same ? prev : cleaned
    })
  }

  useEffect(() => {
    if (draggingId == null) return

    function onMove(event: PointerEvent) {
      const dragId = draggingIdRef.current
      if (!dragId) return
      const dx = event.clientX - originClientRef.current.x
      const dy = event.clientY - originClientRef.current.y
      if (!movedRef.current && dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return
      movedRef.current = true
      suppressClickRef.current = true
      setDragPoint(
        pointerToDragPoint(event.clientX, event.clientY, grabOffsetRef.current),
      )
      const overId = cardIdAtPoint(event.clientX, event.clientY, dragId)
      if (overId) swapDraggedOver(overId)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', endDrag)
      window.removeEventListener('pointercancel', endDrag)
    }
  }, [draggingId])

  return {
    order,
    draggingId,
    dragPoint,
    handlePointerDown,
    handlePointerEnter,
    applyOrder,
    consumeClickIfDragged,
  }
}
