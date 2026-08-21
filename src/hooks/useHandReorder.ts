import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { beginHandReorder, endHandReorder, freezeCardFlip, unfreezeCardFlip } from './useCardFlip'

/**
 * Local display-order for the player's hand. Never touches game rules.
 *
 * Desktop: live-swap on pointerenter (main). Cards stay in the fan; FLIP
 * slides neighbors. No follow-the-pointer, no freeze.
 *
 * Phone: the visual is `position: fixed` at `dragPoint` (viewport pixels)
 * so a squeezed fan cannot multiply the delta. The flex slot stays in the
 * row (explicit width/height) so the fan does not split. Insert by midpoint
 * X. Held-card FLIP is frozen; neighbors slide sideways in place.
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

/** Where to splice `dragId` among the other cards, given sorted midpoint Xs. */
export function insertIndexForPointer(clientX: number, sortedMids: number[]): number {
  for (let i = 0; i < sortedMids.length; i++) {
    if (clientX < sortedMids[i]) return i
  }
  return sortedMids.length
}

export function useHandReorder(cardIds: string[], opts?: { handheld?: boolean }) {
  const handheld = opts?.handheld === true
  const handheldRef = useRef(handheld)
  handheldRef.current = handheld

  const [order, setOrder] = useState<string[]>(cardIds)
  const orderRef = useRef(order)
  orderRef.current = order
  const draggingIdRef = useRef<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const originRef = useRef({ x: 0, y: 0 })
  const grabOffsetRef = useRef({ x: 0, y: 0 })
  const dragPointRef = useRef<DragPoint | null>(null)
  const [dragPoint, setDragPoint] = useState<DragPoint | null>(null)
  const movedRef = useRef(false)
  const suppressClickRef = useRef(false)
  const wasDraggingRef = useRef(false)

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

  useLayoutEffect(() => {
    if (!handheldRef.current) return
    if (draggingId) {
      wasDraggingRef.current = true
      return
    }
    if (wasDraggingRef.current) {
      wasDraggingRef.current = false
      endHandReorder()
    }
  }, [draggingId])

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

  function reorderByClientX(clientX: number) {
    const dragId = draggingIdRef.current
    if (!dragId) return
    const prev = orderRef.current
    const nodes = document.querySelectorAll('[data-hand-card-id]')
    const mids: number[] = []
    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) continue
      const id = node.getAttribute('data-hand-card-id')
      if (!id || id === dragId) continue
      const r = node.getBoundingClientRect()
      mids.push(r.left + r.width / 2)
    }
    mids.sort((a, b) => a - b)
    const insertAt = insertIndexForPointer(clientX, mids)
    const without = prev.filter((id) => id !== dragId)
    const next = [...without]
    next.splice(insertAt, 0, dragId)
    if (next.length === prev.length && next.every((id, i) => id === prev[i])) return
    setOrder(next)
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
    setDraggingId(id)
    movedRef.current = false
    if (handheldRef.current) {
      beginHandReorder()
      freezeCardFlip(id)
    }
    if (!event) {
      dragPointRef.current = null
      setDragPoint(null)
      return
    }
    originRef.current = { x: event.clientX, y: event.clientY }
    const el = event.currentTarget
    if (handheldRef.current) {
      const rect =
        el instanceof HTMLElement ? el.getBoundingClientRect() : { left: event.clientX, top: event.clientY }
      grabOffsetRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      const origin = { left: rect.left, top: rect.top }
      dragPointRef.current = origin
      setDragPoint(origin)
    }
    if (handheldRef.current && el instanceof HTMLElement && typeof el.setPointerCapture === 'function') {
      try {
        el.setPointerCapture(event.pointerId)
      } catch {
        /* setPointerCapture can throw if the pointer is already gone */
      }
    }
  }

  function handlePointerEnter(id: string) {
    if (handheldRef.current) return
    swapDraggedOver(id)
  }

  function endDrag() {
    const id = draggingIdRef.current
    if (movedRef.current) suppressClickRef.current = true
    draggingIdRef.current = null
    if (handheldRef.current && id) unfreezeCardFlip(id)
    dragPointRef.current = null
    setDraggingId(null)
    setDragPoint(null)
  }

  function consumeClickIfDragged(): boolean {
    if (!suppressClickRef.current) return false
    suppressClickRef.current = false
    return true
  }

  function applyOrder(nextIds: string[]) {
    const held = new Set(cardIds)
    const cleaned = nextIds.filter((id) => held.has(id))
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
      if (!handheldRef.current) return
      const dragId = draggingIdRef.current
      if (!dragId) return
      const dx = event.clientX - originRef.current.x
      const dy = event.clientY - originRef.current.y
      if (!movedRef.current && dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return
      movedRef.current = true
      suppressClickRef.current = true
      event.preventDefault()
      const nextPoint = pointerToDragPoint(event.clientX, event.clientY, grabOffsetRef.current)
      dragPointRef.current = nextPoint
      setDragPoint(nextPoint)
      reorderByClientX(event.clientX)
    }

    if (handheld) {
      window.addEventListener('pointermove', onMove, { passive: false })
    }
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', endDrag)
      window.removeEventListener('pointercancel', endDrag)
    }
  }, [draggingId, handheld])

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
