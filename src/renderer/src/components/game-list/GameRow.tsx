import { useRef, useState } from 'react'
import {
  createProfileId,
  getActiveGameProfile,
  type Game,
  type NamedGameProfile
} from '../../lib/config'
import { ProfileEditor } from '../ProfileEditor'
import { useNotify } from '../Notify'
import {
  getProfileSwitchDiff,
  switchProfileApps,
  launchProfile,
  killLaunchedApps,
  relaunchMissingProfile
} from '../../lib/electron'
import { formatKillFailures } from '../../lib/killFailures'
import { useGameProfile } from '../../hooks/useGameProfile'
import { useProfileMenu } from '../../hooks/useProfileMenu'
import { GameIcon } from './GameIcon'
import { RunningAppsStrip, type RunningAppIcon } from './RunningAppsStrip'
import {
  ChevronDownIcon,
  CheckIcon,
  PlusIcon,
  RefreshIcon,
  KillIcon,
  PlayMarkIcon,
  SettingsIcon
} from '../icons'
import { ConfirmDialog } from '../ConfirmDialog'

const POST_LAUNCH_BLOCK_MS = 10000

export function GameRow({
  game,
  isActive,
  isRunning,
  runningAppIcons,
  gameIconUrl,
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
  runningAppIcons: RunningAppIcon[]
  gameIconUrl?: string
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
  const [profileSwitchConfirm, setProfileSwitchConfirm] = useState<{
    nextProfileId: string
    nextProfileName: string
    message: string
  } | null>(null)
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

  const switchToProfile = async (nextProfileId: string, skipRunningConfirm = false) => {
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
          const message = `Switch to "${nextProfile.name}" while the game is running? This will ${parts.join(' and ')}.`

          if (!skipRunningConfirm) {
            setProfileSwitchConfirm({
              nextProfileId: nextProfile.id,
              nextProfileName: nextProfile.name,
              message
            })
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

          const switchWarnings: string[] = []
          if (result.killFailures && result.killFailures.length > 0) {
            switchWarnings.push(formatKillFailures(result.killFailures))
          }
          if (result.warning) {
            switchWarnings.push(result.warning)
          }
          switchWarning = switchWarnings.length > 0 ? switchWarnings.join(' ') : undefined
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

  const handleProfileSelect = (nextProfileId: string) => {
    void switchToProfile(nextProfileId)
  }

  const handleConfirmProfileSwitch = () => {
    if (!profileSwitchConfirm) return

    const nextProfileId = profileSwitchConfirm.nextProfileId
    setProfileSwitchConfirm(null)
    void switchToProfile(nextProfileId, true)
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

  const handleLaunchRequest = useRef<(() => void) | null>(null)

  const handleLaunch = async () => {
    if (isActive && handleLaunchRequest.current) {
      handleLaunchRequest.current()
      return
    }

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
        const message = result.error || formatKillFailures(result.failures)
        notify(message, 'warn', 6000)
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
      className={`game-row-container group/row relative flex flex-col ${isActive ? '' : 'gap-2'} transition-opacity duration-300 ${profileMenuOpen ? 'z-40' : 'z-0'} ${isDimmed ? 'opacity-45' : 'opacity-100'}`}
      ref={rowRef}
    >
      <div
        className={`accent-subtle-hover glass-surface flex h-[72px] w-full items-center justify-between rounded-[20px] px-6 ${profileMenuOpen ? 'isolation-auto! z-20' : 'z-0'}`}
      >
        <div className="flex items-center gap-5">
          <GameIcon game={game} isRunning={isRunning} iconUrl={gameIconUrl} />
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <h3 className="game-title select-none font-normal text-(--text-primary)">
                {game.name}
              </h3>
            </div>
            <RunningAppsStrip
              runningAppIcons={runningAppIcons}
              cacheInitialized={cacheInitialized}
            />
          </div>
        </div>

        <div className="flex items-center gap-3 no-drag">
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
                <RefreshIcon
                  width={18}
                  height={18}
                  strokeWidth="2.2"
                  className="transition-transform group-hover/btn:scale-110 group-active/btn:scale-95"
                />
              </button>
            )}
          </div>

          <div className="no-drag glass-surface flex items-center rounded-full p-0.5">
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
                className="dropdown-trigger-surface group/dropdown flex h-9 w-[120px] cursor-pointer items-center gap-1.5 rounded-l-full py-2 pl-3 pr-2.5 text-[10px] font-semibold text-(--text-secondary) transition-all hover:text-(--text-primary)"
                aria-haspopup="menu"
                aria-expanded={profileMenuOpen}
                aria-label={`${game.name} profile`}
                title={activeProfile.name}
              >
                <ChevronDownIcon
                  width={10}
                  height={10}
                  className={`shrink-0 text-(--text-muted) transition-transform ${profileMenuOpen ? 'rotate-180' : ''}`}
                />
                <span className="min-w-0 select-none truncate">{activeProfile.name}</span>
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
                        <CheckIcon width={13} height={13} />
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
                      <PlusIcon width={12} height={12} />
                      New profile
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="relative z-10 h-4 w-px bg-(--glass-border) opacity-15" />

            <button
              type="button"
              onClick={primaryAction}
              disabled={isLaunchBlocked && !canKill}
              className={`launcher-play-btn group/btn flex h-9 w-[54px] shrink-0 cursor-pointer items-center justify-center rounded-r-full transition-all ${primaryButtonClass}`}
              title={primaryTitle}
              aria-label={primaryTitle}
            >
              {isLaunching && !canKill ? (
                <RefreshIcon
                  width={21}
                  height={21}
                  stroke="var(--launcher-play)"
                  strokeWidth="2.8"
                  className="animate-spin transition-transform group-hover/btn:scale-110 group-active/btn:scale-95"
                />
              ) : canKill ? (
                <KillIcon
                  width={21}
                  height={21}
                  className="transition-transform group-hover/btn:scale-110 group-active/btn:scale-95"
                />
              ) : (
                <PlayMarkIcon
                  width={24}
                  height={24}
                  className="ml-0.5 transition-transform group-hover/btn:scale-110 group-active/btn:scale-95"
                />
              )}
            </button>
          </div>

          <button
            type="button"
            onClick={handleToggle}
            className={`flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-all duration-300 ${
              isActive
                ? 'icon-action-active'
                : 'icon-action opacity-40 group-hover/row:opacity-100 group-hover/row:bg-(--glass-bg)'
            }`}
            title={isActive ? 'Close Profile Settings' : 'Profile Settings'}
            aria-label={isActive ? 'Close Profile Settings' : 'Profile Settings'}
          >
            {isActive ? (
              <KillIcon width={18} height={18} className="transition-transform hover:scale-110" />
            ) : (
              <SettingsIcon
                width={18}
                height={18}
                className="transition-transform hover:rotate-90"
              />
            )}
          </button>
        </div>
      </div>

      <div
        className={`profile-editor-wrapper relative z-0 ${isActive ? 'profile-editor-open' : 'profile-editor-closed'}`}
      >
        <div className="overflow-hidden">
          {isActive && (
            <div className="pb-4">
              <ProfileEditor
                gameKey={game.key}
                activeProfileId={profileSet.activeProfileId}
                onProfilesChanged={loadProfileSet}
                onClose={onToggleEditor}
                onLaunchRequest={(launcher) => {
                  handleLaunchRequest.current = launcher
                }}
              />
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={profileSwitchConfirm !== null}
        title="Switch Running Profile"
        message={profileSwitchConfirm?.message || ''}
        saveLabel="Switch Profile"
        discardLabel="Keep Current"
        onSave={handleConfirmProfileSwitch}
        onDiscard={() => setProfileSwitchConfirm(null)}
        onCancel={() => setProfileSwitchConfirm(null)}
      />
    </div>
  )
}
