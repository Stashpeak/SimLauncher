import { useEffect, useState } from 'react'

interface UpdateInfo {
  version: string
}

export function UpdateBanner() {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)

  useEffect(() => {
    // Register listener for update availability
    const unsubscribe = window.electronAPI.onUpdateAvailable((info: any) => {
      if (info && typeof info === 'object' && info.version) {
        setUpdateInfo({ version: info.version })
      }
    })

    return () => {
      // Clean up listener on unmount
      unsubscribe()
    }
  }, [])

  if (!updateInfo) return null

  const handleRestart = () => {
    window.electronAPI.installUpdate()
  }

  const handleDismiss = () => {
    setUpdateInfo(null)
  }

  return (
    <div 
      className="glass-surface flex h-9 w-full items-center justify-between border-l-4 border-l-[var(--accent)] px-4 text-[13px] shadow-sm animate-in fade-in slide-in-from-top-2 duration-300"
      style={{ isolation: 'isolate' }}
    >
      <div className="flex items-center gap-2 overflow-hidden">
        <span className="truncate text-[var(--text-secondary)]">
          Update <span className="font-medium text-[var(--text-primary)]">{updateInfo.version}</span> available — restart to install
        </span>
      </div>
      
      <div className="flex items-center gap-4 no-drag">
        <button
          type="button"
          onClick={handleRestart}
          className="cursor-pointer font-medium text-[var(--accent)] transition-opacity hover:opacity-80"
        >
          Restart
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-lg leading-none text-[var(--text-subtle)] transition-colors hover:bg-[var(--glass-bg-elevated)] hover:text-[var(--text-primary)]"
          title="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  )
}
