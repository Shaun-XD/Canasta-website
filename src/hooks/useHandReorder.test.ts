import { describe, expect, it, afterEach, vi } from 'vitest'
import { act, cleanup, fireEvent, renderHook } from '@testing-library/react'
import { insertIndexForPointer, peekBandMidpoints, pointerToDragPoint, useHandReorder } from './useHandReorder'

afterEach(cleanup)

describe('handheld taps and drags', () => {
  it('keeps tap capture on the card button and does not swallow the first tap after a drag', () => {
    const { result } = renderHook(() => useHandReorder(['a', 'b'], { handheld: true, preserveTapTarget: true }))
    const wrapper = document.createElement('div')
    wrapper.setPointerCapture = vi.fn()
    const pointer = { clientX: 10, clientY: 10, pointerId: 1, currentTarget: wrapper }
    act(() => result.current.handlePointerDown('a', pointer))
    // Explicit wrapper capture retargets native touch clicks away from the
    // nested card button, so selecting a hand card never reaches its onClick.
    expect(wrapper.setPointerCapture).not.toHaveBeenCalled()
    fireEvent(window, new MouseEvent('pointermove', { clientX: 50, clientY: 10, cancelable: true }))
    expect(result.current.dragPoint).not.toBeNull()
    fireEvent.pointerUp(window)
    // A drag released outside a button may not generate a click at all.
    act(() => result.current.handlePointerDown('b', pointer))
    fireEvent.pointerUp(window)
    expect(result.current.consumeClickIfDragged()).toBe(false)
  })

  it('retains pointer capture for handheld layouts that do not opt in', () => {
    const { result } = renderHook(() => useHandReorder(['a'], { handheld: true }))
    const wrapper = document.createElement('div')
    wrapper.setPointerCapture = vi.fn()
    act(() => result.current.handlePointerDown('a', {
      clientX: 10, clientY: 10, pointerId: 1, currentTarget: wrapper,
    }))
    expect(wrapper.setPointerCapture).toHaveBeenCalledWith(1)
    fireEvent.pointerUp(window)
  })
})

describe('insertIndexForPointer', () => {
  it('inserts before the first midpoint to the right of the pointer', () => {
    expect(insertIndexForPointer(10, [20, 40, 60])).toBe(0)
    expect(insertIndexForPointer(30, [20, 40, 60])).toBe(1)
    expect(insertIndexForPointer(50, [20, 40, 60])).toBe(2)
    expect(insertIndexForPointer(70, [20, 40, 60])).toBe(3)
  })
})

describe('pointerToDragPoint', () => {
  it('keeps the grab offset under the pointer in viewport pixels', () => {
    expect(pointerToDragPoint(100, 50, { x: 10, y: 5 })).toEqual({ left: 90, top: 45 })
  })
})

describe('peekBandMidpoints', () => {
  it("uses each overlapped card's visible strip, not the buried full-face center", () => {
    const mids = peekBandMidpoints([
      { left: 0, width: 38 },
      { left: 14, width: 38 },
      { left: 28, width: 38 },
    ])
    expect(mids).toEqual([7, 21, 47])
    expect(insertIndexForPointer(10, mids)).toBe(1)
    expect(insertIndexForPointer(40, mids)).toBe(2)
    expect(insertIndexForPointer(50, mids)).toBe(3)
  })
})
