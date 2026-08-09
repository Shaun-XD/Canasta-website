import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, render, cleanup } from '@testing-library/react'
import { useState } from 'react'
import { AnimatedCard } from '../components/AnimatedCard'
import { seedFlipOrigin } from './useCardFlip'
import { useHandReorder } from './useHandReorder'

/**
 * These tests stand in for the browser/screenshot verification this repo's
 * test setup doesn't have available: they render real DOM (jsdom) through
 * the actual `Table.tsx` combo of `useHandReorder` + `AnimatedCard` +
 * `useCardFlip`, mock `Element.prototype.animate` (the Web Animations API
 * call jsdom doesn't implement), and assert that a card newly appearing in
 * a hand whose origin was seeded (mimicking a stock draw) actually gets a
 * flight animation invoked - rather than just trusting the wiring by
 * reading the code.
 */

let animateSpy: ReturnType<typeof vi.fn>
let mockAnimation: { addEventListener: ReturnType<typeof vi.fn> }

function rectFrom(r: { top: number; left: number; width: number; height: number }): DOMRect {
  return {
    ...r,
    right: r.left + r.width,
    bottom: r.top + r.height,
    x: r.left,
    y: r.top,
    toJSON() {
      return this
    },
  } as DOMRect
}

beforeEach(() => {
  mockAnimation = { addEventListener: vi.fn() }
  animateSpy = vi.fn().mockReturnValue(mockAnimation)
  // jsdom doesn't implement the Web Animations API at all.
  ;(HTMLElement.prototype as unknown as { animate: typeof animateSpy }).animate = animateSpy
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** A minimal stand-in for the relevant slice of `Table.tsx`'s hand rendering. */
function HandHarness({ cardIds }: { cardIds: string[] }) {
  const { order } = useHandReorder(cardIds)
  return (
    <div>
      {order.map((id) => (
        <AnimatedCard key={id} flipId={id} rank="A" suit="hearts" />
      ))}
    </div>
  )
}

describe('stock draw -> hand FLIP animation', () => {
  it('plays a flight animation when a freshly-drawn card, seeded from the stock pile rect, mounts into the hand', async () => {
    const stockRect = new DOMRect(600, 40, 56, 78) // far from where the card lands in the hand
    const landingRect = { top: 500, left: 120, width: 68, height: 95 }
    // Every rendered card (old and new) lands at the same on-screen slot in
    // this harness (real layout doesn't run under jsdom); what matters is
    // that the newly-mounted card is compared against its *seeded* origin,
    // not against this landing rect.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rectFrom(landingRect))

    function App() {
      const [ids, setIds] = useState(['card-1', 'card-2'])
      // Mirrors Table.tsx's handleDrawFromStock: seed the drawn card's id
      // with the stock pile's rect BEFORE the id first appears in the hand.
      function draw() {
        seedFlipOrigin('card-new', stockRect)
        setIds((prev) => [...prev, 'card-new'])
      }
      return (
        <div>
          <button onClick={draw}>draw</button>
          <HandHarness cardIds={ids} />
        </div>
      )
    }

    const { getByText } = render(<App />)

    expect(animateSpy).not.toHaveBeenCalled()

    await act(async () => {
      getByText('draw').click()
    })

    expect(animateSpy).toHaveBeenCalledTimes(1)

    const [keyframes, options] = animateSpy.mock.calls[0] as [Keyframe[], KeyframeAnimationOptions]
    // dx/dy should reflect stockRect -> landingRect, not 0 (which would mean
    // the seeded origin was ignored, ids mismatched, or the coordinate
    // spaces cancelled out to no visible motion).
    const expectedDx = stockRect.left - landingRect.left
    const expectedDy = stockRect.top - landingRect.top
    expect(keyframes[0]).toEqual({ transform: `translate(${expectedDx}px, ${expectedDy}px)` })
    expect(keyframes[2]).toEqual({ transform: 'translate(0, 0)' })
    expect(Math.abs(expectedDx) + Math.abs(expectedDy)).toBeGreaterThan(50)
    expect(options).toMatchObject({ duration: 380 })

    // The flight must be played on a detached clone appended to <body>
    // (so it isn't clipped by the hand row's `overflow-x-auto` container),
    // not on the real in-hand element - otherwise most of the motion would
    // be invisible even though `animate` was technically called.
    expect(animateSpy.mock.instances[0]).not.toBe(document.body)
    expect(document.body.contains(animateSpy.mock.instances[0] as Node)).toBe(true)
  })

  it('does not treat a genuinely new card as moved when there is no seeded origin (no false-positive flights)', async () => {
    const landingRect = { top: 500, left: 120, width: 68, height: 95 }
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rectFrom(landingRect))

    function App() {
      const [ids, setIds] = useState(['card-1'])
      return (
        <div>
          <button onClick={() => setIds((prev) => [...prev, 'card-unseeded'])}>add</button>
          <HandHarness cardIds={ids} />
        </div>
      )
    }

    const { getByText } = render(<App />)
    await act(async () => {
      getByText('add').click()
    })

    expect(animateSpy).not.toHaveBeenCalled()
  })
})

describe('scroll-stability (regression: discard pile "disappearing" on click)', () => {
  it('does not play a flight animation for a card whose viewport position only shifted because a scrollable ancestor scrolled', async () => {
    const BASE_LEFT = 400

    // Mimics a real browser: a card's viewport-relative rect shifts left by
    // exactly however far its scrollable ancestor has been scrolled, even
    // though the card never moved relative to its siblings.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const scrollRow = this.closest('[data-testid="scroll-row"]') as HTMLElement | null
      const scrollLeft = scrollRow?.scrollLeft ?? 0
      return rectFrom({ top: 500, left: BASE_LEFT - scrollLeft, width: 56, height: 78 })
    })

    function Harness({ scrollLeft }: { scrollLeft: number }) {
      return (
        <div
          data-testid="scroll-row"
          // Inline ref callbacks re-run on every render, which is exactly
          // what's needed here to apply an updated scroll position without
          // remounting anything (mirroring the pile div's real scrollLeft
          // changing independently of React).
          ref={(node) => {
            if (node) node.scrollLeft = scrollLeft
          }}
        >
          <AnimatedCard flipId="scroll-stability-card" rank="A" suit="hearts" />
        </div>
      )
    }

    const { rerender } = render(<Harness scrollLeft={0} />)
    expect(animateSpy).not.toHaveBeenCalled()

    // Simulate the user scrolling the discard pile row (a pure DOM scroll,
    // no React re-render) and then some unrelated state change causing a
    // re-render (e.g. toggling a Top Touch selection) while still scrolled.
    await act(async () => {
      rerender(<Harness scrollLeft={80} />)
    })

    expect(animateSpy).not.toHaveBeenCalled()
  })

  it('still plays a flight animation for a genuine cross-container move even while an ancestor happens to be scrolled', async () => {
    const scrollLeft = 80
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const row = this.closest('[data-testid="scroll-row"]') as HTMLElement | null
      const inHand = this.closest('[data-testid="hand-slot"]') != null
      const left = inHand ? 900 - (row?.scrollLeft ?? 0) : 400 - (row?.scrollLeft ?? 0)
      return rectFrom({ top: 500, left, width: 56, height: 78 })
    })

    function Harness({ inHand }: { inHand: boolean }) {
      return (
        <div data-testid="scroll-row" ref={(node) => { if (node) node.scrollLeft = scrollLeft }}>
          <div data-testid={inHand ? 'hand-slot' : 'discard-slot'}>
            <AnimatedCard flipId="scroll-stability-cross-container-card" rank="K" suit="spades" />
          </div>
        </div>
      )
    }

    const { rerender } = render(<Harness inHand={false} />)
    expect(animateSpy).not.toHaveBeenCalled()

    await act(async () => {
      rerender(<Harness inHand />)
    })

    expect(animateSpy).toHaveBeenCalledTimes(1)
  })
})

describe('transform-stability (regression: discard pile disappearing on hover)', () => {
  it('does not play a flight when the measured node\'s viewport rect is unchanged across a re-render (hover lifts live on an inner child, so the measured box stays put)', async () => {
    // Contract locked in by AnimatedCard's outer/inner split + DiscardPileView
    // putting group-hover transforms on wrapperClassName (inner) only: the
    // FLIP-measured outer node's getBoundingClientRect must not change just
    // because a hover polish transform is applied somewhere underneath it.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
      rectFrom({ top: 200, left: 300, width: 56, height: 78 }),
    )

    function Harness({ tick }: { tick: number }) {
      return (
        <AnimatedCard
          flipId="hover-stability-card"
          rank="9"
          suit="spades"
          wrapperClassName={tick > 0 ? 'scale-[1.18] -translate-y-2' : ''}
        />
      )
    }

    const { rerender } = render(<Harness tick={0} />)
    expect(animateSpy).not.toHaveBeenCalled()

    await act(async () => {
      rerender(<Harness tick={1} />)
    })

    expect(animateSpy).not.toHaveBeenCalled()
  })
})
