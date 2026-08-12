import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Lightweight, dependency-free drag-to-reorder for the player's own hand
 * (item 6). This is a purely local display-order preference - it never
 * touches game rules or the store's hand array, which stays sorted by rank
 * for everyone else's bookkeeping (AI, discard logic, etc).
 *
 * Implementation: plain pointer events, no drag/drop library. While a card
 * is held down, whichever other card the pointer moves over swaps places
 * with it in the local order (a common "live swap" reorder UX). Actual
 * card movement is animated by the existing FLIP `useCardFlip` hook, since
 * every card keeps rendering through `AnimatedCard` with the same `flipId`
 * regardless of its position in the row.
 *
 * Auto-arrange buttons call {@link applyOrder} with a new id sequence;
 * FLIP then flies each card into its new slot.
 */
export function useHandReorder(cardIds: string[]) {
  const [order, setOrder] = useState<string[]>(cardIds)
  const draggingIdRef = useRef<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)

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

  function handlePointerDown(id: string) {
    draggingIdRef.current = id
    setDraggingId(id)
  }

  function handlePointerEnter(id: string) {
    const dragId = draggingIdRef.current
    if (!dragId || dragId === id) return
    setOrder((prev) => {
      const from = prev.indexOf(dragId)
      const to = prev.indexOf(id)
      if (from === -1 || to === -1) return prev
      const next = [...prev]
      next.splice(from, 1)
      next.splice(to, 0, dragId)
      return next
    })
  }

  function endDrag() {
    draggingIdRef.current = null
    setDraggingId(null)
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
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
    return () => {
      window.removeEventListener('pointerup', endDrag)
      window.removeEventListener('pointercancel', endDrag)
    }
  }, [draggingId])

  return { order, draggingId, handlePointerDown, handlePointerEnter, applyOrder }
}
