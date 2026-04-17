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
      className="glass-surface isolate flex h-9 w-full items-center justify-between border-l-4 border-l-(--accent) px-4 text-[13px] shadow-sm animate-in fade-in slide-in-from-top-2 duration-300"
    >
      <div className="flex items-center gap-2 overflow-hidden">
        <span className="truncate text-(--text-secondary)">
          Update <span className="font-medium text-(--text-primary)">{updateInfo.version}</span> available — restart to install
        </span>
      </div>
      
      <div className="flex items-center gap-4 no-drag">
        <button
          type="button"
          onClick={handleRestart}
          className="cursor-pointer font-medium text-(--accent) transition-opacity hover:opacity-80"
        >
          Restart
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-lg leading-none text-(--text-subtle) transition-colors hover:bg-(--glass-bg-elevated) hover:text-(--text-primary)"
          title="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  )
}
