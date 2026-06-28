import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNotify } from './Notify'
import { AboutSection } from './settings/AboutSection'
import { AppearanceSection } from './settings/AppearanceSection'
import { AppsSection } from './settings/AppsSection'
import { BehaviorSection } from './settings/BehaviorSection'
import { ConfigSection } from './settings/ConfigSection'
import { GamesSection } from './settings/GamesSection'
import { SettingsSection } from './settings/SettingsSection'
import { useSettingsMeta } from './settings/SettingsMetaContext'
import type { SettingsSectionKey, UpdateInfo } from './settings/types'
import { useUpdateStatus } from './settings/useUpdateStatus'
import { useAppDirty } from '../contexts/AppDirtyContext'

// The unsaved-changes bar is rendered at the App level now (#423) so it pins
// to the viewport bottom regardless of which view is active or whether the
// scroll container has overflowed. Settings dirty state still flows into
// AppDirtyContext via the SettingsContext onDirtyChange chain.

export function SettingsView({
  onClose,
  updateInfo,
  targetSection
}: {
  onClose: () => void
  updateInfo: UpdateInfo
  targetSection: SettingsSectionKey | null
}): ReactNode {
  return (
    <SettingsViewContent onClose={onClose} updateInfo={updateInfo} targetSection={targetSection} />
  )
}

function SettingsViewContent({
  onClose,
  updateInfo,
  targetSection
}: {
  onClose: () => void
  updateInfo: UpdateInfo
  targetSection: SettingsSectionKey | null
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
  const rootRef = useRef<HTMLDivElement>(null)

  const setSectionOpen = useCallback((section: keyof typeof expandedSections, open: boolean) => {
    setExpandedSections((current) => ({ ...current, [section]: open }))
  }, [])

  // Deep-link arrival (the "Configure Games" CTA, later onboarding): open the
  // requested section and scroll it to the top. Gated on `loading` because the
  // sections (and their scroll anchors) aren't in the DOM until the config has
  // loaded. The scroll is deferred ~one expand-transition: a previously
  // collapsed section has no height yet, so scrolling immediately would clamp it
  // partway down before its content exists. Navigating back to Games resets the
  // target to null, so the same CTA re-fires without an explicit consume hop.
  useEffect(() => {
    if (loading || !targetSection) return
    setSectionOpen(targetSection, true)
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // Keep the delay in sync with SettingsSection's duration-300 grid-rows
    // transition so the section has reached full height before we scroll.
    const timer = window.setTimeout(() => {
      const node = rootRef.current?.querySelector<HTMLElement>(`[data-section="${targetSection}"]`)
      node?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
    }, 320)
    return () => window.clearTimeout(timer)
  }, [targetSection, loading, setSectionOpen])

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
    <div ref={rootRef} className="animate-fade-slide relative space-y-8 pb-2">
      <SettingsSection
        title="About"
        sectionKey="about"
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
        sectionKey="appearance"
        open={expandedSections.appearance}
        onOpenChange={(open) => setSectionOpen('appearance', open)}
        dirty={dirtySections.appearance}
      >
        <AppearanceSection />
      </SettingsSection>

      <SettingsSection
        title="Behavior"
        sectionKey="behavior"
        open={expandedSections.behavior}
        onOpenChange={(open) => setSectionOpen('behavior', open)}
        dirty={dirtySections.behavior}
      >
        <BehaviorSection />
      </SettingsSection>

      <SettingsSection
        title="Config"
        sectionKey="config"
        open={expandedSections.config}
        onOpenChange={(open) => setSectionOpen('config', open)}
      >
        <ConfigSection />
      </SettingsSection>

      <SettingsSection
        title="Games"
        sectionKey="games"
        open={expandedSections.games}
        onOpenChange={(open) => setSectionOpen('games', open)}
        dirty={dirtySections.games}
      >
        <GamesSection />
      </SettingsSection>

      <SettingsSection
        title="Utility Apps"
        sectionKey="apps"
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
