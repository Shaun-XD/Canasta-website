import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { applyDeviceClass } from './lib/device'

const AndroidSession = import.meta.env.MODE === 'android'
  ? lazy(() => import('./android/AndroidSession').then(({ AndroidSession }) => ({ default: AndroidSession })))
  : null

applyDeviceClass()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
      {AndroidSession && <Suspense fallback={null}><AndroidSession /></Suspense>}
    </BrowserRouter>
  </StrictMode>,
)
