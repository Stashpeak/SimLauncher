import './App.css'
import { NotifyProvider } from './components/Notify'
import { WindowControls } from './components/WindowControls'
import { UpdateBanner } from './components/UpdateBanner'

export default function App() {
  return (
    <NotifyProvider>
      <div className="flex flex-col min-h-screen">
        <WindowControls />
        <UpdateBanner />
        <div style={{ padding: '2rem' }}>
          <h1 style={{ color: 'var(--text-primary)' }}>SimLauncher</h1>
        </div>
      </div>
    </NotifyProvider>
  )
}
