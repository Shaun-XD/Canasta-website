import { describe, expect, it, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { DiscardPileView } from './DiscardPileView'
import { c } from '../engine/testHelpers'

/**
 * Regression coverage for the two symptoms in the "discard pile
 * disappears/glitches on click" bug report:
 *
 * 1. Clicking a card during an in-progress Top Touch must only toggle its
 *    selection - every other card must stay rendered (nothing "collapses").
 * 2. A drag/scroll gesture through the pile (pointer moves past the click
 *    threshold before release) must NOT be misread as a card selection.
 */
describe('DiscardPileView - Top Touch selection clicks', () => {
  afterEach(() => cleanup())

  it('toggling a card only changes selection - every card in the pile stays rendered', () => {
    const cards = [c('3', 'hearts'), c('4', 'hearts'), c('5', 'hearts')]
    const onToggleDiscardCard = vi.fn()

    const { container, rerender } = render(
      <DiscardPileView
        cards={cards}
        topTouchInProgress
        selectedDiscardCount={1}
        onToggleDiscardCard={onToggleDiscardCard}
      />,
    )

    const cardButtons = container.querySelectorAll('[role="button"]')
    expect(cardButtons.length).toBe(3)

    fireEvent.click(cardButtons[1])
    expect(onToggleDiscardCard).toHaveBeenCalledWith(cards[1].id)

    // Simulate the store applying the resulting selection change - the rest
    // of the pile must still be there, not collapsed to a near-empty state.
    rerender(
      <DiscardPileView
        cards={cards}
        topTouchInProgress
        selectedDiscardCount={2}
        onToggleDiscardCard={onToggleDiscardCard}
      />,
    )

    expect(container.querySelectorAll('[role="button"]').length).toBe(3)
  })

  it('does not toggle selection when the pointer moved past the drag threshold before release (scroll/drag, not a tap)', () => {
    const cards = [c('3', 'hearts'), c('4', 'hearts'), c('5', 'hearts')]
    const onToggleDiscardCard = vi.fn()

    const { container } = render(
      <DiscardPileView
        cards={cards}
        topTouchInProgress
        selectedDiscardCount={1}
        onToggleDiscardCard={onToggleDiscardCard}
      />,
    )

    const target = container.querySelectorAll('[role="button"]')[1]

    fireEvent.pointerDown(target, { clientX: 100, clientY: 50 })
    fireEvent.pointerMove(target, { clientX: 140, clientY: 50 }) // 40px > threshold
    fireEvent.pointerUp(target, { clientX: 140, clientY: 50 })
    fireEvent.click(target)

    expect(onToggleDiscardCard).not.toHaveBeenCalled()
  })

  it('still toggles selection for a genuine tap (pointer stays within the drag threshold)', () => {
    const cards = [c('3', 'hearts'), c('4', 'hearts'), c('5', 'hearts')]
    const onToggleDiscardCard = vi.fn()

    const { container } = render(
      <DiscardPileView
        cards={cards}
        topTouchInProgress
        selectedDiscardCount={1}
        onToggleDiscardCard={onToggleDiscardCard}
      />,
    )

    const target = container.querySelectorAll('[role="button"]')[1]

    fireEvent.pointerDown(target, { clientX: 100, clientY: 50 })
    fireEvent.pointerMove(target, { clientX: 102, clientY: 51 }) // within threshold
    fireEvent.pointerUp(target, { clientX: 102, clientY: 51 })
    fireEvent.click(target)

    expect(onToggleDiscardCard).toHaveBeenCalledWith(cards[1].id)
  })

  it('keeps hover scale/translate on an inner visual wrapper (group-hover), never on the outer measured ancestor', () => {
    // Regression for "pile disappears on hover": CSS transforms on an ancestor
    // of the FLIP-measured node change getBoundingClientRect and falsely
    // trigger a mass flight/hide. Hover polish must use group-hover on an
    // inner node instead of hover:scale / hover:-translate-y on the outer.
    const cards = [c('9', 'spades'), c('10', 'spades')]
    const { container } = render(<DiscardPileView cards={cards} />)

    const outer = container.querySelectorAll('[role="button"], .group')[0] as HTMLElement | undefined
    // The fanned cards are group wrappers even when not clickable.
    const group = container.querySelector('.group') as HTMLElement
    expect(group).toBeTruthy()
    expect(group.className).not.toMatch(/hover:scale-/)
    expect(group.className).not.toMatch(/hover:-translate-y-/)
    expect(group.className).toMatch(/\bgroup\b/)

    // Inner AnimatedCard visual wrapper receives the group-hover lift classes.
    const html = container.innerHTML
    expect(html).toMatch(/group-hover:scale-\[1\.18\]/)
    expect(html).toMatch(/group-hover:-translate-y-2/)
    void outer
  })
})
