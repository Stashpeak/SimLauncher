import { useEffect, useState } from 'react'
import {
  DEFAULT_ACCENT_COLOR,
  GAMES,
  getCustomUtilityKey,
  getUtilities,
  resolveCustomSlots,
  type Profiles
} from '../lib/config'
import { browsePath, getAssetData, getFileIcon, setLoginItem, setZoom } from '../lib/electron'
import {
  exportConfig,
  getProfiles,
  getSettings,
  importConfig,
  saveProfiles,
  saveSettings
} from '../lib/store'
import { useNotify } from './Notify'
import { AboutSection } from './settings/AboutSection'
import { AppearanceSection } from './settings/AppearanceSection'
import { AppsSection } from './settings/AppsSection'
import { BehaviorSection } from './settings/BehaviorSection'
import { ConfigSection } from './settings/ConfigSection'
import {
  shiftCustomSlotRecord,
  shiftCustomSlotSet,
  shiftProfileCustomSlots
} from './settings/customSlots'
import { GamesSection } from './settings/GamesSection'
import { normalizeLaunchDelayMs } from './settings/settingsUtils'
import type { UpdateInfo } from './settings/types'
import { useUpdateStatus } from './settings/useUpdateStatus'

const CONFIG_IMPORT_WARNING_KEY = 'simlauncher-config-import-warning'

export function SettingsView({
  onClose,
  updateInfo
}: {
  onClose: () => void
  updateInfo: UpdateInfo
}) {
  const { notify } = useNotify()
  const [loading, setLoading] = useState(true)

  const [appPaths, setAppPaths] = useState<Record<string, string>>({})
  const [appNames, setAppNames] = useState<Record<string, string>>({})
  const [profiles, setProfiles] = useState<Profiles>({})
  const [gamePaths, setGamePaths] = useState<Record<string, string>>({})
  const [customSlots, setCustomSlots] = useState(1)
  const [accentPreset, setAccentPreset] = useState<string>(DEFAULT_ACCENT_COLOR)
  const [accentCustom, setAccentCustom] = useState<string>('')
  const [accentBgTint, setAccentBgTint] = useState<boolean>(false)
  const [focusActiveTitle, setFocusActiveTitle] = useState<boolean>(true)
  const [launchDelayMs, setLaunchDelayMs] = useState<number>(1000)
  const [startWithWindows, setStartWithWindows] = useState<boolean>(false)
  const [startMinimized, setStartMinimized] = useState<boolean>(false)
  const [minimizeToTray, setMinimizeToTray] = useState<boolean>(false)
  const [autoCheckUpdates, setAutoCheckUpdates] = useState<boolean>(true)
  const [zoomFactor, setZoomFactor] = useState<number>(1.0)

  const [exportingConfig, setExportingConfig] = useState(false)
  const [importingConfig, setImportingConfig] = useState(false)
  const [isCustomColor, setIsCustomColor] = useState(false)
  const [appsOpen, setAppsOpen] = useState(false)
  const [gamesOpen, setGamesOpen] = useState(false)

  const [appIcons, setAppIcons] = useState<Record<string, string>>({})
  const [gameIcons, setGameIcons] = useState<Record<string, string>>({})
  const [iconLoadErrors, setIconLoadErrors] = useState<Set<string>>(new Set())

  const updateStatus = useUpdateStatus({ updateInfo, notify })

  useEffect(() => {
    async function loadSettings() {
      const [settings, savedProfiles] = await Promise.all([getSettings(), getProfiles()])
      const typedProfiles = savedProfiles as Profiles

      setAppPaths(settings.appPaths)
      setAppNames(settings.appNames)
      setProfiles(typedProfiles)
      setGamePaths(settings.gamePaths)
      setCustomSlots(
        resolveCustomSlots(
          settings.customSlots,
          settings.appPaths,
          settings.appNames,
          ...(Object.values(typedProfiles) as Record<string, unknown>[])
        )
      )
      setAccentPreset(settings.accentPreset || DEFAULT_ACCENT_COLOR)
      setAccentCustom(settings.accentCustom || '')
      setAccentBgTint(settings.accentBgTint || false)
      setFocusActiveTitle(settings.focusActiveTitle !== false)
      setLaunchDelayMs(normalizeLaunchDelayMs(settings.launchDelayMs))
      setStartWithWindows(settings.startWithWindows || false)
      setStartMinimized(settings.startMinimized || false)
      setMinimizeToTray(settings.minimizeToTray || false)
      setAutoCheckUpdates(settings.autoCheckUpdates !== false)
      setZoomFactor(Number.isFinite(settings.zoomFactor) ? settings.zoomFactor : 1.0)

      setIsCustomColor(settings.accentPreset === 'custom')

      const icons: Record<string, string> = {}
      for (const [key, path] of Object.entries(settings.appPaths)) {
        if (path) {
          const icon = await getFileIcon(path)
          if (icon) icons[key] = icon
        }
      }
      setAppIcons(icons)

      const gIcons: Record<string, string> = {}
      for (const game of GAMES) {
        const filename = game.icon.split('/').pop() || ''
        const data = await getAssetData(filename)
        if (data) gIcons[game.key] = data
      }
      setGameIcons(gIcons)

      setLoading(false)
    }
    loadSettings()
  }, [])

  const updateAccentCSS = (hex: string) => {
    if (!hex) return
    document.documentElement.style.setProperty('--accent', hex)

    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    document.documentElement.style.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, 0.24)`)
  }

  const handleAccentChange = (presetHex: string) => {
    setAccentPreset(presetHex)
    if (presetHex !== 'custom') {
      setIsCustomColor(false)
      updateAccentCSS(presetHex)
    } else {
      setIsCustomColor(true)
      if (accentCustom) updateAccentCSS(accentCustom)
    }
  }

  const handleCustomColorChange = (hex: string) => {
    setAccentCustom(hex)
    updateAccentCSS(hex)
  }

  const handleAccentBgTintChange = (checked: boolean) => {
    setAccentBgTint(checked)
    window.dispatchEvent(new CustomEvent('bg-tint-change', { detail: checked }))
  }

  const handleZoomFactorChange = (factor: number) => {
    setZoomFactor(factor)
    setZoom(factor)
  }

  const handleStartWithWindowsChange = (checked: boolean) => {
    setStartWithWindows(checked)
    setLoginItem(checked)
  }

  const handleBrowse = async (key: string, isGame: boolean) => {
    const result = (await browsePath(key)) as {
      filePath: string
      inputId: string
    }
    if (result && result.filePath) {
      if (isGame) {
        setGamePaths((prev) => ({ ...prev, [key]: result.filePath }))
      } else {
        setAppPaths((prev) => ({ ...prev, [key]: result.filePath }))
        const icon = await getFileIcon(result.filePath)
        if (icon) {
          setAppIcons((prev) => ({ ...prev, [key]: icon }))
          setIconLoadErrors((prev) => {
            const next = new Set(prev)
            next.delete(key)
            return next
          })
        }
      }
    }
  }

  const handleAddCustomSlot = () => {
    setCustomSlots((current) => current + 1)
  }

  const handleRemoveCustomSlot = (slotNumber: number) => {
    if (customSlots <= 1) {
      notify('At least one custom app slot is required', 'warn')
      return
    }

    const slotKey = getCustomUtilityKey(slotNumber)
    const slotName = appNames[slotKey] || `Custom App ${slotNumber}`

    if (appPaths[slotKey]) {
      const confirmed = window.confirm(`Remove ${slotName} and its executable path?`)

      if (!confirmed) {
        return
      }
    }

    setAppPaths((current) => shiftCustomSlotRecord(current, slotNumber, customSlots))
    setAppNames((current) => shiftCustomSlotRecord(current, slotNumber, customSlots))
    setAppIcons((current) => shiftCustomSlotRecord(current, slotNumber, customSlots))
    setIconLoadErrors((current) => shiftCustomSlotSet(current, slotNumber, customSlots))
    setProfiles((current) => {
      const nextProfiles: Profiles = {}

      Object.entries(current).forEach(([gameKey, profile]) => {
        nextProfiles[gameKey] = shiftProfileCustomSlots(profile, slotNumber, customSlots)
      })

      return nextProfiles
    })
    setCustomSlots((current) => Math.max(1, current - 1))
  }

  const handleAppNameChange = (key: string, name: string) => {
    setAppNames((prev) => ({ ...prev, [key]: name }))
  }

  const handleIconLoadError = (key: string) => {
    setIconLoadErrors((prev) => new Set([...prev, key]))
  }

  const handleExportConfig = async () => {
    setExportingConfig(true)

    try {
      const result = await exportConfig()

      if (result.success) {
        notify('Config exported', 'success', 2500)
      } else if (!result.canceled) {
        notify(result.error || 'Failed to export config', 'error')
      }
    } catch (err) {
      notify('Failed to export config', 'error')
      console.error(err)
    } finally {
      setExportingConfig(false)
    }
  }

  const handleImportConfig = async () => {
    const confirmed = window.confirm(
      'Importing a config file will replace your current SimLauncher settings. Continue?'
    )

    if (!confirmed) {
      return
    }

    setImportingConfig(true)

    try {
      const result = await importConfig()

      if (result.success) {
        window.sessionStorage.setItem(CONFIG_IMPORT_WARNING_KEY, '1')
        window.location.reload()
      } else if (!result.canceled) {
        notify(result.error || 'Failed to import config', 'error')
      }
    } catch (err) {
      notify('Failed to import config', 'error')
      console.error(err)
    } finally {
      setImportingConfig(false)
    }
  }

  const handleSave = async () => {
    try {
      const normalizedLaunchDelayMs = normalizeLaunchDelayMs(launchDelayMs)

      await Promise.all([
        saveSettings({
          appPaths,
          appNames,
          gamePaths,
          customSlots,
          accentPreset,
          accentCustom,
          accentBgTint,
          focusActiveTitle,
          launchDelayMs: normalizedLaunchDelayMs,
          startMinimized,
          minimizeToTray,
          autoCheckUpdates
        }),
        saveProfiles(profiles)
      ])
      setLaunchDelayMs(normalizedLaunchDelayMs)

      notify('Settings saved!', 'success', 2500)
    } catch (err) {
      notify('Failed to save settings', 'error')
      console.error(err)
    }
  }

  const utilities = getUtilities(customSlots)

  if (loading) return null

  return (
    <div className="animate-fade-slide space-y-8 pb-10">
      <AboutSection
        appVersion={updateStatus.appVersion}
        autoCheckUpdates={autoCheckUpdates}
        updateInfo={updateInfo}
        checkingUpdate={updateStatus.checkingUpdate}
        installingUpdate={updateStatus.installingUpdate}
        updateProgress={updateStatus.updateProgress}
        updateStatus={updateStatus.updateStatus}
        onAutoCheckUpdatesChange={setAutoCheckUpdates}
        onManualCheck={updateStatus.handleManualCheck}
        onInstallUpdate={updateStatus.handleInstallUpdate}
      />

      <AppearanceSection
        accentPreset={accentPreset}
        accentCustom={accentCustom}
        accentBgTint={accentBgTint}
        focusActiveTitle={focusActiveTitle}
        zoomFactor={zoomFactor}
        isCustomColor={isCustomColor}
        onAccentChange={handleAccentChange}
        onCustomColorChange={handleCustomColorChange}
        onAccentBgTintChange={handleAccentBgTintChange}
        onFocusActiveTitleChange={setFocusActiveTitle}
        onZoomFactorChange={handleZoomFactorChange}
      />

      <BehaviorSection
        startWithWindows={startWithWindows}
        startMinimized={startMinimized}
        minimizeToTray={minimizeToTray}
        launchDelayMs={launchDelayMs}
        onStartWithWindowsChange={handleStartWithWindowsChange}
        onStartMinimizedChange={setStartMinimized}
        onMinimizeToTrayChange={setMinimizeToTray}
        onLaunchDelayMsChange={setLaunchDelayMs}
      />

      <ConfigSection
        exportingConfig={exportingConfig}
        importingConfig={importingConfig}
        onExportConfig={handleExportConfig}
        onImportConfig={handleImportConfig}
      />

      <GamesSection
        open={gamesOpen}
        gamePaths={gamePaths}
        gameIcons={gameIcons}
        onOpenChange={setGamesOpen}
        onBrowse={(key) => handleBrowse(key, true)}
      />

      <AppsSection
        open={appsOpen}
        utilities={utilities}
        appPaths={appPaths}
        appNames={appNames}
        appIcons={appIcons}
        iconLoadErrors={iconLoadErrors}
        customSlots={customSlots}
        onOpenChange={setAppsOpen}
        onAppNameChange={handleAppNameChange}
        onIconLoadError={handleIconLoadError}
        onBrowse={(key) => handleBrowse(key, false)}
        onAddCustomSlot={handleAddCustomSlot}
        onRemoveCustomSlot={handleRemoveCustomSlot}
      />

      <div className="flex gap-4 pt-4 px-1">
        <button
          onClick={handleSave}
          className="flex-1 cursor-pointer rounded-xl bg-(--accent) py-3 text-sm font-bold text-white transition-all hover:opacity-90 active:scale-[0.98]"
        >
          Save Changes
        </button>
        <button
          onClick={onClose}
          className="flex-1 cursor-pointer rounded-xl bg-(--glass-bg-elevated) py-3 text-sm font-bold text-(--text-primary) transition-colors hover:bg-(--glass-border) active:scale-[0.98]"
        >
          Back to Games
        </button>
      </div>
    </div>
  )
}
