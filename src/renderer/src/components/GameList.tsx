import { useEffect, useState, useRef } from 'react'
import {
  GAMES,
  createProfileId,
  getActiveGameProfile,
  type Game,
  type NamedGameProfile
} from '../lib/config'
import { ProfileEditor } from './ProfileEditor'
import { useNotify } from './Notify'
import { getSettings } from '../lib/store'
import {
  getAssetData,
  getProfileSwitchDiff,
  switchProfileApps,
  launchProfile,
  killLaunchedApps,
  relaunchMissingProfile,
  getFileIcon
} from '../lib/electron'
import { useGameProfile } from '../hooks/useGameProfile'
import { useLaunchBlock } from '../hooks/useLaunchBlock'
import { useProfileMenu } from '../hooks/useProfileMenu'
import { useRunningApps } from '../hooks/useRunningApps'

const POST_LAUNCH_BLOCK_MS = 10000

function GameRow({
  game,
  isActive,
  isRunning,
  runningAppIcons,
  isDimmed,
  isLaunching,
  isLaunchBlocked,
  onLaunchStart,
  onLaunchEnd,
  onRunningStateRefresh,
  onToggleEditor,
  cacheInitialized
}: {
  game: Game
  isActive: boolean
  isRunning: boolean
  runningAppIcons: { icon: string | null; name: string; warning?: string }[]
  isDimmed: boolean
  isLaunching: boolean
  isLaunchBlocked: boolean
  onLaunchStart: (gameKey: string) => void
  onLaunchEnd: (gameKey: string, cooldownMs?: number) => void
  onRunningStateRefresh: () => Promise<void>
  onToggleEditor: () => void
  cacheInitialized: boolean
}) {
  const { notify } = useNotify()
  const [iconUrl, setIconUrl] = useState<string | null>(null)
  const [iconLoadFailed, setIconLoadFailed] = useState(false)
  const [failedRunningIcons, setFailedRunningIcons] = useState<Record<string, true>>({})
  const {
    profileMenuOpen,
    openProfileMenu,
    closeProfileMenu,
    newProfileFormOpen,
    setNewProfileFormOpen,
    newProfileName,
    setNewProfileName,
    profileMenuRef,
    menuRef,
    triggerRef,
    handleProfileMenuTriggerKeyDown,
    handleProfileMenuKeyDown,
    newProfileInputRef
  } = useProfileMenu()
  const { profileSet, profileState, loadProfileSet, getProfileRuntimeConfig, saveProfileSet } =
    useGameProfile(game.key, isActive)

  useEffect(() => {
    async function resolveIcon() {
      const filename = game.icon.split('/').pop() || ''
      const data = await getAssetData(filename)
      setIconLoadFailed(false)
      setIconUrl(data)
    }
    resolveIcon()
  }, [game.icon])

  const handleCreateProfile = async (name: string) => {
    const trimmedName = name.trim()

    if (trimmedName.length === 0) {
      return
    }

    const nextProfileSet = await getProfileRuntimeConfig()
    const activeProfile = getActiveGameProfile(nextProfileSet)
    const newProfile: NamedGameProfile = {
      ...JSON.parse(JSON.stringify(activeProfile)),
      id: createProfileId(),
      name: trimmedName
    }
    const updatedProfileSet = {
      activeProfileId: newProfile.id,
      profiles: [...nextProfileSet.profiles, newProfile]
    }

    await saveProfileSet(updatedProfileSet)
    notify(`Created profile ${newProfile.name}`, 'success')
  }

  const handleProfileSelect = async (nextProfileId: string) => {
    if (nextProfileId === '__new__') {
      setNewProfileFormOpen(true)
      return
    }

    if (nextProfileId === profileSet.activeProfileId) {
      closeProfileMenu(true)
      return
    }

    if (isRunning && isLaunchBlocked) {
      notify('Launch is settling. Try again shortly.', 'warn')
      return
    }

    const latestProfileSet = await getProfileRuntimeConfig()
    const currentProfile = getActiveGameProfile(latestProfileSet)
    const nextProfile = latestProfileSet.profiles.find((profile) => profile.id === nextProfileId)

    if (!nextProfile) {
      return
    }

    const updatedProfileSet = {
      ...latestProfileSet,
      activeProfileId: nextProfile.id
    }

    try {
      let switchWarning: string | undefined

      if (isRunning) {
        const diff = await getProfileSwitchDiff(game.key, currentProfile.id, nextProfile.id)

        if (diff.toStopCount > 0 || diff.toStartCount > 0) {
          const parts: string[] = []
          if (diff.toStopCount > 0) parts.push(`stop ${diff.toStopCount} app(s)`)
          if (diff.toStartCount > 0) parts.push(`start ${diff.toStartCount} app(s)`)
          if (
            !window.confirm(
              `Switch to "${nextProfile.name}" while the game is running? This will ${parts.join(' and ')}.`
            )
          ) {
            return
          }

          onLaunchStart(game.key)
          const result = await switchProfileApps(game.key, currentProfile.id, nextProfile.id)
          if (!result.success) {
            notify(result.error || 'Failed to switch profile', 'error')
            onLaunchEnd(game.key, result.launchedCount === 0 ? 0 : POST_LAUNCH_BLOCK_MS)
            return
          }
          onLaunchEnd(game.key, result.launchedCount === 0 ? 0 : POST_LAUNCH_BLOCK_MS)
          switchWarning = result.warning
        }

        await onRunningStateRefresh()
      }

      await saveProfileSet(updatedProfileSet)
      closeProfileMenu(true)
      notify(
        switchWarning || `Switched to ${nextProfile.name}`,
        switchWarning ? 'warn' : 'success',
        switchWarning ? 5000 : undefined
      )
    } catch (err) {
      onLaunchEnd(game.key, 0)
      notify('Failed to switch profile', 'error')
      console.error(err)
    }
  }

  const handleNewProfileSubmit = async () => {
    const trimmedName = newProfileName.trim()

    if (trimmedName.length === 0) {
      return
    }

    await handleCreateProfile(trimmedName)
    setNewProfileName('')
    setNewProfileFormOpen(false)
    closeProfileMenu(true)
  }

  const handleLaunch = async () => {
    if (isLaunchBlocked) {
      return
    }

    let cooldownMs = 0

    try {
      onLaunchStart(game.key)
      const result = await launchProfile(game.key)
      if (!result.success) {
        cooldownMs = result.launchedCount === 0 ? 0 : POST_LAUNCH_BLOCK_MS
        notify(result.error || 'Failed to launch profile', 'error')
        return
      }

      cooldownMs = result.launchedCount === 0 ? 0 : POST_LAUNCH_BLOCK_MS
      notify(
        result.warning || result.message || `Launching ${game.name}`,
        result.warning ? 'warn' : 'success',
        result.warning ? 5000 : undefined
      )
    } catch (err) {
      notify('Failed to launch profile', 'error')
      console.error(err)
    } finally {
      onLaunchEnd(game.key, cooldownMs)
    }
  }

  const handleKill = async () => {
    try {
      const result = await killLaunchedApps(game.key)
      await onRunningStateRefresh()

      if (!result.success) {
        notify(
          result.warning || result.error || 'Some companion apps could not be closed',
          'warn',
          6000
        )
        return
      }

      notify(result.message || `Closing companion apps for ${game.name}`, 'warn')
    } catch (err) {
      notify('Failed to close companion apps', 'error')
      console.error(err)
    }
  }

  const handleRelaunchMissing = async () => {
    if (isLaunchBlocked) {
      return
    }

    let cooldownMs = 0

    try {
      onLaunchStart(game.key)
      const result = await relaunchMissingProfile(game.key)
      if (!result.success) {
        cooldownMs = result.launchedCount === 0 ? 0 : POST_LAUNCH_BLOCK_MS
        notify(result.error || 'Failed to relaunch missing apps', 'error')
        return
      }

      cooldownMs = result.launchedCount === 0 ? 0 : POST_LAUNCH_BLOCK_MS
      notify(
        result.warning || result.message || 'Relaunching missing apps',
        result.warning ? 'warn' : 'success',
        result.warning ? 5000 : undefined
      )
    } catch (err) {
      notify('Failed to relaunch missing apps', 'error')
      console.error(err)
    } finally {
      onLaunchEnd(game.key, cooldownMs)
    }
  }

  const rowRef = useRef<HTMLDivElement | null>(null)

  const handleToggle = () => {
    onToggleEditor()
    if (!isActive && rowRef.current) {
      setTimeout(() => {
        rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 50)
    }
  }

  const canKill = runningAppIcons.length > 0 && profileState.killControlsEnabled
  const canRelaunch = isRunning && profileState.relaunchControlsEnabled
  const primaryAction = canKill ? handleKill : handleLaunch
  const primaryButtonClass = canKill ? 'danger-action' : 'accent-surface-action'
  const primaryTitle = isLaunching && !canKill ? 'Launching' : canKill ? 'Close Apps' : 'Launch'
  const activeProfile = getActiveGameProfile(profileSet)

  return (
    <div
      className={`relative flex flex-col gap-2 transition-opacity duration-300 ${profileMenuOpen ? 'z-40' : 'z-0'} ${isDimmed ? 'opacity-45' : 'opacity-100'}`}
      ref={rowRef}
    >
      <div
        className={`accent-subtle-hover glass-surface flex h-[72px] w-full items-center justify-between rounded-[20px] px-6 ${profileMenuOpen ? '!isolation-auto z-20' : 'z-0'}`}
      >
        <div className="flex items-center gap-5">
          <div className="relative flex h-12 w-12 shrink-0 items-center justify-center">
            {iconUrl && !iconLoadFailed ? (
              <img
                src={iconUrl}
                alt={game.name}
                className="game-icon-image h-12 w-12 object-contain animate-fade-slide"
                onError={() => setIconLoadFailed(true)}
              />
            ) : !iconLoadFailed ? (
              <div className="h-12 w-12 skeleton-icon animate-pulse" />
            ) : null}
            {isRunning && (
              <div
                className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-(--status-running) shadow-[0_0_8px_var(--status-running)]"
                title="Running"
              />
            )}
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <h3 className="game-title font-semibold text-(--text-primary)">{game.name}</h3>
            </div>
            {runningAppIcons.length > 0 && (
              <div className="flex items-center gap-1">
                {runningAppIcons.map((app, i) => {
                  const isAvailable = !!app.icon && !failedRunningIcons[app.icon]
                  const isFailed = failedRunningIcons[app.icon!]

                  if (isAvailable) {
                    return (
                      <img
                        key={i}
                        src={app.icon ?? undefined}
                        alt=""
                        title={app.warning || app.name}
                        className={`h-4 w-4 object-contain opacity-80 ${app.warning ? 'rounded-sm ring-1 ring-(--warning-text)' : ''}`}
                        onError={() =>
                          setFailedRunningIcons((current) => ({ ...current, [app.icon!]: true }))
                        }
                      />
                    )
                  }

                  if (app.icon === null && !isFailed && !cacheInitialized) {
                    return <div key={i} className="h-4 w-4 skeleton-icon animate-pulse" />
                  }

                  return (
                    <div
                      key={i}
                      className={`fallback-initial-icon h-4 w-4 rounded text-[6px] font-black flex items-center justify-center shrink-0 ${app.warning ? 'ring-1 ring-(--warning-text)' : ''}`}
                      title={app.warning || app.name}
                    >
                      {app.name
                        .replace(/\.exe$/i, '')
                        .slice(0, 2)
                        .toUpperCase()}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-[36px_260px] items-center gap-3 no-drag">
          <div className="flex h-9 w-9 items-center justify-center">
            {canRelaunch && (
              <button
                type="button"
                onClick={handleRelaunchMissing}
                disabled={isLaunchBlocked}
                className="icon-action flex h-9 w-9 cursor-pointer items-center justify-center rounded-full"
                title="Relaunch missing apps"
                aria-label="Relaunch missing apps"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                  <path d="M21 3v6h-6" />
                </svg>
              </button>
            )}
          </div>

          <div className="no-drag glass-surface flex w-[260px] shrink-0 items-center rounded-full">
            <div ref={profileMenuRef} className="relative">
              <button
                ref={triggerRef}
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  if (profileMenuOpen) {
                    closeProfileMenu(false)
                  } else {
                    openProfileMenu(false)
                  }
                }}
                onKeyDown={handleProfileMenuTriggerKeyDown}
                className="dropdown-trigger-surface group flex h-9 w-[124px] cursor-pointer items-center gap-1.5 rounded-l-full py-2 pl-3 pr-2.5 text-[10px] font-semibold text-(--text-secondary) transition-colors hover:text-(--text-primary)"
                aria-haspopup="menu"
                aria-expanded={profileMenuOpen}
                aria-label={`${game.name} profile`}
                title={activeProfile.name}
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`shrink-0 text-(--text-muted) transition-transform ${profileMenuOpen ? 'rotate-180' : ''}`}
                >
                  <path d="M3 6l5 5 5-5" />
                </svg>
                <span className="min-w-0 truncate">{activeProfile.name}</span>
              </button>
              {profileMenuOpen && (
                <div
                  ref={menuRef}
                  role="menu"
                  onKeyDown={handleProfileMenuKeyDown}
                  className="dropdown-surface absolute right-0 top-full z-50 mt-1.5 min-w-44 overflow-hidden rounded-xl p-1 backdrop-blur-xl animate-fade-slide"
                >
                  {profileSet.profiles.map((profile) => {
                    const selected = profile.id === profileSet.activeProfileId

                    return (
                      <button
                        key={profile.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={selected ? 'true' : 'false'}
                        onClick={(event) => {
                          event.stopPropagation()
                          handleProfileSelect(profile.id)
                        }}
                        className={`dropdown-item flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold ${
                          selected ? 'selected-surface' : ''
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${selected ? 'bg-(--accent)' : 'bg-(--text-subtle)'}`}
                        />
                        <span className="min-w-0 flex-1 truncate">{profile.name}</span>
                      </button>
                    )
                  })}
                  <div className="my-1 h-px bg-(--glass-border)" />
                  {newProfileFormOpen ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        handleNewProfileSubmit()
                      }}
                      className="flex items-center gap-1.5 rounded-lg px-1.5 py-1"
                    >
                      <input
                        ref={newProfileInputRef}
                        type="text"
                        value={newProfileName}
                        onChange={(event) => setNewProfileName(event.target.value)}
                        onClick={(event) => event.stopPropagation()}
                        placeholder="Profile name"
                        className="min-w-0 flex-1 rounded-md border border-(--glass-border) bg-(--glass-bg) px-2 py-1.5 text-xs font-semibold text-(--text-primary) outline-none placeholder:text-(--text-subtle) focus:border-(--accent)"
                        aria-label="New profile name"
                      />
                      <button
                        type="submit"
                        disabled={newProfileName.trim().length === 0}
                        className="accent-action flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md"
                        aria-label="Create profile"
                        title="Create profile"
                      >
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={(event) => {
                        event.stopPropagation()
                        handleProfileSelect('__new__')
                      }}
                      className="dropdown-item flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-bold"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                      >
                        <path d="M12 5v14" />
                        <path d="M5 12h14" />
                      </svg>
                      New profile
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="relative z-10 h-4 w-px bg-(--glass-border) opacity-35" />

            <button
              type="button"
              onClick={primaryAction}
              disabled={isLaunchBlocked && !canKill}
              className={`cursor-pointer flex h-9 w-[92px] items-center justify-center ${primaryButtonClass}`}
              title={primaryTitle}
              aria-label={primaryTitle}
            >
              {isLaunching && !canKill ? (
                <svg
                  width="21"
                  height="21"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--launcher-play)"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  className="animate-spin"
                >
                  <path d="M12 3a9 9 0 1 1-8 4.9" />
                </svg>
              ) : canKill ? (
                <svg
                  width="21"
                  height="21"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M7 7l10 10" />
                  <path d="M17 7L7 17" />
                </svg>
              ) : (
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="var(--launcher-play)"
                  className="ml-1"
                >
                  <path d="M7.4 4.5A1.5 1.5 0 0 0 5 5.8v12.4a1.5 1.5 0 0 0 2.4 1.3l9.8-6.2a1.5 1.5 0 0 0 0-2.6L7.4 4.5z" />
                </svg>
              )}
            </button>

            <div className="relative z-10 h-4 w-px bg-(--glass-border) opacity-35" />

            <button
              type="button"
              onClick={handleToggle}
              className={`group flex h-9 w-10 cursor-pointer items-center justify-center rounded-r-full ${
                isActive ? 'icon-action-active' : 'icon-action'
              }`}
              title="Profile Settings"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`transition-transform ${isActive ? 'rotate-90 scale-110' : 'group-hover:rotate-45'}`}
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div
        className={`profile-editor-wrapper relative z-0 mx-2 ${isActive ? 'profile-editor-open' : 'profile-editor-closed'}`}
      >
        <div className="overflow-hidden">
          {isActive && (
            <div className="animate-fade-slide px-2 pb-4 pt-3">
              <ProfileEditor
                gameKey={game.key}
                gameName={game.name}
                activeProfileId={profileSet.activeProfileId}
                onProfilesChanged={loadProfileSet}
                onClose={onToggleEditor}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function GameList() {
  const [configuredGames, setConfiguredGames] = useState<Game[]>([])
  const [activeEditorKey, setActiveEditorKey] = useState<string | null>(null)
  const [appIconCache, setAppIconCache] = useState<Record<string, string>>({})
  const [cacheInitialized, setCacheInitialized] = useState(false)
  const [gamePaths, setGamePaths] = useState<Record<string, string>>({})
  const [focusActiveTitle, setFocusActiveTitle] = useState(true)
  const { launchingGameKey, handleLaunchStart, handleLaunchEnd } = useLaunchBlock()
  const { runningApps, runningStatus, refreshRunningState } = useRunningApps(configuredGames)

  useEffect(() => {
    async function loadGames() {
      try {
        const settings = await getSettings()
        setGamePaths(settings.gamePaths)
        const available = GAMES.filter((game) => !!settings.gamePaths[game.key])
        setConfiguredGames(available)
      } catch (err) {
        console.error('Failed to load game paths', err)
      }
    }

    loadGames()
  }, [])

  useEffect(() => {
    let mounted = true

    async function loadFocusActiveTitle() {
      const settings = await getSettings()

      if (mounted) {
        setFocusActiveTitle(settings.focusActiveTitle !== false)
      }
    }

    loadFocusActiveTitle()
    window.addEventListener('focus', loadFocusActiveTitle)

    return () => {
      mounted = false
      window.removeEventListener('focus', loadFocusActiveTitle)
    }
  }, [])

  // Load app icons once at mount
  useEffect(() => {
    async function loadAppIcons() {
      try {
        const settings = await getSettings()
        const cache: Record<string, string> = {}
        await Promise.all(
          Object.values(settings.appPaths)
            .filter(Boolean)
            .map(async (p) => {
              const icon = await getFileIcon(p)
              if (icon) cache[p.toLowerCase()] = icon
            })
        )
        setAppIconCache(cache)
        setCacheInitialized(true)
      } catch (err) {
        console.error('Failed to load app icons', err)
        setCacheInitialized(true)
      }
    }

    loadAppIcons()
  }, [])

  if (configuredGames.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center text-(--text-secondary)">
        <p>No games configured.</p>
        <p className="mt-1 text-sm text-(--text-muted)">
          Configure game paths in settings to see them here.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 px-1 py-2">
      {configuredGames
        .map((game, index) => ({ game, index }))
        .sort((firstEntry, secondEntry) => {
          if (!focusActiveTitle) {
            return 0
          }

          const runningSort =
            Number(!!runningStatus[secondEntry.game.key]) -
            Number(!!runningStatus[firstEntry.game.key])
          return runningSort || firstEntry.index - secondEntry.index
        })
        .map(({ game }) => {
          const hasActiveTitle = focusActiveTitle && Object.values(runningStatus).some(Boolean)
          const gamePathLower = gamePaths[game.key]?.toLowerCase()
          const appsForGame = runningApps.filter(
            (a) => a.gameKey === game.key && a.path.toLowerCase() !== gamePathLower
          )
          const runningAppIcons = appsForGame.map((a) => ({
            icon: appIconCache[a.path.toLowerCase()] ?? null,
            name: a.name,
            warning: a.warning
          }))

          return (
            <GameRow
              key={game.key}
              game={game}
              isActive={activeEditorKey === game.key}
              isRunning={!!runningStatus[game.key]}
              runningAppIcons={runningAppIcons}
              isDimmed={hasActiveTitle && !runningStatus[game.key]}
              isLaunching={launchingGameKey === game.key}
              isLaunchBlocked={launchingGameKey !== null}
              onLaunchStart={handleLaunchStart}
              onLaunchEnd={handleLaunchEnd}
              onRunningStateRefresh={refreshRunningState}
              onToggleEditor={() =>
                setActiveEditorKey(activeEditorKey === game.key ? null : game.key)
              }
              cacheInitialized={cacheInitialized}
            />
          )
        })}
    </div>
  )
}
