import { describe, expect, it } from 'vitest'
import { insertIndexForPointer, peekBandMidpoints, pointerToDragPoint } from './useHandReorder'

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
