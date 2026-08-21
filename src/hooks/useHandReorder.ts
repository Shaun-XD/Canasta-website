import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { beginHandReorder, endHandReorder, freezeCardFlip, unfreezeCardFlip } from './useCardFlip'

/**
 * Lightweight, dependency-free drag-to-reorder for the player's own hand
 * (item 6). Cards stay in the fan (no follow-the-pointer translate). Slot
 * changes use midpoint X so overlapped faces don't flip-flop. The held
 * card's FLIP is frozen so hide+arc ghosts cannot vibrate it; neighbors
 * slide sideways in place.
 *
 * A tap that never crosses the drag threshold still counts as a click
 * (select); a real drag swallows the following click.
 */

const DRAG_THRESHOLD_PX = 8

export function insertIndexForPointer(clientX: number, sortedMids: number[]): number {
  for (let i = 0; i < sortedMids.length; i++) {
    if (clientX < sortedMids[i]) return i
  }
  return sortedMids.length
}

export function useHandReorder(cardIds: string[]) {
  const [order, setOrder] = useState<string[]>(cardIds)
  const orderRef = useRef(order)
  orderRef.current = order
  const draggingIdRef = useRef<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const originRef = useRef({ x: 0, y: 0 })
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
    if (draggingId) {
      wasDraggingRef.current = true
      return
    }
    if (wasDraggingRef.current) {
      wasDraggingRef.current = false
      endHandReorder()
    }
  }, [draggingId])

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
    beginHandReorder()
    freezeCardFlip(id)
    setDraggingId(id)
    movedRef.current = false
    if (event) {
      originRef.current = { x: event.clientX, y: event.clientY }
      const el = event.currentTarget
      if (el instanceof HTMLElement && typeof el.setPointerCapture === 'function') {
        try {
          el.setPointerCapture(event.pointerId)
        } catch {
          /* setPointerCapture can throw if the pointer is already gone */
        }
      }
    }
  }

  function endDrag() {
    const id = draggingIdRef.current
    if (movedRef.current) suppressClickRef.current = true
    draggingIdRef.current = null
    if (id) unfreezeCardFlip(id)
    setDraggingId(null)
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
      const dragId = draggingIdRef.current
      if (!dragId) return
      const dx = event.clientX - originRef.current.x
      const dy = event.clientY - originRef.current.y
      if (!movedRef.current && dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return
      movedRef.current = true
      suppressClickRef.current = true
      reorderByClientX(event.clientX)
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
    handlePointerDown,
    applyOrder,
    consumeClickIfDragged,
  }
}
