import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { useGameStore } from '../store/gameStore'
import { Table } from './Table'

vi.mock('../lib/device', () => ({ useIsHandheld: () => false }))

const originalActions = useGameStore.getState().actions
afterEach(() => {
  cleanup()
  useGameStore.setState({ actions: originalActions })
})

it('waits for online session recovery before redirecting an empty store home', async () => {
  let finishRecovery!: (rejoined: boolean) => void
  const recovery = new Promise<boolean>(resolve => { finishRecovery = resolve })
  useGameStore.setState({
    room: null, game: null, localPlayerId: null,
    actions: { ...originalActions, rejoinOnlineSession: () => recovery },
  })
  render(
    <MemoryRouter initialEntries={['/game/ABCDE']}>
      <Routes>
        <Route path="/game/:roomId" element={<Table />} />
        <Route path="/" element={<div>Home screen</div>} />
      </Routes>
    </MemoryRouter>,
  )
  expect(screen.queryByText('Home screen')).toBeNull()
  expect(screen.getByText('Reconnecting to game…')).toBeTruthy()
  await act(async () => { finishRecovery(false); await recovery })
  expect(screen.getByText('Home screen')).toBeTruthy()
})
