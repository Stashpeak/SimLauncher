import { useEffect, useState, type ReactNode } from 'react'
import { useNotify } from './Notify'
import { AboutSection } from './settings/AboutSection'
import { AppearanceSection } from './settings/AppearanceSection'
import { AppsSection } from './settings/AppsSection'
import { BehaviorSection } from './settings/BehaviorSection'
import { ConfigSection } from './settings/ConfigSection'
import { GamesSection } from './settings/GamesSection'
import { SettingsSection } from './settings/SettingsSection'
import { useSettingsMeta } from './settings/SettingsMetaContext'
import type { UpdateInfo } from './settings/types'
import { useUpdateStatus } from './settings/useUpdateStatus'
import { useAppDirty } from '../contexts/AppDirtyContext'

// The unsaved-changes bar is rendered at the App level now (#423) so it pins
// to the viewport bottom regardless of which view is active or whether the
// scroll container has overflowed. Settings dirty state still flows into
// AppDirtyContext via the SettingsContext onDirtyChange chain.

export function SettingsView({
  onClose,
  updateInfo
}: {
  onClose: () => void
  updateInfo: UpdateInfo
}): ReactNode {
  return <SettingsViewContent onClose={onClose} updateInfo={updateInfo} />
}

function SettingsViewContent({
  onClose,
  updateInfo
}: {
  onClose: () => void
  updateInfo: UpdateInfo
}) {
  const { notify, announce } = useNotify()
  const { loading, isDirty, dirtySections, saveSettings } = useSettingsMeta()
  const { registerSaveHandler, registerDiscardHandler } = useAppDirty()
  const [expandedSections, setExpandedSections] = useState({
    about: true,
    appearance: true,
    behavior: true,
    config: true,
    games: false,
    apps: false
  })
  const updateStatus = useUpdateStatus({ updateInfo, notify, announce })

  const setSectionOpen = (section: keyof typeof expandedSections, open: boolean) => {
    setExpandedSections((current) => ({ ...current, [section]: open }))
  }

  // Escape navigates back to the games view from anywhere inside Settings.
  // This listener is on the bubble phase (not capture), so ConfirmDialog's
  // capture-phase handler takes priority and prevents this from firing while
  // a dialog is open — no double-close risk.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  useEffect(() => {
    registerSaveHandler('settings', isDirty ? saveSettings : null)
    return () => {
      registerSaveHandler('settings', null)
    }
  }, [registerSaveHandler, isDirty, saveSettings])

  useEffect(() => {
    // Settings discard is handled at the App level by re-syncing theme and
    // re-mounting the settings provider via refreshKey, so a no-op handler is
    // sufficient here. We still register so the discard pipeline is complete.
    registerDiscardHandler('settings', () => {})
    return () => {
      registerDiscardHandler('settings', null)
    }
  }, [registerDiscardHandler])

  if (loading) return null

  return (
    <div className="animate-fade-slide relative space-y-8 pb-2">
      <SettingsSection
        title="About"
        open={expandedSections.about}
        onOpenChange={(open) => setSectionOpen('about', open)}
        dirty={dirtySections.about}
      >
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
      </SettingsSection>

      <SettingsSection
        title="Appearance"
        open={expandedSections.appearance}
        onOpenChange={(open) => setSectionOpen('appearance', open)}
        dirty={dirtySections.appearance}
      >
        <AppearanceSection />
      </SettingsSection>

      <SettingsSection
        title="Behavior"
        open={expandedSections.behavior}
        onOpenChange={(open) => setSectionOpen('behavior', open)}
        dirty={dirtySections.behavior}
      >
        <BehaviorSection />
      </SettingsSection>

      <SettingsSection
        title="Config"
        open={expandedSections.config}
        onOpenChange={(open) => setSectionOpen('config', open)}
      >
        <ConfigSection />
      </SettingsSection>

      <SettingsSection
        title="Games"
        open={expandedSections.games}
        onOpenChange={(open) => setSectionOpen('games', open)}
        dirty={dirtySections.games}
      >
        <GamesSection />
      </SettingsSection>

      <SettingsSection
        title="Utility Apps"
        open={expandedSections.apps}
        onOpenChange={(open) => setSectionOpen('apps', open)}
        dirty={dirtySections.apps}
      >
        <AppsSection />
      </SettingsSection>

      <div className="flex gap-4 pt-4 px-1">
        <button
          onClick={() => void saveSettings()}
          aria-label={isDirty ? 'Save Changes (unsaved changes)' : 'Save Changes'}
          className="accent-surface-action action-hover-scale flex-1 cursor-pointer rounded-xl py-3 text-sm font-semibold relative overflow-hidden"
        >
          {isDirty && (
            <span
              aria-hidden="true"
              className="absolute left-3 top-1/2 -translate-y-1/2 flex h-2 w-2"
            >
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
