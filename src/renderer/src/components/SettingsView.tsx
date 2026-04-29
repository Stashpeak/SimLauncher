import { useEffect, useState } from 'react'
import { useNotify } from './Notify'
import { AboutSection } from './settings/AboutSection'
import { AppearanceSection } from './settings/AppearanceSection'
import { AppsSection } from './settings/AppsSection'
import { BehaviorSection } from './settings/BehaviorSection'
import { ConfigSection } from './settings/ConfigSection'
import { GamesSection } from './settings/GamesSection'
import { SettingsProvider, useSettings } from './settings/SettingsContext'
import type { UpdateInfo } from './settings/types'
import { useUpdateStatus } from './settings/useUpdateStatus'

export function SettingsView({
  onClose,
  updateInfo,
  onDirtyChange,
  shouldSaveTrigger,
  onSaved,
  onConfigImported
}: {
  onClose: () => void
  updateInfo: UpdateInfo
  onDirtyChange?: (isDirty: boolean) => void
  shouldSaveTrigger?: boolean
  onSaved?: () => void
  onConfigImported?: () => void
}) {
  return (
    <SettingsProvider
      onDirtyChange={onDirtyChange}
      shouldSaveTrigger={shouldSaveTrigger}
      onSaved={onSaved}
      onConfigImported={onConfigImported}
    >
      <SettingsViewContent onClose={onClose} updateInfo={updateInfo} />
    </SettingsProvider>
  )
}

function SettingsViewContent({
  onClose,
  updateInfo
}: {
  onClose: () => void
  updateInfo: UpdateInfo
}) {
  const { notify } = useNotify()
  const { loading, isDirty, saveSettings } = useSettings()
  const [appsOpen, setAppsOpen] = useState(false)
  const [gamesOpen, setGamesOpen] = useState(false)
  const updateStatus = useUpdateStatus({ updateInfo, notify })

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  if (loading) return null

  return (
    <div className="animate-fade-slide space-y-8 pb-10">
      <AboutSection
        appVersion={updateStatus.appVersion}
        updateInfo={updateInfo}
        checkingUpdate={updateStatus.checkingUpdate}
        installingUpdate={updateStatus.installingUpdate}
        updateProgress={updateStatus.updateProgress}
        updateStatus={updateStatus.updateStatus}
        onManualCheck={updateStatus.handleManualCheck}
        onInstallUpdate={updateStatus.handleInstallUpdate}
      />

      <AppearanceSection />

      <BehaviorSection />

      <ConfigSection />

      <GamesSection open={gamesOpen} onOpenChange={setGamesOpen} />

      <AppsSection open={appsOpen} onOpenChange={setAppsOpen} />

      <div className="flex gap-4 pt-4 px-1">
        <button
          onClick={() => void saveSettings()}
          className="accent-surface-action action-hover-scale flex-1 cursor-pointer rounded-xl py-3 text-sm font-semibold relative overflow-hidden"
        >
          {isDirty && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-(--accent) opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-(--accent)"></span>
            </span>
          )}
          Save Changes
        </button>
        <button
          onClick={onClose}
          className="accent-surface-action action-hover-scale flex-1 cursor-pointer rounded-xl py-3 text-sm font-semibold"
        >
          Back to Games
        </button>
      </div>
    </div>
  )
}
