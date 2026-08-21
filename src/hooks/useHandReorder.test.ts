import { describe, expect, it } from 'vitest'
import { pointerToDragPoint } from './useHandReorder'

describe('pointerToDragPoint', () => {
  it('tracks the pointer in viewport pixels with no distance-from-center multiplier', () => {
    const grab = { x: 10, y: 12 }
    expect(pointerToDragPoint(30, 90, grab)).toEqual({ left: 20, top: 78 })
    // Far left / far right must stay client − grab, not a scaled fan delta.
    expect(pointerToDragPoint(8, 90, grab)).toEqual({ left: -2, top: 78 })
    expect(pointerToDragPoint(900, 90, grab)).toEqual({ left: 890, top: 78 })
  })
})
