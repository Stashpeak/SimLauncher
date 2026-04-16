import './App.css'
import { NotifyProvider } from './components/Notify'
import { WindowControls } from './components/WindowControls'
import { UpdateBanner } from './components/UpdateBanner'
import { GameList } from './components/GameList'

export default function App() {
  return (
    <NotifyProvider>
      <div className="flex flex-col min-h-screen">
        <WindowControls />
        <UpdateBanner />
        <main className="flex-1 overflow-y-auto px-[2rem] pb-[2rem]">
          <GameList />
        </main>
      </div>
    </NotifyProvider>
  )
}
