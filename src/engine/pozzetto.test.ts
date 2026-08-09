import { describe, expect, it } from 'vitest'
import { shouldClaimPozzettoOnDiscard, shouldClaimPozzettoOnMeldEmpty } from './pozzetto'

describe('Pozzetto trigger logic', () => {
  it('triggers end-of-turn claim when hand was 1 card before the final discard', () => {
    expect(shouldClaimPozzettoOnDiscard(1, false)).toBe(true)
  })

  it('does not trigger end-of-turn claim if hand had more than 1 card before discarding', () => {
    expect(shouldClaimPozzettoOnDiscard(3, false)).toBe(false)
  })

  it('does not re-trigger if already claimed', () => {
    expect(shouldClaimPozzettoOnDiscard(1, true)).toBe(false)
  })

  it('triggers running-turn activation when melding empties the hand mid-turn', () => {
    expect(shouldClaimPozzettoOnMeldEmpty(0, false)).toBe(true)
  })

  it('does not trigger running-turn activation if hand still has cards', () => {
    expect(shouldClaimPozzettoOnMeldEmpty(2, false)).toBe(false)
  })

  it('does not re-trigger running-turn activation if already claimed', () => {
    expect(shouldClaimPozzettoOnMeldEmpty(0, true)).toBe(false)
  })
})
