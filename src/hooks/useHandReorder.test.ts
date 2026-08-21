import { describe, expect, it } from 'vitest'
import { pointerToDragPoint, insertIndexForPointer } from './useHandReorder'

describe('pointerToDragPoint', () => {
  it('tracks the pointer in viewport pixels with no distance-from-center multiplier', () => {
    const grab = { x: 10, y: 12 }
    expect(pointerToDragPoint(30, 90, grab)).toEqual({ left: 20, top: 78 })
    // Far left / far right must stay client − grab, not a scaled fan delta.
    expect(pointerToDragPoint(8, 90, grab)).toEqual({ left: -2, top: 78 })
    expect(pointerToDragPoint(900, 90, grab)).toEqual({ left: 890, top: 78 })
  })
})

describe('insertIndexForPointer', () => {
  it('picks a stable slot from midpoint Xs instead of overlapped hit-tests', () => {
    const mids = [40, 80, 120, 160]
    expect(insertIndexForPointer(10, mids)).toBe(0)
    expect(insertIndexForPointer(79, mids)).toBe(1)
    expect(insertIndexForPointer(80, mids)).toBe(2)
    expect(insertIndexForPointer(200, mids)).toBe(4)
  })
})
