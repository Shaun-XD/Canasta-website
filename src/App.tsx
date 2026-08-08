import { Route, Routes } from 'react-router-dom'
import { Landing } from './pages/Landing'
import { Lobby } from './pages/Lobby'
import { Table } from './pages/Table'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/lobby/:roomId" element={<Lobby />} />
      <Route path="/game/:roomId" element={<Table />} />
    </Routes>
  )
}

export default App
