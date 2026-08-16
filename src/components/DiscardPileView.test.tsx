import { describe, expect, it, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { DiscardPileView, discardFanWidth } from './DiscardPileView'
import { c } from '../engine/testHelpers'

describe('discardFanWidth', () => {
  it('grows with the pile up to 9 cards, then stays capped', () => {
    const w = 40
    expect(discardFanWidth(w, 1)).toBe(40)
    expect(discardFanWidth(w, 2)).toBeLessThan(discardFanWidth(w, 9))
    expect(discardFanWidth(w, 9)).toBe(discardFanWidth(w, 15))
    expect(discardFanWidth(w, 9)).toBeGreaterThan(discardFanWidth(w, 5))
  })
})

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
        selectedDiscardIds={[cards[2].id]}
        onToggleDiscardCard={onToggleDiscardCard}
      />,
    )

    const cardButtons = container.querySelectorAll('[role="button"]')
    expect(cardButtons.length).toBe(3)

    fireEvent.click(cardButtons[0])
    expect(onToggleDiscardCard).toHaveBeenCalledWith(cards[0].id)

    // Simulate the store applying an independent multi-select (top + bottom,
    // skipping the middle) — the rest of the pile must still be there.
    rerender(
      <DiscardPileView
        cards={cards}
        topTouchInProgress
        selectedDiscardIds={[cards[0].id, cards[2].id]}
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
        selectedDiscardIds={[cards[2].id]}
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
        selectedDiscardIds={[cards[2].id]}
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

  it('highlights hover with a ring, never scale/translate/filter on the card face', () => {
    // Regression for "discard card disappears when highlighted": scale +
    // drop-shadow (filter) on a parent of Card's overflow-hidden <img>
    // clips the face to a tiny corner. Hover polish must be a ring only.
    const cards = [c('A', 'spades')]
    const { container } = render(
      <DiscardPileView cards={cards} topCardInteractive onTopCardClick={() => undefined} />,
    )

    const group = container.querySelector('.group') as HTMLElement
    expect(group).toBeTruthy()
    expect(group.className).not.toMatch(/hover:scale-/)
    expect(group.className).not.toMatch(/hover:-translate-y-/)
    expect(group.className).toMatch(/\bgroup\b/)

    const html = container.innerHTML
    expect(html).not.toMatch(/group-hover:scale-/)
    expect(html).not.toMatch(/group-hover:-translate-y-/)
    expect(html).not.toMatch(/group-hover:drop-shadow/)
    expect(html).toMatch(/group-hover:ring-2/)
  })

  it('does not scroll a pile of 9 or fewer, and scrolls from the 10th card', () => {
    const nine = Array.from({ length: 9 }, (_, i) => c('6', i % 2 === 0 ? 'hearts' : 'clubs'))
    const { container, rerender } = render(<DiscardPileView cards={nine} cardWidth={40} />)
    expect((container.querySelector('.discard-fan') as HTMLElement).className).not.toMatch(/overflow-x-auto/)

    const ten = [...nine, c('7', 'spades')]
    rerender(<DiscardPileView cards={ten} cardWidth={40} />)
    expect((container.querySelector('.discard-fan') as HTMLElement).className).toMatch(/overflow-x-auto/)
  })

  it('keeps a 9-card-wide slot and enables hidden horizontal scroll past that', () => {
    const cards = Array.from({ length: 12 }, (_, i) => c('5', i % 2 === 0 ? 'hearts' : 'spades'))
    const cardWidth = 40
    const { container } = render(<DiscardPileView cards={cards} cardWidth={cardWidth} />)
    const row = container.querySelector('.discard-fan') as HTMLElement
    expect(row.className).toMatch(/overflow-x-auto/)
    expect(row.style.width).toBe(`${discardFanWidth(cardWidth, 9)}px`)
    expect(container.querySelectorAll('.group').length).toBe(12)
  })

  it('does not show a scrollbar class on the discard fan', () => {
    const cards = Array.from({ length: 12 }, () => c('8', 'clubs'))
    const { container } = render(<DiscardPileView cards={cards} cardWidth={40} />)
    const row = container.querySelector('.discard-fan') as HTMLElement
    expect(row.className).toMatch(/discard-fan/)
    expect(row.className).not.toMatch(/scrollbar/)
  })
})
