import { describe, expect, it } from 'vitest'
import { insertIndexForPointer, pointerToDragPoint } from './useHandReorder'

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
