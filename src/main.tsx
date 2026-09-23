import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { VideoLoginGate } from './components/VideoLoginGate'
import './styles/global.css'

const App = lazy(() => import('./LabApp'))

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <VideoLoginGate><Suspense fallback={<p role="status">正在打开工作区…</p>}><App /></Suspense></VideoLoginGate>
  </React.StrictMode>,
)
