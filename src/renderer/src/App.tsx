import './App.css'
import { NotifyProvider } from './components/Notify'

export default function App() {
  return (
    <NotifyProvider>
      <div style={{ padding: '2rem' }}>
        <h1 style={{ color: 'var(--text-primary)' }}>SimLauncher</h1>
      </div>
    </NotifyProvider>
  )
}
