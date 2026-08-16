import { describe, expect, it } from 'vitest'
import { planHandFan, scaledHandCardWidth } from './tableLayout'

/** Typical CSS widths we must fit without forcing a laptop-sized hand. */
const VIEWPORTS = {
  se: 320,
  foldCover: 344,
  iphone14: 390,
  proMax: 430,
  foldInner: 690,
  landscapeShort: 844,
} as const

describe('phone-fit hand fan (handheld layout only)', () => {
  it('scales card width down on narrow rails and caps at 78 on wide ones', () => {
    expect(scaledHandCardWidth(VIEWPORTS.se)).toBeLessThan(70)
    expect(scaledHandCardWidth(VIEWPORTS.se)).toBeGreaterThanOrEqual(52)
    expect(scaledHandCardWidth(VIEWPORTS.proMax)).toBeLessThanOrEqual(78)
    expect(scaledHandCardWidth(1200)).toBe(78)
  })

  it.each(Object.entries(VIEWPORTS))(
    'keeps a 13-card fan within %s width or enables swipe instead of page overflow',
    (_name, width) => {
      const card = scaledHandCardWidth(width)
      const fan = planHandFan(13, width, card)
      if (fan.swipe) {
        expect(fan.peek).toBeGreaterThanOrEqual(14)
        expect(fan.fanWidth).toBeGreaterThan(width)
      } else {
        expect(fan.fanWidth).toBeLessThanOrEqual(width + 0.5)
        expect(fan.peek).toBeGreaterThanOrEqual(12)
      }
    },
  )

  it('does not force the old 654px laptop floor on an iPhone-sized rail', () => {
    const width = VIEWPORTS.iphone14
    const card = scaledHandCardWidth(width)
    const fan = planHandFan(13, width, card)
    expect(fan.swipe || fan.fanWidth <= width).toBe(true)
    expect(Math.min(fan.fanWidth, width)).toBeLessThan(500)
  })

  it('keeps landscape-phone cards short so the meld row can grow', () => {
    expect(scaledHandCardWidth(VIEWPORTS.landscapeShort, 390)).toBeLessThanOrEqual(38)
    expect(scaledHandCardWidth(VIEWPORTS.landscapeShort, 390)).toBeGreaterThanOrEqual(32)
    expect(scaledHandCardWidth(1200, 800)).toBe(78)
  })
})
