import { describe, expect, it } from 'vitest'
import { detachedFlightWidth } from './useCardFlip'

describe('detachedFlightWidth', () => {
  it('uses 72px when the runtime is not a handheld device', () => {
    const from = { left: 0, top: 0, width: 33, height: 46 }
    const to = { left: 100, top: 20, width: 80, height: 40 }
    expect(detachedFlightWidth(from, to)).toBe(72)
  })
})
