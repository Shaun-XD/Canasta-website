import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RoundEndModal } from './RoundEndModal'

afterEach(cleanup)

it('continues a scored match without resetting it and stops offering another round after a win', () => {
  const next = vi.fn()
  const reset = vi.fn()
  const props = { teams: [], scores: null, matchTargetScore: 2100, onReviewTable: vi.fn(),
    onNewGame: reset, onNextRound: next, onReturnToLobby: vi.fn() }
  const { rerender } = render(<RoundEndModal {...props} gameOverTeamId={null} />)
  fireEvent.click(screen.getByRole('button', { name: 'Next round' }))
  expect(next).toHaveBeenCalledOnce()
  expect(reset).not.toHaveBeenCalled()
  rerender(<RoundEndModal {...props} gameOverTeamId="team-a" />)
  expect(screen.queryByRole('button', { name: 'Next round' })).toBeNull()
  expect(screen.getByRole('button', { name: 'New Game' })).toBeDefined()
})
